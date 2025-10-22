import type { Client } from "@elastic/elasticsearch";
import type { GenerativeModel } from "@google/generative-ai";

type ElasticDoc = {
  name: string;
  version: string;
  description?: string;
  readme_content?: unknown;
  code_examples?: unknown;
  exports?: Array<{
    kind: string;
    name: string;
    signature?: string;
    jsdoc?: string;
  }>;
};

export interface AnswerRequest {
  intent: string;
  packageName: string;
  searchQuery?: string;
  maxSnippets?: number;
}

export interface AnswerResponse {
  intent: string;
  packageName: string;
  searchQuery: string;
  code: string;
  context: Array<{
    name: string;
    kind: string;
    file_path: string;
    jsdoc?: string;
    signature?: string;
    is_exported: boolean;
  }>;
  grounded: boolean;
  note?: string;
}

export type SymbolMatch = {
  name: string;
  kind: string;
  file_path: string;
  snippet: string;
  is_exported: boolean;
  relevance_score?: number;
  implementation?: string;
  jsdoc?: string;
  signature?: string;
};

export interface AnswerServiceOptions {
  esClient: Client;
  indexName: string;
  generativeModel?: GenerativeModel | null;
  generativeModels?: GenerativeModel[];
  maxRetries?: number;
  allowUngroundedFallback?: boolean;
}

export function extractTextField(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === "string" ? part : extractTextField(part)))
      .join("\n");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (Array.isArray(obj.chunks)) {
      return (obj.chunks as Array<{ text?: string }>).map((chunk) => chunk.text || "").join("\n");
    }
  }
  return "";
}

export async function fetchSymbolContext({
  esClient,
  indexName,
  docId,
  query,
  maxSnippets,
}: {
  esClient: Client;
  indexName: string;
  docId: string;
  query: string;
  maxSnippets: number;
}): Promise<SymbolMatch[]> {
  const response = await esClient.search({
    index: indexName,
    size: 1,
    query: {
      bool: {
        must: [
          {
            ids: {
              values: [docId],
            },
          },
        ],
        should: [
          {
            nested: {
              path: "symbols",
              query: {
                multi_match: {
                  query,
                  fields: [
                    "symbols.name^3",
                    "symbols.implementation^2",
                    "symbols.signature",
                    "symbols.jsdoc",
                  ],
                },
              },
              inner_hits: {
                size: maxSnippets,
                _source: [
                  "symbols.name",
                  "symbols.kind",
                  "symbols.file_path",
                  "symbols.implementation",
                  "symbols.is_exported",
                  "symbols.relevance_score",
                  "symbols.jsdoc",
                  "symbols.signature",
                ],
              },
            },
          },
        ],
      },
    },
    _source: false,
  } as any);

  const innerHits =
    (response as any).hits.hits?.[0]?.inner_hits?.symbols?.hits?.hits ??
    [];

  if (innerHits.length > 0) {
    return innerHits.map((symbol: any) => ({
      name: symbol._source.name,
      kind: symbol._source.kind,
      file_path: symbol._source.file_path,
      snippet: (symbol._source.implementation || "").slice(0, 160),
      is_exported: symbol._source.is_exported,
      relevance_score: symbol._source.relevance_score,
      implementation: symbol._source.implementation,
      jsdoc: symbol._source.jsdoc,
      signature: symbol._source.signature,
    }));
  }

  try {
    const doc = await esClient.get({
      index: indexName,
      id: docId,
      _source_includes: ["symbols"],
    });

    const symbols = ((doc as any)?._source?.symbols || []) as any[];
    return symbols
      .slice(0, maxSnippets)
      .map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        file_path: symbol.file_path,
        snippet: (symbol.implementation || "").slice(0, 160),
        is_exported: symbol.is_exported,
        relevance_score: symbol.relevance_score,
        implementation: symbol.implementation,
        jsdoc: symbol.jsdoc,
        signature: symbol.signature,
      }));
  } catch {
    return [];
  }
}

