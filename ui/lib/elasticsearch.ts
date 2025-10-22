import "server-only";
import { Client } from "@elastic/elasticsearch";
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import path from "path";

const INDEX_NAME = "npm-packages";

let cachedClient: Client | null = null;
let envLoaded = false;

function ensureEnvLoaded(): void {
  if (envLoaded) {
    return;
  }

  if (!process.env.ELASTIC_API_KEY) {
    const candidates = [
      ".env.local",
      ".env",
      "../.env.local",
      "../.env",
    ];

    for (const candidate of candidates) {
      const fullPath = path.resolve(process.cwd(), candidate);
      if (existsSync(fullPath)) {
        loadEnv({ path: fullPath });
        if (process.env.ELASTIC_API_KEY) {
          break;
        }
      }
    }
  }

  envLoaded = true;
}

function createClient(): Client {
  ensureEnvLoaded();

  const apiKey = process.env.ELASTIC_API_KEY;
  const cloudId = process.env.ELASTIC_CLOUD_ID;
  const endpoint = process.env.ELASTIC_ENDPOINT;

  if (!apiKey) {
    throw new Error("Missing ELASTIC_API_KEY environment variable");
  }

  if (!cloudId && !endpoint) {
    throw new Error("Missing ELASTIC_CLOUD_ID or ELASTIC_ENDPOINT environment variable");
  }

  return cloudId
    ? new Client({
        cloud: { id: cloudId },
        auth: { apiKey },
      })
    : new Client({
        node: endpoint!,
        auth: { apiKey },
      });
}

export function getElasticsearchClient(): Client {
  if (!cachedClient) {
    cachedClient = createClient();
  }
  return cachedClient;
}

export { INDEX_NAME as PACKAGE_INDEX };
