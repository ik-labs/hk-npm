# Google Vertex AI Setup Guide

## Why Vertex AI over AI Studio?

| Feature | Vertex AI | AI Studio |
|---------|-----------|-----------|
| **Latest Model** | ✅ `gemini-embedding-001` | ❌ `text-embedding-004` (older) |
| **Dimensions** | 768 default (Matryoshka 128-3072) | 768 fixed |
| **API Version** | v1 (stable) | v1 (limited models) |
| **Quality** | MTEB 67.99 @ 768-dim | Unknown benchmarks |
| **Elasticsearch** | ✅ Native `googlevertexai` | ⚠️ Limited `googleaistudio` |
| **Production Ready** | ✅ GA, enterprise-grade | ⚠️ Prototype/dev use |

**TL;DR:** Vertex AI gives us the **latest, best-quality** Gemini embeddings with full Elasticsearch support.

---

## Prerequisites

- Google Cloud account (free trial available)
- `gcloud` CLI installed (optional but recommended)
- Billing enabled on GCP project (free tier works for MVP)

---

## Step 1: Create Google Cloud Project

### Option A: Via Console (Easiest)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **"Select a project"** → **"New Project"**
3. Enter project name: `npm-intel-mvp` (or your choice)
4. Note the **Project ID** (e.g., `npm-intel-mvp-123456`)
5. Click **"Create"**

### Option B: Via gcloud CLI

```bash
# Login to Google Cloud
gcloud auth login

# Create project
gcloud projects create npm-intel-mvp --name="NPM Intel MVP"

# Set as active project
gcloud config set project npm-intel-mvp
```

---

## Step 2: Enable Vertex AI API

### Via Console

1. Go to [Vertex AI API page](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com)
2. Select your project
3. Click **"Enable"**
4. Wait ~30 seconds for activation

### Via gcloud CLI

```bash
# Enable Vertex AI API
gcloud services enable aiplatform.googleapis.com

# Verify it's enabled
gcloud services list --enabled | grep aiplatform
```

---

## Step 3: Create Service Account

### Via Console

