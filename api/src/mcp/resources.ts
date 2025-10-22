import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ZodTypeProvider } from "fastify-type-provider-zod";

import { listResourcesResponse } from "@npm-intel/shared/mcp";

import type { AppConfig } from "../config/env.js";
import { getElasticClient, listPackages } from "../services/elastic.js";
import { buildResourceId } from "./utils.js";

export async function registerResourceRoutes(app: FastifyInstance, config: AppConfig) {
  const client = getElasticClient(config);
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/mcp/resources.list",
    {
      schema: {
        body: z.object({}).optional(),
        response: {
          200: listResourcesResponse,
        },
      },
    },
    async (_request, reply) => {
      const packages = await listPackages(client);

      return reply.send({
        resources: packages.map((pkg) => ({
          id: buildResourceId(pkg.name),
          title: pkg.name,
          summary: pkg.description,
          metadata: pkg,
        })),
      });
    },
  );
}
