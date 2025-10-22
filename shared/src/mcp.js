import { z } from "zod";
export const packageResourceId = z.string().regex(/^npm-package:\/\/.+$/);
export const packageMetadata = z.object({
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    totalSymbols: z.number(),
    sourceStrategy: z.string().optional(),
    lastIndexedAt: z.string().datetime(),
});
export const listResourcesResponse = z.object({
    resources: z.array(z.object({
        id: packageResourceId,
        title: z.string(),
        summary: z.string().optional(),
        metadata: packageMetadata,
    })),
});
export const reindexRequest = z.object({
    resourceId: packageResourceId,
});
export const reindexResponse = z.object({
    jobId: z.string(),
    status: z.enum(["queued", "running", "completed", "failed"]),
});
