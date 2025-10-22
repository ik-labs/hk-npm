import { z } from "zod";

const envSchema = z.object({
  REDIS_URL: z.string().url(),
  QUEUE_NAME: z.string().default("reindex"),
  ELASTIC_ENDPOINT: z.string().url(),
  ELASTIC_API_KEY: z.string(),
});

export type WorkerConfig = ReturnType<typeof buildConfig>;

export function buildConfig() {
  const parsed = envSchema.parse(process.env);
  return {
    redisUrl: parsed.REDIS_URL,
    queueName: parsed.QUEUE_NAME,
    elasticEndpoint: parsed.ELASTIC_ENDPOINT,
    elasticApiKey: parsed.ELASTIC_API_KEY,
  };
}