1. Go to [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Click **"Create Service Account"**
3. Enter details:
   - Name: `npm-intel-embeddings`
   - Description: `Service account for NPM Intel embeddings`
4. Click **"Create and Continue"**
5. Grant role: **Vertex AI User**
6. Click **"Continue"** → **"Done"**

### Via gcloud CLI

```bash
# Create service account
gcloud iam service-accounts create npm-intel-embeddings \
  --display-name="NPM Intel Embeddings" \
  --description="Service account for NPM Intel embeddings"

# Grant Vertex AI User role
gcloud projects add-iam-policy-binding npm-intel-mvp \
  --member="serviceAccount:npm-intel-embeddings@npm-intel-mvp.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

---

## Step 4: Generate Service Account Key

### Via Console

1. Go to [Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Click on `npm-intel-embeddings@...`
3. Go to **"Keys"** tab
4. Click **"Add Key"** → **"Create new key"**
5. Choose **JSON** format
6. Click **"Create"**
7. Save the downloaded JSON file (e.g., `npm-intel-sa-key.json`)

### Via gcloud CLI

```bash
# Create and download key
gcloud iam service-accounts keys create ~/npm-intel-sa-key.json \
  --iam-account=npm-intel-embeddings@npm-intel-mvp.iam.gserviceaccount.com

# Show key location
echo "Key saved to: ~/npm-intel-sa-key.json"
```

**⚠️ IMPORTANT:** This JSON file contains sensitive credentials. Never commit it to git!

---

## Step 5: Configure Environment Variables

### Option A: Use Service Account JSON Path

```bash
# In your .env file
USE_VERTEX_AI=true
GCP_PROJECT_ID=npm-intel-mvp-123456
GCP_REGION=us-central1
VERTEX_AI_SERVICE_ACCOUNT_PATH=/path/to/npm-intel-sa-key.json

# Elasticsearch config
ELASTIC_ENDPOINT=https://your-elasticsearch...
ELASTIC_API_KEY=your-api-key
```

### Option B: Use Service Account JSON Content (Inline)

Read the JSON file content and set it as a single-line string:

```bash
# Read the JSON file (macOS/Linux)
cat ~/npm-intel-sa-key.json | jq -c . | pbcopy

# Or without jq
cat ~/npm-intel-sa-key.json | tr -d '\n' | pbcopy

# Then paste into .env
VERTEX_AI_API_KEY='{"type":"service_account","project_id":"npm-intel-mvp-123456",...}'
```

### Complete .env Example

```env
# Elasticsearch Configuration
ELASTIC_ENDPOINT=https://my-project.es.us-central1.gcp.elastic.cloud:443
ELASTIC_API_KEY=your-elastic-api-key-here

# Google Vertex AI Configuration (RECOMMENDED)
USE_VERTEX_AI=true
GCP_PROJECT_ID=npm-intel-mvp-123456
GCP_REGION=us-central1
VERTEX_AI_API_KEY={"type":"service_account","project_id":"npm-intel-mvp-123456",...}

# Optional: Server Configuration
PORT=3000
NODE_ENV=development
```

---

## Step 6: Verify Setup

Run the setup scripts:

```bash
# Clean up old inference endpoint
npm run cleanup

# Create Vertex AI inference endpoint
npm run setup:inference

# Expected output:
# ✨ Using Google Vertex AI
#    Project: npm-intel-mvp-123456
#    Region: us-central1
#    Model: gemini-embedding-001
# ✅ Successfully created Gemini inference endpoint!
# ✅ Inference endpoint is working!
#    Generated embedding with 768 dimensions
```

---

## Available Regions

Choose the region closest to your users:

| Region | Location | Code |
|--------|----------|------|
| **us-central1** | Iowa, USA | `us-central1` (default) |
| us-east1 | South Carolina, USA | `us-east1` |
| us-west1 | Oregon, USA | `us-west1` |
| europe-west1 | Belgium | `europe-west1` |
| europe-west4 | Netherlands | `europe-west4` |
| asia-southeast1 | Singapore | `asia-southeast1` |

**Recommendation:** Use `us-central1` for best availability and lowest latency in North America.

---

## Cost Estimation (MVP)

### Free Tier (First 2 months)

- **Vertex AI Embeddings**: First 1M characters/month FREE
- **After free tier**: ~$0.025 per 1,000 characters

### Our MVP Usage

```
15 packages × ~10KB README each = ~150KB text
= ~150,000 characters

Cost: $0 (well within free tier) ✅
```

Even with testing/iterations: **< $1 for entire hackathon!**

---

## Troubleshooting

### Error: "Vertex AI API is not enabled"

**Solution:**
```bash
gcloud services enable aiplatform.googleapis.com
```

Wait 30-60 seconds and retry.

---

### Error: "Permission denied" or "403 Forbidden"

**Solution:** Check service account roles:

```bash
# View current roles
gcloud projects get-iam-policy npm-intel-mvp \
  --flatten="bindings[].members" \
  --filter="bindings.members:npm-intel-embeddings@*"

# Grant Vertex AI User role
gcloud projects add-iam-policy-binding npm-intel-mvp \
  --member="serviceAccount:npm-intel-embeddings@npm-intel-mvp.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

---

### Error: "Service account key not found"

**Solution:** Verify the JSON file path:

```bash
# Check file exists
ls -la ~/npm-intel-sa-key.json

# Verify it's valid JSON
cat ~/npm-intel-sa-key.json | jq .

# Check .env has correct path
cat .env | grep VERTEX_AI
```

---

### Error: "Invalid service account JSON"

**Solution:** Ensure JSON is properly formatted in .env:

```bash
# Bad (multiline - won't work in .env)
VERTEX_AI_API_KEY={
  "type": "service_account",
  ...
}

# Good (single line, escaped quotes if needed)
VERTEX_AI_API_KEY='{"type":"service_account","project_id":"...",...}'
```

---

## Switching from AI Studio to Vertex AI

If you already set up with AI Studio:

```bash
# 1. Clean up old setup
npm run cleanup

# 2. Update .env
#    - Set USE_VERTEX_AI=true
#    - Add GCP_PROJECT_ID, GCP_REGION, VERTEX_AI_API_KEY
#    - Remove or comment out GEMINI_API_KEY

# 3. Re-run setup
npm run setup:inference
npm run setup:index
npm run ingest
```

---

## Verification Checklist

- [ ] Google Cloud project created
- [ ] Vertex AI API enabled
- [ ] Service account created with Vertex AI User role
- [ ] Service account JSON key downloaded
- [ ] `.env` file updated with GCP credentials
- [ ] `npm run setup:inference` succeeds
- [ ] Output shows "Using Google Vertex AI"
- [ ] Output shows "Model: gemini-embedding-001"
- [ ] Test embedding has 768 dimensions

---

## Security Best Practices

### ✅ DO

- Store service account JSON outside of project directory
- Use environment variables for credentials
- Add service account JSON path to `.gitignore`
- Rotate keys periodically (every 90 days)
- Use least-privilege roles (Vertex AI User, not Owner)

### ❌ DON'T

- Commit service account JSON to git
- Share service account keys publicly
- Use production credentials for development
- Grant overly permissive roles
- Hardcode credentials in source code

---

## Quick Reference Commands

```bash
# List projects
gcloud projects list

# Set active project
gcloud config set project npm-intel-mvp

# Check enabled APIs
gcloud services list --enabled

# List service accounts
gcloud iam service-accounts list

# Test Vertex AI access
gcloud ai models list --region=us-central1
```

---

## Resources

- [Vertex AI Documentation](https://cloud.google.com/vertex-ai/docs)
- [Vertex AI Embeddings API](https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-text-embeddings)
- [Elasticsearch Vertex AI Integration](https://www.elastic.co/guide/en/elasticsearch/reference/current/infer-service-google-vertex-ai.html)
- [Google Cloud Free Tier](https://cloud.google.com/free)
- [Service Account Best Practices](https://cloud.google.com/iam/docs/best-practices-service-accounts)

---

## Support

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section above
2. Verify all prerequisites are met
3. Review error messages in `npm run setup:inference` output
4. Check Google Cloud Console for quota/billing issues

---

**Ready to proceed?** Once Vertex AI is set up, you'll have the latest `gemini-embedding-001` model working with Elasticsearch! 🚀