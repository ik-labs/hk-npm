import type { PackageName } from "./packages";
import type { PackageDocument } from "./fetch-package";

const PACKAGE_PRESETS: Partial<Record<PackageName, string[]>> = {
  "@composio/client": [
    "Create a client and execute a tool",
    "Handle API errors with Composio.APIError",
    "Upload a file using the multipart helpers",
  ],
  "@composio/core": ["Register a tool and trigger an agent workflow"],
  "@trigger.dev/sdk": [
    "Create a Trigger.dev job with retries",
    "Use Trigger.dev SDK to schedule a recurring task",
  ],
  "@upstash/ratelimit": ["Build a Cloudflare Worker using Upstash rate limiting"],
  "@upstash/redis": ["Use the Upstash Redis client in a serverless function"],
  "@planetscale/database": ["Query PlanetScale using the fetch-compatible client"],
  "zod": ["Create a Zod schema and parse data", "Infer TypeScript types from a Zod schema"],
  "oslo": ["Validate OAuth2 tokens using Oslo"],
};

const symbolPrompt = (pkg: string, symbol: string) =>
  `Show me how to use ${symbol} from ${pkg}.`;

const keywordPrompt = (pkg: string, keyword: string) =>
  `Generate a ${keyword} example using ${pkg}.`;

export function buildPresets(doc: PackageDocument): string[] {
  const prompts: string[] = [];
  const add = (value?: string) => {
    if (!value) return;
    if (!prompts.includes(value)) {
      prompts.push(value);
    }
  };

  const curated = PACKAGE_PRESETS[doc.name as PackageName];
  curated?.forEach((preset) => add(preset));

  // Handle keywords as either array or string (split by comma/space if string)\n  const keywords = Array.isArray(doc.keywords)\n    ? doc.keywords\n    : typeof doc.keywords === 'string'\n    ? doc.keywords.split(/[, ]+/).filter(Boolean)\n    : [];\n\n  keywords.slice(0, 3).forEach((keyword) => add(keywordPrompt(doc.name, keyword)));

  doc.context
    ?.filter((symbol) => symbol.is_exported)
    .slice(0, 3)
    .forEach((symbol) => add(symbolPrompt(doc.name, symbol.name)));

  if (prompts.length < 3) {
    [
      `Show me basic initialisation for ${doc.name}.`,
      `Generate an example with retries using ${doc.name}.`,
      `Demonstrate error handling in ${doc.name}.`,
    ].forEach((fallback) => add(fallback));
  }

  return prompts.slice(0, 5);
}
