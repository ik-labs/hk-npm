import type { FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/env.js";

export function createAuthHook(config: AppConfig) {
  const secret = config.apiTokenSecret;

  if (!secret) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("⚠️  MCP API_TOKEN_SECRET not set; authentication disabled");
    }
    const noop = async () => {
      /* auth disabled */
    };
    return noop;
  }

  return async function authHook(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    const apiKeyHeader = request.headers["x-api-key"];

    let token: string | undefined;

    if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
      token = header.slice(7).trim();
    } else if (typeof apiKeyHeader === "string") {
      token = apiKeyHeader.trim();
    }

    if (!token || token !== secret) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
  };
}
