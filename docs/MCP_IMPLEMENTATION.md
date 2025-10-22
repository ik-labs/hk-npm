# MCP Server Implementation Plan

This document outlines the proposed architecture, data flow, and implementation plan for the Model Context Protocol (MCP) server that powers the npm Intel experience. The goals are:

- Expose package discovery, ingestion, and chat capabilities via MCP resources, tools, and sessions.
- Reuse the existing TypeScript codebase where possible.
- Maintain a single runtime (Node.js) with strong typing guarantees (Fastify + Zod).

---

## Implementation Status

**Completed**
- Shared TypeScript package exposing MCP schemas (`@npm-intel/shared`)
- Fastify MCP API skeleton with resource, tool, and session routes plus Elasticsearch/BullMQ wiring
- BullMQ worker service that reuses the existing ingestion pipeline
- Build scripts for shared/api/workers packages

**Pending**
- Authentication and authorization guards for MCP endpoints
- Rich MCP search/answer responses (Gemini integration, context payloads)
- CLI demo client that exercises MCP resources/tools (initial presentation path)
- Deployment configuration (Docker, env wiring) and runtime smoke tests
- Optional: mapping Next.js UI to MCP once CLI flow is validated

---

## 1. High-Level Architecture

```
┌──────────────────────────────┐
│        MCP Client(s)         │
│  • UI (Next.js)              │
│  • CLI / IDE integrations    │
│  • Automation agents         │
└──────────────┬───────────────┘
               │  Model Context Protocol (JSON-RPC over HTTPS)
┌──────────────▼───────────────┐
│        MCP Control Plane      │
│  (Fastify + TypeScript + Zod) │
│                               │
│  Resources:                   │
│   • npm-package://<name>      │
│                               │
│  Tools:                       │
│   • search                    │
│   • answer                    │
│   • reindex                   │
│                               │
│  Sessions/Brokers:            │
│   • Bind user requests        │
│     to package resources      │
└───────┬──────────┬───────────┘
        │          │
        │          │
┌───────▼────┐ ┌───▼──────────────────┐
│ Elasticsearch│ │ Redis (BullMQ) /    │
│ npm-packages │ │ Temporal (Jobs)     │
└───────┬─────┘ └───────────┬─────────┘
        │                   │
        │                   │
┌───────▼───────────────────────────────┐
│  Ingestion Workers (TypeScript)        │
│  • Fetch npm metadata / source code    │
│  • Parse symbols, README, embeddings   │
│  • Index into Elasticsearch            │
└────────────────────────────────────────┘
```

### Communication Patterns
- **MCP HTTP Endpoints**: Receive JSON-RPC requests from clients and respond immediately.
- **Job Queue**: Long-running ingestion tasks are enqueued; the MCP server returns a job ID and later updates resource metadata.
- **Elasticsearch**: Source of truth for package documents, including stats exposed through MCP resources.

---

## 2. Project Layout

```
.
├── api/
│   ├── src/
│   │   ├── index.ts             # Fastify bootstrap
│   │   ├── mcp/
│   │   │   ├── schemas.ts       # Zod definitions
│   │   │   ├── resources.ts     # Resource handlers
│   │   │   ├── tools.ts         # Tool handlers
│   │   │   └── sessions.ts      # Session resolver
│   │   ├── services/
│   │   │   ├── elastic.ts       # ES client helper
│   │   │   ├── jobs.ts          # BullMQ or Temporal wrapper
│   │   │   └── search.ts        # Shared search functions
│   │   ├── config/
│   │   │   └── env.ts           # Zod-based env parsing
│   │   └── types/               # Shared types
│   └── package.json
│
├── workers/
│   ├── src/
│   │   ├── index.ts             # Worker bootstrap
│   │   ├── jobs/
│   │   │   └── reindex.ts       # Calls existing ingestion pipeline
│   │   └── services/            # Elasticsearch, npm, GitHub helpers
│   └── package.json
│
├── shared/
│   ├── src/
│   │   ├── mcp.ts               # Shared TypeScript interfaces
│   │   └── contracts.ts         # Zod schemas reused by API and UI
│   └── package.json
│
├── ui/                          # Existing Next.js frontend
└── scripts/                     # Existing ingestion utilities
```

---

## 3. Fastify MCP Server

### 3.1 Fastify Setup (api/src/index.ts)
```ts
import fastify from "fastify";
import { fastifyCors } from "@fastify/cors";
import { fastifySwagger } from "@fastify/swagger"; // optional internal docs
import { registerMcpRoutes } from "./mcp";
import { buildConfig } from "./config/env";

const app = fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

const config = buildConfig();

await app.register(fastifyCors, { origin: config.corsOrigins });
await app.register(registerMcpRoutes, { config });

app.listen({ port: config.port, host: "0.0.0.0" });
```

