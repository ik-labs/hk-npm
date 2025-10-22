export const PACKAGES = [
  "@composio/client",
  "@composio/core",
  "@trigger.dev/sdk",
  "inngest",
  "@upstash/ratelimit",
  "@upstash/redis",
  "@planetscale/database",
  "hono",
  "elysia",
  "@t3-oss/env-nextjs",
  "zod",
  "oslo",
  "@vercel/kv",
  "@effect/schema",
] as const;

export type PackageName = (typeof PACKAGES)[number];

export const slugifyPackage = (pkg: string) =>
  pkg
    .replace(/^@/, "")
    .replace(/\//g, "-")
    .replace(/[^\w-]+/g, "-");

export const packageMap = PACKAGES.reduce<Record<string, PackageName>>(
  (acc, pkg) => {
    acc[slugifyPackage(pkg)] = pkg;
    return acc;
  },
  {},
);
