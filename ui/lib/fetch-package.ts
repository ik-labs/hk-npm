import { getApiBaseUrl } from "./api";

export type PackageDocument = {
  id: string;
  score: number;
  name: string;
  version: string;
  description?: string;
  keywords?: string[] | string;
  total_symbols?: number;
  source_strategy?: string;
  context?: Array<{
    name: string;
    kind: string;
    file_path: string;
    snippet: string;
    is_exported: boolean;
    relevance_score?: number;
  }>;
};

type SearchResponse = {
  query: string;
  count: number;
  results: PackageDocument[];
};

export async function fetchPackageDocument(pkg: string) {
  const res = await fetch(
    `${getApiBaseUrl()}/search?${new URLSearchParams({
      q: pkg,
      limit: "1",
    }).toString()}`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch package ${pkg}: ${res.status}`);
  }

  const data: SearchResponse = await res.json();
  return data.results?.[0] ?? null;
}
