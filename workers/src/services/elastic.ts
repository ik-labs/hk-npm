import { Client } from "@elastic/elasticsearch";

import type { WorkerConfig } from "../config/env.js";

let cachedClient: Client | null = null;

export function getElasticClient(config: WorkerConfig): Client {
  if (!cachedClient) {
    cachedClient = new Client({
      node: config.elasticEndpoint,
      auth: {
        apiKey: config.elasticApiKey,
      },
    });
  }
  return cachedClient;
}
