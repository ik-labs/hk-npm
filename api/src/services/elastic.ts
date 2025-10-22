import { Client } from "@elastic/elasticsearch";

import type { AppConfig } from "../config/env.js";
import type { PackageMetadata } from "@npm-intel/shared/mcp";

export const PACKAGE_INDEX = "npm-packages";

let cachedClient: Client | null = null;

export function getElasticClient(config: AppConfig): Client {
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

type RawPackageHit = {
  name?: string;
  version?: string;
  description?: string;
  total_symbols?: number;
  source_strategy?: string;
  updated_at?: string;
  indexed_at?: string;
};

export async function listPackages(client: Client): Promise<PackageMetadata[]> {
  const response = await client.search<RawPackageHit>({
    index: PACKAGE_INDEX,
    size: 500,
    query: {
      match_all: {},
    },
    _source: ["name", "version", "description", "total_symbols", "source_strategy", "updated_at", "indexed_at"],
  });

  const packages: PackageMetadata[] = [];

  for (const hit of response.hits.hits ?? []) {
    const doc = hit._source ?? {};
    if (!doc.name || !doc.version) {
      continue;
    }

    const totalSymbols = doc.total_symbols ?? 0;
    const sourceStrategy = doc.source_strategy ?? undefined;
    const lastIndexedAt = doc.updated_at ?? doc.indexed_at ?? new Date().toISOString();

    packages.push({
      name: doc.name,
      version: doc.version,
      description: doc.description ?? undefined,
      totalSymbols,
      sourceStrategy,
      lastIndexedAt,
    });
  }

  return packages;
}

export async function fetchPackageDocument(client: Client, packageName: string) {
  const response = await client.search<RawPackageHit>({
    index: PACKAGE_INDEX,
    size: 1,
    query: {
      term: {
        name: packageName,
      },
    },
    _source: true,
  });

  return response.hits.hits[0]?._source ?? null;
}

type SearchHit = {
  name?: string;
  description?: string;
  code_examples?: string;
};

export async function searchPackageContent(client: Client, packageName: string, query: string, limit: number) {
  const response = await client.search<SearchHit>({
    index: PACKAGE_INDEX,
    size: limit,
    query: {
      bool: {
        must: [
          {
            term: {
              name: packageName,
            },
          },
        ],
        should: [
          {
            multi_match: {
              query,
              fields: ["description^2", "code_examples"],
              type: "best_fields",
            },
          },
          {
            match: {
              name: {
                query,
                boost: 4,
              },
            },
          },
        ],
      },
    },
    _source: ["name", "description", "code_examples"],
  });

  const results: Array<{ id: string; score: number; snippet?: string }> = [];

  for (const hit of response.hits.hits ?? []) {
    if (!hit._id) continue;

    const snippet = hit._source?.description ?? hit._source?.code_examples?.slice(0, 280) ?? undefined;
    results.push({
      id: hit._id,
      score: hit._score ?? 0,
      snippet,
    });
  }

  return results;
}
