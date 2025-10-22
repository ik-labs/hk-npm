# NPM Intel 🚀

AI-powered npm package intelligence with grounded code generation using **Elastic Serverless** and **Gemini AI**.

> **Problem:** LLMs hallucinate APIs for modern npm packages that weren't in their training data.  
> **Solution:** Hybrid search (BM25 + semantic) + grounded code generation that only uses real, verified package APIs.

---

## 🎯 What This Does

1. **Intent-based Discovery**: Search packages by what you want to do
   - _"edge rate limiting for cloudflare workers"_ → finds `@upstash/ratelimit`
   - _"durable background jobs with retries"_ → finds `inngest`, `@trigger.dev/sdk`

2. **Grounded Code Generation**: Generate TypeScript code using ONLY real APIs from package docs
   - Pulls context from Elasticsearch (README, exports, examples)
   - Gemini generates code grounded in provided context
   - Light TypeScript syntax validation with auto-retry
   - Always cites sources or says "insufficient context"

3. **MCP Integration**: Use as a tool in Cursor/Windsurf IDEs
   - Fastify control plane exposing MCP resources/tools (`shared/`, `api/`, `workers/`)
   - BullMQ worker trigger for on-demand ingestion
   - CLI demo script to list → search → answer → reindex packages

---

## 🏗️ Architecture

```
┌──────────────┐
│    Users      │
│ (Web / MCP)   │
└──────┬───────┘
       │
       ▼
┌────────────────────────────┐
│ MCP Control Plane (Fastify)│
│  • /mcp/resources.list     │
│  • /mcp/tools.search       │
│  • /mcp/tools.answer       │
│  • /mcp/tools.reindex      │
└──────────┬─────────────────┘
           │
 ┌─────────┴──────────┐
 │                    │
 ▼                    ▼
┌──────────────────┐   ┌────────────────────┐
│ Elastic Cloud    │   │ BullMQ Workers     │
│  • RRF Hybrid    │   │  • indexPackages() │
│  • semantic_text │   │  • uses ingestion  │
│  • Gemini embed  │   └─────────┬──────────┘
└─────────┬────────┘             │
          │                      │
          ▼                      ▼
      ┌──────────────┐     ┌─────────────────┐
      │ Legacy HTTP  │     │  Gemini AI      │
      │  API (optional)     │  (Grounded code)│
      └──────────────┘     └─────────────────┘
```

**Key Tech:**
- **Elastic Serverless** with RRF (Reciprocal Rank Fusion) hybrid retrieval
- **Gemini embedding-001** for semantic search via `semantic_text` field
- **Gemini 1.5 Pro** for grounded code generation
- **TypeScript** backend with minimal dependencies

---

## 📦 MVP Package Corpus (12-15 packages)

**AI/Agent (4):**
- `@composio/core`, `@composio/client`
- `@trigger.dev/sdk`, `inngest`

**Edge/Serverless (3):**
- `@upstash/ratelimit`, `@upstash/redis`
- `@planetscale/database`

**Framework/Utils (5):**
- `hono`, `elysia`, `@t3-oss/env-nextjs`
- `zod`, `oslo`

**Optional (2):**
- `@vercel/kv`, `@effect/schema`

---

## 🚀 Quick Start
Short on time? Here’s the minimum to get the hackathon demo running end-to-end.

```bash
# 0. Install deps
npm install
(cd shared && npm install && npm run build)
(cd api && npm install && npm run build)
(cd workers && npm install && npm run build)

# 1. Configure .env (Elastic, Gemini, Redis, MCP token)
cp .env.example .env   # then edit values

# 2. Provision Elastic inference + index
npm run setup:inference
npm run setup:index

# 3. Ingest the MVP corpus
npm run ingest

# 4. Start services
npm run dev                 # legacy HTTP API (search/answer endpoints)
(cd api && npm run dev)     # MCP control plane on :4000
(cd workers && npm run dev) # BullMQ reindex worker

# 5. Showcase
npm run mcp:demo -- --answer "generate a zod schema"
cd ui && npm run dev        # optional Next.js UI on :3001
```

