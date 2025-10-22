import type { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";

import type { AppConfig } from "../config/env.js";
import { registerResourceRoutes } from "./resources.js";
import { registerToolRoutes } from "./tools.js";
import { registerSessionRoutes } from "./sessions.js";
import { createAuthHook } from "./middleware.js";

export async function registerMcpRoutes(app: FastifyInstance, config: AppConfig) {
  const authHook = createAuthHook(config);
  app.addHook("onRequest", authHook);

  await app.register(async (instance) => {
    const typed = instance.withTypeProvider<ZodTypeProvider>();
    await registerResourceRoutes(typed, config);
    await registerToolRoutes(typed, config);
    await registerSessionRoutes(typed);
  });
}
