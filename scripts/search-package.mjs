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

const query = process.argv[2];

const res = await client.search({
  index: "npm-packages",
  size: 5,
  query: {
    multi_match: {
      query,
      fields: ["name^5", "description^3", "readme_content", "keywords^2"],
    },
  },
  _source: ["name", "version"],
});

console.log(res.hits.hits.map((hit) => hit._source));
