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

const res = await client.get({
  index: "npm-packages",
  id: pkg,
});
console.log(JSON.stringify(res, null, 2));
