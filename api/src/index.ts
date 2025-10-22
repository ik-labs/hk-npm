import { existsSync } from "node:fs";
import path from "node:path";

import fastify from "fastify";
import cors from "@fastify/cors";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { config as loadEnv } from "dotenv";

import { buildConfig } from "./config/env.js";
import { registerMcpRoutes } from "./mcp/index.js";

function loadEnvFromRoot() {
  const candidates = [
    process.env.API_ENV_PATH,
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      loadEnv({ path: candidate });
      return;
    }
  }
  loadEnv();
}

async function start() {
  loadEnvFromRoot();
  const config = buildConfig();

  const app = fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: config.corsOrigins });

  app.get("/health", async () => ({ status: "ok" }));

  await registerMcpRoutes(app, config);

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(`MCP API listening on port ${config.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
