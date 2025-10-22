import { getElasticsearchClient, PACKAGE_INDEX } from "@/lib/elasticsearch";
import { PACKAGES } from "@/lib/packages";

async function fetchPackageNames(): Promise<string[]> {
  const client = getElasticsearchClient();
  const response = await client.search({
    index: PACKAGE_INDEX,
    size: 0,
    aggs: {
      names: {
        terms: {
          field: "name.keyword",
          size: 1000,
        },
      },
    },
  });

  const buckets = (response.aggregations as any)?.names?.buckets ?? [];
  if (buckets.length > 0) {
    return buckets.map((bucket: any) => bucket.key as string);
  }

  // Fallback to direct hits if aggregation missing (e.g., local dev without keyword field)
  const hitsResponse = await client.search({
    index: PACKAGE_INDEX,
    size: 1000,
    query: { match_all: {} },
    _source: ["name"],
  });

  return (hitsResponse.hits.hits ?? [])
    .map((hit: any) => hit._source?.name as string | undefined)
    .filter((name): name is string => Boolean(name));
}

export async function GET() {
  try {
    const names = (await fetchPackageNames()).sort();
    console.log("DEBUG packages", { names });
    return Response.json({
      packages: names,
      total: names.length,
      source: "elasticsearch",
    });
  } catch (error) {
    console.error("Error fetching packages from Elasticsearch:", error);

    const fallback = [...PACKAGES].sort();
    return Response.json({
      packages: fallback,
      total: fallback.length,
      source: "static_fallback",
    });
  }
}