### 3.2 Environment Validation (api/src/config/env.ts)
```ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  ELASTIC_ENDPOINT: z.string().url(),
  ELASTIC_API_KEY: z.string(),
  REDIS_URL: z.string().url(),
  QUEUE_NAME: z.string().default("reindex"),
  API_TOKEN_SECRET: z.string(), // for MCP auth
});

export function buildConfig() {
  return envSchema.parse(process.env);
}
```

### 3.3 Zod Type Provider
Install `fastify-type-provider-zod`:
```ts
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
```

---

## 4. MCP Contracts

### 4.1 Shared Zod Schemas (shared/src/mcp.ts)
```ts
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
  resources: z.array(
    z.object({
      id: packageResourceId,
      title: z.string(),
      summary: z.string().optional(),
      metadata: packageMetadata,
    }),
  ),
});

export const reindexRequest = z.object({
  resourceId: packageResourceId,
});

export const reindexResponse = z.object({
  jobId: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
});
```

Export TypeScript types directly from these schemas for strict typing throughout the project.

---

## 5. MCP Routes

### 5.1 Route Registration (api/src/mcp/index.ts)
```ts
import { FastifyInstance } from "fastify";
import { listResourcesRoute } from "./resources";
import { toolsRoutes } from "./tools";
import { sessionRoutes } from "./sessions";

export async function registerMcpRoutes(app: FastifyInstance, opts: { config: Config }) {
  await app.register(listResourcesRoute, opts);
  await app.register(toolsRoutes, opts);
  await app.register(sessionRoutes, opts);
}
```

### 5.2 Resource Listing
```ts
app.post(
  "/mcp/resources.list",
  {
    schema: {
      body: z.object({}),
      response: {
        200: listResourcesResponse,
      },
    },
  },
  async (request, reply) => {
    const packages = await elasticService.listPackages();
    return reply.send({
      resources: packages.map(pkg => ({
        id: `npm-package://${pkg.name}`,
        title: pkg.name,
        summary: pkg.description,
        metadata: {
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          totalSymbols: pkg.total_symbols ?? 0,
          sourceStrategy: pkg.source_strategy,
          lastIndexedAt: pkg.updated_at ?? pkg.created_at,
        },
      })),
    });
  },
);
```

### 5.3 Tool: `search`
```ts
app.post(
  "/mcp/tools.search",
  {
    schema: {
      body: z.object({
        resourceId: packageResourceId,
        query: z.string().min(1),
        limit: z.number().min(1).max(10).default(5),
      }),
      response: {
        200: z.object({
          results: z.array(
            z.object({
              id: z.string(),
              score: z.number(),
              snippet: z.string().optional(),
              context: z.array(z.string()).optional(),
            }),
          ),
        }),
      },
    },
  },
  async (request, reply) => {
    const { resourceId, query, limit } = request.body;
    const packageName = parseResourceId(resourceId);
    const results = await elasticService.searchPackage(packageName, query, limit);
    return reply.send({ results });
  },
);
```

### 5.4 Tool: `answer`
Mirrors existing backend logic: calls the Gemini-backed `/answer` flow, but run server-side via Fastify service.

### 5.5 Tool: `reindex`
```ts
app.post(
  "/mcp/tools.reindex",
  {
    schema: {
      body: reindexRequest,
      response: { 200: reindexResponse },
    },
  },
  async (request, reply) => {
    const packageName = parseResourceId(request.body.resourceId);
    const job = await jobsService.enqueueReindex(packageName);
    return reply.send({ jobId: job.id, status: job.status });
  },
);
```

### 5.6 Sessions
Sessions bind an MCP conversation to a resource:
```ts
app.post(
  "/mcp/sessions.create",
  {
    schema: {
      body: z.object({
        resourceId: packageResourceId,
        userId: z.string(),
      }),
      response: {
        200: z.object({
          sessionId: z.string(),
          resourceId: packageResourceId,
          // optionally include initial context messages or credentials
        }),
      },
    },
  },
  async (request, reply) => {
    const session = await sessionService.create(request.body);
    return reply.send(session);
  },
);
```

---

## 6. Job Orchestration

### 6.1 BullMQ (Redis) Setup
```ts
import { Queue, Worker, QueueScheduler } from "bullmq";