### Prerequisites

- **Node.js** 18+ and npm/pnpm/yarn
- **Elastic Cloud** account with Serverless instance ([sign up free](https://cloud.elastic.co/registration))
- **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/app/apikey) (free tier works)

### 1. Clone & Install

```bash
cd npm-intel
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
ELASTIC_CLOUD_ID=your-cloud-id-here
ELASTIC_API_KEY=your-api-key-here
GEMINI_API_KEY=your-gemini-api-key-here
```

**How to get your Elastic credentials:**
1. Go to [Elastic Cloud Console](https://cloud.elastic.co/)
2. Create a Serverless Elasticsearch project (or use existing)
3. Copy the **Cloud ID** from project settings
4. Create an API key: Management → Security → API Keys → Create API key

### 3. Set Up Elasticsearch

```bash
# Step 1: Create Gemini inference endpoint
npm run setup:inference

# Step 2: Create the npm-packages index
npm run setup:index
```

You should see:
```
✅ Successfully created Gemini inference endpoint!
✅ Successfully created index 'npm-packages'!
```

### 4. Ingest Packages

```bash
npm run ingest
```

This will fetch and index all 12-15 MVP packages from unpkg CDN. Takes ~2-3 minutes.

Expected output:
```
📊 Ingestion Summary:
   ✅ Successful: 15/15
   ❌ Failed: 0/15
```

### 5. Test Search

```bash
npm run test:search
```

This runs preset queries and shows RRF hybrid search results:

```
🔍 Query: "edge rate limiting for cloudflare workers"
────────────────────────────────────────────────────────────
1. @upstash/ratelimit@2.0.3
   Score: 0.9842
   Description: Rate limiting library for serverless runtimes
   Keywords: rate-limit, edge, serverless
```

---

## 📝 Scripts Reference

| Command                   | Description                                    |
|---------------------------|------------------------------------------------|
| `npm run setup:inference` | Create Gemini inference endpoint in Elastic    |
| `npm run setup:index`     | Create npm-packages index with mappings        |
| `npm run ingest`          | Fetch and index all MVP packages               |
| `npm run test:search`     | Test RRF hybrid search with preset queries     |
| `npm run dev`             | Start API server in watch mode (coming soon)   |
| `npm run build`           | Compile TypeScript to dist/                    |
| `npm run mcp:demo`        | CLI demo for MCP list/search/answer/reindex    |

---

## 🧠 MCP Control Plane

NPM Intel ships a dedicated MCP surface so agents and IDEs can interact with the same data the web UI uses.

### Components
- **`shared/`**: Zod schemas plus the Gemini-grounded answer_service shared by both APIs.
- **`api/`**: Fastify control plane exposing MCP resources and tools (requires `API_TOKEN_SECRET`).
- **`workers/`**: BullMQ worker that runs `indexPackages()` for `/mcp/tools.reindex` jobs.
- **Auth**: Bearer token (`Authorization: Bearer …`) or `x-api-key` matching `API_TOKEN_SECRET`.

### Local Runbook
1. Install & build packages:
   ```bash
   (cd shared && npm install && npm run build)
   (cd api && npm install && npm run build)
   (cd workers && npm install && npm run build)
   ```
2. Configure root `.env`:
   ```env
   MCP_PORT=4000
   API_TOKEN_SECRET=super-secret-token
   MCP_API_TOKEN=super-secret-token
   REDIS_URL=rediss://default:<token>@<host>:6379
   QUEUE_NAME=reindex
   ELASTIC_ENDPOINT=...
   ELASTIC_API_KEY=...
   GEMINI_API_KEY=...
   ```
3. Run services:
   ```bash
   (cd api && npm run dev)
   (cd workers && npm run dev)
   ```
4. Demo from the CLI:
   ```bash
   npm run mcp:demo
   npm run mcp:demo -- --answer "generate a zod schema" --snippets=5
   ```

### Endpoints
- `/mcp/resources.list` &mdash; discover packages (`npm-package://…`).
- `/mcp/tools.search` &mdash; hybrid search scoped to a package.
- `/mcp/tools.answer` &mdash; Gemini-grounded TypeScript sample with citation.
- `/mcp/tools.reindex` &mdash; trigger ingestion, returning a job id.
- `/mcp/jobs.status` &mdash; poll reindex job state until completion.

The CLI demo walks through list → search → (optional) answer → reindex so you can showcase the whole flow straight from a terminal.

---

## 🔍 How It Works

### Ingestion Pipeline

1. **Fetch** from unpkg CDN:
   - `package.json` (name, version, description, keywords)
   - `README.md` (documentation and examples)
   - `dist/index.d.ts` (TypeScript definitions)

2. **Extract**:
   - Exports (functions, classes, interfaces) via regex
   - Code examples from README fenced blocks (```ts, ```js)

3. **Index** to Elasticsearch:
   - Single `semantic_text` field combines README + code examples
   - Auto-generates embeddings via Gemini inference endpoint
   - Nested `exports[]` for symbol lookup (plain text)

### Search (RRF Hybrid)

**Two retrievers combined with Reciprocal Rank Fusion:**

1. **BM25 (keyword)**: 
   - Searches `description^3`, `readme_content`, `keywords^2`
   - Good for exact terms like "rate limiting" or package names

2. **Semantic (embeddings)**:
   - Searches `readme_content` via Gemini embeddings
   - Good for intent queries like "prevent abuse in edge functions"

RRF merges results for best of both worlds (typically +15-25% NDCG improvement).

### Code Generation (Grounded)

1. User provides: `intent` + `package name`
2. Backend fetches package doc from Elasticsearch
3. Constructs prompt with:
   - README excerpt (3500 chars max)
   - List of exported symbols
   - Code examples
4. Gemini generates TypeScript code using ONLY provided context
5. Light syntax check via `ts.transpileModule()`
6. If syntax fails, retry once with error message
7. Return code + source citation + notes

**Key constraint:** Gemini is instructed to say "insufficient context" rather than hallucinate.

---

## 🎨 Demo Queries

Perfect for showing judges:

```
✅ "edge rate limiting for cloudflare workers"
   → @upstash/ratelimit

✅ "durable background jobs with retries"
   → inngest, @trigger.dev/sdk

✅ "create composio agent and register tool"
   → @composio/core, @composio/client

✅ "type-safe env for next.js"
   → @t3-oss/env-nextjs

✅ "serverless mysql client from node"
   → @planetscale/database

✅ "event driven workflows without cron"
   → inngest

✅ "input validation with schema library"
   → zod, @effect/schema
```

---

## 🔁 End-to-End Workflow

Once your environment is configured, this is the recommended flow for keeping the index, search, and grounded code generation in sync.

1. **Provision inference + index**
   ```bash
   npm run setup:inference
   npm run setup:index
   ```
   These commands create the Gemini embedding endpoint in Elastic and (re)build the `npm-packages` index with the latest mappings.

2. **Ingest/update packages**
   ```bash
   # set GITHUB_TOKEN in .env for higher rate limits
   npm run ingest
   ```
   The ingestion script fetches README + source, parses symbols, and writes one document per `package@version`. Re-running the command overwrites existing documents with fresh metadata and code.

3. **Verify embeddings and symbols**
   ```bash
   npm run verify:embeddings
   # optional detail view:
   npm run verify:embeddings -- --show-embeddings
   ```
   Confirms that every package document has semantic-text content for both README and source and shows symbol counts so you can spot empty packages quickly.

4. **Evaluate retrieval quality**
   ```bash
   npm run test:search-simple   # metadata + symbol checks
   npm run test:search          # RRF/BM25 smoke tests (falls back if semantic retriever unavailable)
   ```
   These suites exercise the same hybrid query logic used by the API and give you a pass/fail signal before demos.

5. **Run grounded API tests**
   ```bash
   npm run dev                  # start the HTTP API locally
   npm run test:api             # in another shell
   ```
   The test harness hits `/search` and `/answer` end-to-end, printing the generated TypeScript snippet for each scenario so you can validate grounding manually.

6. **Launch the demo UI (optional)**
   ```bash
   cd ui
   npm install
   npm run dev                  # defaults to http://localhost:3001
   ```
   The Next.js frontend proxies requests to the local API (`/search`, `/answer`). Set `NEXT_PUBLIC_API_BASE_URL` (and `API_BASE_URL` for server-side routes) if the API lives on a different origin.  
   The root page lists all indexed packages; visit `/[package]` (e.g. `/composio-client`) for a package-specific grounded chat.

When you add packages or bump versions, repeat steps 2–5. For production automation, wrap steps 2–4 in a CI job and call the API smoke test as a final gate.

---

## 📊 Index Schema

```json
{
  "name": "keyword",
  "version": "keyword",
  "description": "text",
  "readme_content": "semantic_text",  // ← Auto-embeddings!
  "keywords": ["keyword"],
  "exports": [{
    "kind": "keyword",     // function|class|interface|type|const
    "name": "keyword",
    "signature": "text",
    "jsdoc": "text"
  }],
  "code_examples": "text"
}
```

**Why `semantic_text`?**
- Automatically generates embeddings on index (no manual inference calls)
- Stores text + embeddings in single field
- Works seamlessly with `semantic` retriever in RRF
- Cost-efficient for MVP (single embedding per package)

---

## 🎯 Next Steps (Day 2-3)

### Day 2: API Endpoints
- [ ] `/search` endpoint with RRF
- [ ] `/answer` endpoint with grounded codegen
- [ ] Basic web UI (search → results → generate code)

### Day 3: MCP & Polish
- [ ] MCP server for Cursor/Windsurf
- [ ] Preset query buttons in UI
- [ ] Demo video (2-3 min)
- [ ] Optional: NDCG evaluation

---

## 🛠️ Troubleshooting

### "Failed to fetch package.json"
Some packages might not have a `dist/index.d.ts` - this is OK, we fallback gracefully.

### "Inference endpoint not found"
Run `npm run setup:inference` again. Make sure `GEMINI_API_KEY` is valid.

### "Index not found"
Run `npm run setup:index` to create the index.

### Search returns no results
Make sure you ran `npm run ingest` and it completed successfully.

### "semantic_text field not supported"
Ensure you're using Elastic Serverless (8.13+). semantic_text requires inference endpoints.

---

## 💡 Why This Matters

**Before NPM Intel:**
```typescript
// Developer asks AI: "Use inngest to create a scheduled job"
// AI hallucinates:
import { Inngest } from "inngest";
const inngest = new Inngest();
inngest.createScheduledJob({ ... }); // ❌ Doesn't exist!
```

**With NPM Intel:**
```typescript
// Grounded on actual inngest docs:
import { Inngest } from "inngest";
const inngest = new Inngest({ id: "my-app" });
inngest.createFunction(
  { id: "scheduled-job" },
  { cron: "0 9 * * *" },
  async ({ step }) => { ... }
); // ✅ Real API from docs!
```

---

## 📈 Success Metrics

- **Discovery**: ≥3 relevant packages per preset query
- **Grounding**: Generated code references real APIs (by name)
- **Quality**: +15-25% NDCG@10 improvement (RRF vs BM25 alone)
- **Stability**: 90%+ syntax-valid generation

---

## 🚀 Future (Post-MVP)

- [ ] Symbol-aware queries (boost on `exports.name`)
- [ ] ELSER as 3rd leg in RRF (identifier-rich boosting)
- [ ] Expand to 100-500 packages
- [ ] Auto-refresh on npm publish
- [ ] `/.well-known/llm.json` publisher
- [ ] PR bot for anti-pattern detection

---

## 📄 License

MIT

---

## 🙏 Built With

- [Elasticsearch](https://www.elastic.co/) - Search and retrieval
- [Google Gemini](https://ai.google.dev/) - Embeddings and code generation
- [unpkg](https://unpkg.com/) - CDN for npm packages
- [TypeScript](https://www.typescriptlang.org/) - Type safety

---

**Happy hacking! 🚀**

For questions or issues, open a GitHub issue.
