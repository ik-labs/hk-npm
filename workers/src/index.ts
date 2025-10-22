import { existsSync } from "node:fs";
import path from "node:path";

import { Worker } from "bullmq";
import { config as loadEnv } from "dotenv";

import { buildConfig } from "./config/env.js";
import { handleReindexJob } from "./jobs/reindex.js";

function loadEnvFromRoot() {
  const candidates = [
    process.env.WORKER_ENV_PATH,
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

  const connection = {
    url: config.redisUrl,
    maxRetriesPerRequest: null as number | null,
    tls: config.redisUrl.startsWith("rediss://") ? {} : undefined,
  };

  const worker = new Worker(config.queueName, handleReindexJob, {
    connection,
  });

  await worker.waitUntilReady();

  worker.on("completed", (job) => {
    console.log(`Reindex job completed for ${job.data.packageName}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Reindex job failed for ${job?.data.packageName}`, error);
  });
}

start().catch((error) => {
  console.error("Worker failed to start", error);
  process.exit(1);
});