async function findRelevantCode(
  esClient: Client,
  indexName: string,
  packageName: string,
  query: string,
  maxSnippets: number,
): Promise<
  | {
      source: ElasticDoc;
      symbols: SymbolMatch[];
      readme: string;
      codeExamples: string;
      exports: ElasticDoc["exports"];
    }
  | null
> {
  const response = await esClient.search({
    index: indexName,
    size: 1,
    query: {
      bool: {
        must: [
          {
            match: {
              name: packageName,
            },
          },
        ],
        should: [
          {
            nested: {
              path: "symbols",
              query: {
                multi_match: {
                  query,
                  fields: [
                    "symbols.name^3",
                    "symbols.implementation^2",
                    "symbols.signature",
                    "symbols.jsdoc",
                  ],
                },
              },
              inner_hits: {
                size: maxSnippets,
                _source: [
                  "symbols.name",
                  "symbols.kind",
                  "symbols.file_path",
                  "symbols.jsdoc",
                  "symbols.signature",
                  "symbols.implementation",
                  "symbols.is_exported",
                ],
              },
            },
          },
          {
            semantic: {
              field: "source_code_content",
              query,
            },
          },
        ],
      },
    },
    _source: ["name", "version", "description", "readme_content", "code_examples", "exports"],
  } as any);

  const hit = (response as any).hits.hits?.[0];
  if (!hit) {
    return null;
  }

  let symbols = (hit.inner_hits?.symbols?.hits?.hits ?? []).map((inner: any) => ({
    name: inner._source.name,
    kind: inner._source.kind,
    file_path: inner._source.file_path,
    snippet: (inner._source.implementation || "").slice(0, 160),
    is_exported: inner._source.is_exported,
    relevance_score: inner._source.relevance_score,
    implementation: inner._source.implementation,
    jsdoc: inner._source.jsdoc,
    signature: inner._source.signature,
  })) as SymbolMatch[];

  let docSource: ElasticDoc = hit._source;

  if (symbols.length === 0) {
    try {
      const doc = await esClient.get({
        index: indexName,
        id: hit._id,
        _source_includes: ["symbols", "name", "version", "description", "readme_content", "code_examples", "exports"],
      });

      const docSourceFull = (doc as any)?._source ?? {};
      docSource = docSourceFull;
      const allSymbols = (docSourceFull?.symbols || []) as any[];
      symbols = allSymbols
        .filter((symbol) => typeof symbol?.implementation === "string" && symbol.implementation.length > 0)
        .sort(
          (a, b) =>
            (b.relevance_score ?? 0) - (a.relevance_score ?? 0),
        )
        .slice(0, maxSnippets)
        .map((symbol) => ({
          name: symbol.name,
          kind: symbol.kind,
          file_path: symbol.file_path,
          snippet: (symbol.implementation || "").slice(0, 160),
          is_exported: symbol.is_exported,
          relevance_score: symbol.relevance_score,
          implementation: symbol.implementation,
          jsdoc: symbol.jsdoc,
          signature: symbol.signature,
        }));
    } catch (error) {
      console.warn("Fallback symbol fetch failed:", (error as Error).message);
    }
  }

  return {
    source: docSource,
    symbols,
    readme: extractTextField(docSource.readme_content),
    codeExamples: extractTextField(docSource.code_examples),
    exports: docSource.exports ?? [],
  };
}

