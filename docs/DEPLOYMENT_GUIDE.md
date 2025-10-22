# Deployment Guide

This document outlines how to deploy the two runtime surfaces used by NPM Intel:

1. **Legacy Node API** (`src/index.ts`) to **DigitalOcean App Platform**
2. **Next.js UI** (`ui/`) to **Vercel**

It assumes you have already set up your Elastic index and Gemini key locally and have a working `.env`.

---

## 1. Deploying the Legacy API to DigitalOcean App Platform

The legacy API is the Node server that exposes `/search`, `/answer`, and `/index`. It relies on TypeScript compilation (`npm run build`) and runs the compiled `dist/index.js`.

### Prerequisites
- DigitalOcean account with App Platform enabled.
- Docker or GitHub repository access (App Platform can deploy from GitHub directly).
- Environment variables: `ELASTIC_ENDPOINT` or `ELASTIC_CLOUD_ID`, `ELASTIC_API_KEY`, `GEMINI_API_KEY` (or `VERTEX_AI_API_KEY`), `GEMINI_MODEL` (optional). Optional: `REDIS_URL`, `QUEUE_NAME` if reindex jobs should be triggered via API.

### Steps

1. **Create a Production Build Process**
   - The repo already uses `npm run build` to emit `dist/index.js`. App Platform can run this on deployment if you specify build and run commands.

2. **Prepare Repository**
   - Ensure `dist/` is ignored (already via default).
   - Commit the latest code to your main branch.

3. **DigitalOcean App Setup**
   - Go to App Platform dashboard → “Create App”.
   - Select source → GitHub → choose this repository.
   - When prompted, select the root directory (`/`) as the component.
   - App Platform detects a Node app; override defaults:
     - **Build Command**: `npm install && npm run build`
     - **Run Command**: `npm run start` (this runs `node dist/index.js`)
     - **Environment**: Node 18+ (or 20).
     - **HTTP Port**: The app listens on `process.env.PORT` (fallback 3000). App Platform injects `PORT`, so no change needed.

4. **Environment Variables**
   - In the App configuration → “Environment Variables”:
     - `ELASTIC_ENDPOINT` or `ELASTIC_CLOUD_ID`
     - `ELASTIC_API_KEY`
     - `GEMINI_API_KEY` (or `VERTEX_AI_API_KEY`)
     - `GEMINI_MODEL` (optional; defaults to `gemini-flash-latest`)
     - If you plan to use `/index` to queue reindexing: set `REDIS_URL` (Upstash or DO Managed Redis) and `QUEUE_NAME`.
   - Optionally set `NODE_ENV=production`.

5. **Deploy**
   - Click “Save and Deploy”.
   - App Platform builds the app, then starts it.

6. **Verify**
   - Once live, open the provided URL.
   - Check `/health` to confirm the server responds.
   - Test `/search?q=zod` to ensure Elastic credentials are working.
   - Test `/answer` manually or via CLI.

7. **Scaling & Monitoring**
   - App Platform auto-scales by instance count; choose a Basic or Professional plan depending on traffic.
   - Use the DigitalOcean dashboard to monitor logs.

---

## 2. Deploying the Next.js UI to Vercel

The UI is a Next.js 14 project located in `ui/`. Vercel is the ideal target as it supports Next.js natively.

### Prerequisites
- Vercel account.
- GitHub repository access (Vercel integrates with Git).
- The backend API must be reachable from Vercel (e.g., the App Platform URL).

### Steps

1. **Prepare the UI Project**
   - Ensure `ui/` has its own `package.json` (already the case).
   - Commit the latest UI changes.

2. **Import into Vercel**
   - Go to Vercel dashboard → “Import Project” → choose GitHub → select this repo.
   - When Vercel detects multiple projects, specify `ui` as the root directory.
   - Vercel auto-detects Next.js; default build and output settings are fine.
     - **Build Command**: `npm run build`
     - **Output Directory**: `.next`
     - **Install Command**: `npm install`

3. **Environment Variables**
   - In Project Settings → Environment Variables, add:
- `NEXT_PUBLIC_API_BASE_URL` = URL of the legacy API (e.g., `https://<app-platform-app>.ondigitalocean.app`)
  - `API_BASE_URL` (for server-side requests) = same as above (so `app/api` routes can talk to the API).
- Optional: `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` if you want to protect the UI with HTTP basic auth.
     - If the API requires `MCP_API_TOKEN` or other auth headers, set them as well for server-side fetches (use server-side env variables and forward via headers).
   - If you have a separate staging API, set Preview environment variables accordingly.

4. **Deploy**
   - Click “Deploy”. Vercel builds the Next.js app.
   - After the first deployment, you can set up automatic redeploys on push.

5. **Verify**
   - Visit the Vercel URL (e.g., `https://npm-intel-ui.vercel.app/`).
   - Check the homepage (package list). It should fetch from the backend API.
   - Open a package page (e.g., `/zod`). Ensure data loads (search and answer flows should proxy to the backend).

6. **Custom Domain (optional)**
   - Add a custom domain in Vercel project settings and configure DNS to point to Vercel.

---

## 3. Notes on MCP Deployment

If you plan to expose the MCP Fastify API for external agents:

- Deploy `api/` service (Fastify MCP server) the same way as the legacy API (DigitalOcean, Railway, etc.).
- Ensure `API_TOKEN_SECRET` is set; rotate tokens per client if needed.
- Expose the base URL (e.g., `https://mcp.npmintel.app`). Agents will call `/mcp/resources.list`, etc.
- The BullMQ worker can run as a second App Platform service or on a separate droplet/container; ensure it shares the same Redis connection.

---

## 4. Recommended Infrastructure Variables

| Variable              | Component(s) | Description |
|-----------------------|--------------|-------------|
| `ELASTIC_ENDPOINT` or `ELASTIC_CLOUD_ID` | Legacy API, MCP API | Endpoint for Elasticsearch |
| `ELASTIC_API_KEY`     | Legacy API, MCP API | API key for Elastic |
| `GEMINI_API_KEY` or `VERTEX_AI_API_KEY` | Legacy API, MCP API | Gemini generative API key |
| `GEMINI_MODEL`        | Legacy API, MCP API | Model name (default `gemini-flash-latest`) |
| `REDIS_URL`           | MCP API, Workers | Redis connection string (Upstash, DO Managed Redis) |
| `QUEUE_NAME`          | MCP API, Workers | BullMQ queue (default `reindex`) |
| `API_TOKEN_SECRET`    | MCP API | Bearer token required for MCP routes |
| `MCP_API_TOKEN`       | CLI Demo | Token used when running `npm run mcp:demo` |
| `NEXT_PUBLIC_API_BASE_URL` | UI | Public base URL for the legacy API |
| `API_BASE_URL`        | UI | Server-side base URL for the legacy API |

Keep sensitive values in your hosting platform’s environment settings; don’t commit them to Git.

---

## 5. Post-Deployment Checklist

- [ ] Legacy API responds at `/health`, `/search?q=zod`, `/answer`.
- [ ] MCP API accessible with Authorization header (`/mcp/resources.list` works).
- [ ] Worker logs show reindex jobs completing.
- [ ] Vercel UI loads packages and can generate grounded answers.
- [ ] Set up monitoring/alerts (DigitalOcean App metrics, Vercel analytics).

That’s it! With the backend on DigitalOcean and the UI on Vercel, you have a scalable, managed setup ready for demos or production hardening.
