import { Queue, QueueEvents } from "bullmq";

import type { AppConfig } from "../config/env.js";

type RedisConnection = {
  url: string;
  maxRetriesPerRequest: number | null;
  tls?: Record<string, unknown>;
};

function buildRedisConnection(url: string): RedisConnection {
  const connection: RedisConnection = {
    url,
    maxRetriesPerRequest: null,
  };

  if (url.startsWith("rediss://")) {
    connection.tls = {};
  }

  return connection;
}

let connectionOptions: RedisConnection | null = null;

function getConnection(config: AppConfig): RedisConnection {
  if (!config.redisUrl) {
    throw new Error("Redis configuration missing: REDIS_URL is required for job operations");
  }
  if (!connectionOptions) {
    connectionOptions = buildRedisConnection(config.redisUrl);
  }
  return connectionOptions;
}

let queue: Queue | null = null;
let events: QueueEvents | null = null;

function ensureQueue(config: AppConfig) {
  if (!queue) {
    queue = new Queue(config.queueName, {
      connection: getConnection(config),
    });
  }

  if (!events) {
    events = new QueueEvents(config.queueName, {
      connection: getConnection(config),
    });
  }

  return { queue, events };
}

export async function enqueueReindex(config: AppConfig, packageName: string) {
  const { queue } = ensureQueue(config);
  const job = await queue.add("reindex-package", { packageName });
  return {
    jobId: job.id as string,
    status: "queued" as const,
  };
}

export async function getJobState(config: AppConfig, jobId: string) {
  const { queue } = ensureQueue(config);
  const job = await queue.getJob(jobId);
  if (!job) {
    return null;
  }

  const state = await job.getState();
  return {
    jobId: job.id as string,
    status: state,
    result: job.returnvalue ?? null,
    error: job.failedReason ?? null,
  };
}