export function createAnswerService(options: AnswerServiceOptions) {
  const { esClient, indexName, generativeModel, generativeModels, maxRetries = 1, allowUngroundedFallback = false } = options;

  const models: GenerativeModel[] = [];
  if (generativeModels && generativeModels.length > 0) {
    models.push(...generativeModels.filter(Boolean));
  } else if (generativeModel) {
    models.push(generativeModel);
  }

  return {
    async generateAnswer(
      payload: AnswerRequest,
    ): Promise<AnswerResponse | { error: string }> {
      if (models.length === 0) {
        return { error: "Gemini API key not configured" };
      }

      const searchQuery = payload.searchQuery?.trim() || payload.intent;
      const maxSnippets = payload.maxSnippets ?? 3;
      const context = await findRelevantCode(esClient, indexName, payload.packageName, searchQuery, maxSnippets);

      const hasGroundedContext = Boolean(context && context.symbols.length > 0);

      if (!hasGroundedContext && !allowUngroundedFallback) {
        return {
          error: `No relevant symbols found for ${payload.packageName} with query "${searchQuery}"`,
        };
      }

      const groundedContext = hasGroundedContext && context ? context : null;

      const symbolsContext = groundedContext
        ? groundedContext.symbols
        .map((symbol) => {
          const implementation = (symbol.implementation || "").slice(0, 600);
          return [
            `// ${symbol.is_exported ? "Public API" : "Internal"} ${symbol.kind} ${symbol.name}`,
            `// File: ${symbol.file_path}`,
            symbol.jsdoc || "",
            symbol.signature || "",
            implementation,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n")
        : "";

      const exportsContext = groundedContext && groundedContext.exports && groundedContext.exports.length > 0
        ? groundedContext.exports
            .slice(0, 10)
            .map(
              (ex) =>
                `${ex.kind} ${ex.name}${ex.signature ? ` — ${ex.signature}` : ""}${
                  ex.jsdoc ? `\n${ex.jsdoc}` : ""
                }`,
            )
            .join("\n\n")
        : "";

      const readmeExcerpt = groundedContext && groundedContext.readme ? groundedContext.readme.slice(0, 2000) : "";
      const codeExamples = groundedContext && groundedContext.codeExamples ? groundedContext.codeExamples.slice(0, 1200) : "";

      const prompt = groundedContext
        ? `You are a TypeScript assistant grounded in the provided context.

PACKAGE: ${groundedContext.source.name}@${groundedContext.source.version}
INTENT: ${payload.intent}

README EXCERPT:
${readmeExcerpt || "(no README data provided)"}

CODE EXAMPLES:
${codeExamples || "(no code examples provided)"}

EXPORTED API SURVEY:
${exportsContext || "(no export metadata available)"}

AVAILABLE IMPLEMENTATIONS:
${symbolsContext || "(no implementation snippets available)"}

Write a concise explanation of the approach (2-3 sentences) followed by a TypeScript example that satisfies the intent using only the APIs shown above.
If the context is insufficient, reply with "INSUFFICIENT_CONTEXT: reason".
Include brief inline comments if it clarifies the flow.`
        : `You are a TypeScript assistant.

PACKAGE: ${payload.packageName}
INTENT: ${payload.intent}

No grounded source snippets were available. Produce the best-effort TypeScript example based on your general knowledge.
1. Begin with a short explanation (2-3 sentences) describing the approach and note that the response is ungrounded.
2. Provide the TypeScript example in a code fence.
3. Add inline comments to highlight important steps.
4. Do not fabricate APIs that are very unlikely to exist; prefer idiomatic usage.`;

      let lastError: unknown;
      for (const model of models) {
        for (let attempt = 0; attempt < Math.max(1, maxRetries); attempt += 1) {
          try {
            const result = await model.generateContent(prompt);
            const answer = await result.response.text();

            return {
              intent: payload.intent,
              packageName: payload.packageName,
              searchQuery,
              code: answer.trim(),
              context: groundedContext
                ? groundedContext.symbols.map((symbol) => ({
                    name: symbol.name,
                    kind: symbol.kind,
                    file_path: symbol.file_path,
                    jsdoc: symbol.jsdoc,
                    signature: symbol.signature,
                    is_exported: symbol.is_exported,
                  }))
                : [],
              grounded: hasGroundedContext,
              note: hasGroundedContext
                ? undefined
                : "Generated without grounded context. Verify against official docs before use.",
            };
          } catch (error) {
            lastError = error;
            if (!isRetryableGeminiError(error)) {
              break;
            }
          }
        }
      }

      const message =
        lastError instanceof Error
          ? lastError.message
          : typeof lastError === "string"
          ? lastError
          : "Failed to generate answer";

      return { error: message };
    },
  };
}

function isRetryableGeminiError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("503") || message.includes("unavailable") || message.includes("overloaded");
}
