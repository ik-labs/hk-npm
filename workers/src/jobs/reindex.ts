import { Job } from "bullmq";

import { getIndexer } from "../stubs/indexer.js";

type ReindexPayload = {
  packageName: string;
};

export async function handleReindexJob(job: Job<ReindexPayload>) {
  const { packageName } = job.data;
  const { indexPackages } = await getIndexer();
  await indexPackages([packageName]);
  return { packageName, status: "completed" as const };
}
