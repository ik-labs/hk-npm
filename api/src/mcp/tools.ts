import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { createAnswerService } from "@npm-intel/shared/answer";

import {
  packageResourceId,
  reindexRequest,
  reindexResponse,
} from "@npm-intel/shared/mcp";

import type { AppConfig } from "../config/env.js";
import { enqueueReindex, getJobState } from "../services/jobs.js";
import { getElasticClient, searchPackageContent, PACKAGE_INDEX } from "../services/elastic.js";
import { parseResourceId } from "./utils.js";

const searchRequestSchema = z.object({
  resourceId: packageResourceId,
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).default(5),
});

const searchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      score: z.number(),
      snippet: z.string().optional(),
      context: z.array(z.string()).optional(),
    }),
  ),
});

const jobStatusRequestSchema = z.object({
  jobId: z.string().min(1),
});

const jobStatusResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
});

const answerRequestSchema = z.object({
  resourceId: packageResourceId,
  intent: z.string().min(1),
  searchQuery: z.string().optional(),
  maxSnippets: z.number().int().min(1).max(10).optional(),
});

const answerResponseSchema = z.object({
  intent: z.string(),
  packageName: z.string(),
  searchQuery: z.string(),
  code: z.string(),
  context: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      file_path: z.string(),
      jsdoc: z.string().optional(),
      signature: z.string().optional(),
      is_exported: z.boolean(),
    }),
  ),
});

export async function registerToolRoutes(app: FastifyInstance, config: AppConfig) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const client = getElasticClient(config);
  const generativeModels = (() => {
    if (!config.geminiApiKey) {
      return [] as GenerativeModel[];
    }

    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const models: GenerativeModel[] = [];

    try {
      models.push(genAI.getGenerativeModel({ model: config.geminiModel }));
    } catch (error) {
      app.log.warn(`Failed to initialize Gemini model ${config.geminiModel}: ${String(error)}`);
    }

    const fallbackModel = "gemini-flash-lite-latest";
    if (config.geminiModel !== fallbackModel) {
      try {
        models.push(genAI.getGenerativeModel({ model: fallbackModel }));
      } catch (error) {
        app.log.warn(`Failed to initialize fallback Gemini model ${fallbackModel}: ${String(error)}`);
      }
    }

    return models;
  })();

  const answerService = createAnswerService({
    esClient: client,
    indexName: PACKAGE_INDEX,
    generativeModels,
    maxRetries: 2,
    allowUngroundedFallback: true,
  });

  typed.post(
    "/mcp/tools.reindex",
    {
      schema: {
        body: reindexRequest,
        response: {
          200: reindexResponse,
        },
      },
    },
    async (request, reply) => {
      const body = reindexRequest.parse(request.body);
      const packageName = parseResourceId(body.resourceId);
      const job = await enqueueReindex(config, packageName);
      return reply.send({
        jobId: job.jobId,
        status: job.status,
      });
    },
  );

  typed.post(
    "/mcp/tools.search",
    {
      schema: {
        body: searchRequestSchema,
        response: {
          200: searchResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { resourceId, query, limit } = searchRequestSchema.parse(request.body);
      const packageName = parseResourceId(resourceId);
      const results = await searchPackageContent(client, packageName, query, limit);
      return reply.send({ results });
    },
  );

  typed.post(
    "/mcp/tools.answer",
    {
      schema: {
        body: answerRequestSchema,
        response: {
          200: answerResponseSchema,
          422: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const body = answerRequestSchema.parse(request.body);
      const packageName = parseResourceId(body.resourceId);
      const result = await answerService.generateAnswer({
        intent: body.intent,
        packageName,
        searchQuery: body.searchQuery,
        maxSnippets: body.maxSnippets,
      });

      if ("error" in result) {
        const status = result.error.includes("Gemini") ? 503 : 422;
        return reply.status(status).send(result);
      }

      return reply.send(result);
    },
  );

  typed.post(
    "/mcp/jobs.status",
    {
      schema: {
        body: jobStatusRequestSchema,
        response: {
          200: jobStatusResponseSchema,
          404: z.object({
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { jobId } = jobStatusRequestSchema.parse(request.body);
      const job = await getJobState(config, jobId);
      if (!job) {
        return reply.status(404).send({ message: "Job not found" });
      }
      return reply.send({
        jobId: job.jobId,
        status: job.status,
        result: job.result,
        error: job.error,
      });
    },
  );
}