const queue = new Queue("reindex", { connection: { url: config.redisUrl } });
const scheduler = new QueueScheduler("reindex", { connection: { url: config.redisUrl } });

export async function enqueueReindex(packageName: string) {
  return queue.add("reindex-package", { packageName }, { attempts: 3, backoff: { type: "exponential", delay: 30000 } });
}
```

### 6.2 Worker Implementation (workers/src/jobs/reindex.ts)
```ts
import { Job } from "bullmq";
import { indexPackages } from "../../scripts/ingestion/indexer";

export async function reindexJob(job: Job<{ packageName: string }>) {
  const { packageName } = job.data;
  await indexPackages([packageName]); // reuse existing ingestion pipeline
}
```

Workers bootstrap:
```ts
new Worker("reindex", reindexJob, { connection: { url: config.redisUrl } });
```

### 6.3 Job Status Endpoint
Expose `/mcp/jobs.status` so clients can poll:
```ts
app.post(
  "/mcp/jobs.status",
  {
    schema: {
      body: z.object({ jobId: z.string() }),
      response: {
        200: z.object({
          jobId: z.string(),
          status: z.enum(["waiting", "active", "completed", "failed"]),
          result: z.any().optional(),
          error: z.string().optional(),
        }),
      },
    },
  },
  async (request, reply) => {
    const job = await queue.getJob(request.body.jobId);
    if (!job) {
      return reply.code(404).send({ jobId: request.body.jobId, status: "failed", error: "Not found" });
    }
    return reply.send({
      jobId: job.id,
      status: job.getState(),
      result: job.returnvalue,
      error: job.failedReason,
    });
  },
);
```

---

## 7. MCP Security Model

1. **Authentication**: Issue JWTs or signed MCP tokens via existing user auth (NextAuth). Tokens include user id and allowed MCP scopes (e.g., `read:packages`, `write:index`).
2. **Authorization**: Fastify preHandlers validate tokens and enforce scope before executing resource/tool handlers.
3. **Rate Limiting**: Optional Fastify plugin (e.g., `@fastify/rate-limit`) to throttle per token.
4. **Input Validation**: All requests validated via Zod to prevent invalid payloads.

---

## 8. Data Contracts and Mapping

| MCP Concept | Implementation | Notes |
|-------------|----------------|-------|
| Resource ID (`npm-package://...`) | Derived from Elastic doc `_id` | store mapping in Elastic or compute from name/version |
| Resource Metadata | `name`, `version`, `description`, `totalSymbols`, `sourceStrategy`, `lastIndexedAt` | extracted from ES `_source` fields |
| Tool `search` output | Derived from Elastic search hits | include `_score`, snippet of README/source |
| Tool `answer` response | Output of existing Gemini-backed API | ensure the same shape used by UI |
| Tool `reindex` job ID | BullMQ job ID | clients poll `jobs.status` |

---

## 9. CLI Demonstration Path

For the initial demo we will showcase MCP interactions from the command line:

1. **List resources**: `curl` or a Node script calling `/mcp/resources.list` to enumerate indexed packages.
2. **Inspect metadata**: invoke `/mcp/tools.search` for a specific resource to surface README snippets and scores.
3. **Trigger reindex**: call `/mcp/tools.reindex`, capture the returned job id, and poll `/mcp/jobs.status` until completion.
4. **Session example** (optional): create a session via `/mcp/sessions.create` to demonstrate scoped interactions.

Once the CLI path is validated we can decide whether to retrofit the Next.js UI to consume the same MCP surface.

---

## 10. Deployment Strategy

- Build container images for `api/` (Fastify server) and `workers/`.
- Use Docker Compose or k8s manifests to deploy:
  - `api` service (exposed publicly behind HTTPS + WAF).
  - `worker` deployment connected to the same Redis and Elastic.
  - Redis (managed service) for job queue.
  - Continue using managed Elasticsearch.
- Configure environment variables via secrets manager.

---

## 11. Next Steps

1. **Add authentication**: verify MCP requests with signed tokens and scope checks.
2. **Enrich tool outputs**: plug in Gemini-backed answer generation and include richer context payloads.
3. **Author CLI scripts** that wrap the MCP endpoints for demo (list → search → reindex → job status).
4. **Smoke-test deployments** using Docker Compose (API + worker + Redis) before sharing.
5. **(Optional)** Re-point the Next.js UI to MCP once CLI demo is stable.

This plan keeps the stack entirely in TypeScript, reuses existing ingestion code, and moves the system onto a reliable MCP-based control plane without introducing extra runtimes or observability tooling at this stage.

---

*Prepared for the npm Intel MCP initiative.* 
