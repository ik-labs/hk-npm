import { Client } from "@elastic/elasticsearch";
import * as dotenv from "dotenv";

dotenv.config();

const client = new Client(
  process.env.ELASTIC_CLOUD_ID
    ? {
        cloud: { id: process.env.ELASTIC_CLOUD_ID },
        auth: { apiKey: process.env.ELASTIC_API_KEY },
      }
    : {
        node: process.env.ELASTIC_ENDPOINT,
        auth: { apiKey: process.env.ELASTIC_API_KEY },
      },
);

const pkg = process.argv[2];

const res = await client.search({
  index: "npm-packages",
  size: 1,
  query: { match: { name: pkg } },
  _source: true,
});

if (!res.hits.hits.length) {
  console.error("No match for", pkg);
  process.exit(1);
}

const doc = res.hits.hits[0]._source;
const keywords = doc.keywords ?? [];
const topSymbols = (doc.symbols ?? [])
  .filter((symbol) => symbol.is_exported && symbol.snippet && symbol.snippet.length > 0)
  .slice(0, 5)
  .map((symbol) => symbol.name);

console.log(JSON.stringify({ keywords, topSymbols }, null, 2));
