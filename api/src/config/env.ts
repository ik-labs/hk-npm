import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  MCP_PORT: z.coerce.number().optional(),
  PORT: z.coerce.number().optional(),
  PORT2: z.coerce.number().optional(),
  ELASTIC_ENDPOINT: z.string().url(),
  ELASTIC_API_KEY: z.string(),
  REDIS_URL: z.string().url().optional(),
  QUEUE_NAME: z.string().default("reindex"),
  API_TOKEN_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  VERTEX_AI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
});

export type AppConfig = ReturnType<typeof buildConfig>;

export function buildConfig() {
  const parsed = envSchema.parse(process.env);

  const corsOrigins = parsed.CORS_ORIGINS
    ? parsed.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : ["*"];

  const port = parsed.MCP_PORT ?? parsed.PORT2 ?? parsed.PORT ?? 4000;

  return {
    nodeEnv: parsed.NODE_ENV,
    port,
    elasticEndpoint: parsed.ELASTIC_ENDPOINT,
    elasticApiKey: parsed.ELASTIC_API_KEY,
    redisUrl: parsed.REDIS_URL,
    queueName: parsed.QUEUE_NAME,
    apiTokenSecret: parsed.API_TOKEN_SECRET,
    geminiApiKey: parsed.GEMINI_API_KEY || parsed.VERTEX_AI_API_KEY || undefined,
    geminiModel: parsed.GEMINI_MODEL || "gemini-flash-latest",
    corsOrigins,
  };
}
