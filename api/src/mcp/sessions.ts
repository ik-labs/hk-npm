import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ZodTypeProvider } from "fastify-type-provider-zod";

import { packageResourceId } from "@npm-intel/shared/mcp";

export async function registerSessionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/mcp/sessions.create",
    {
      schema: {
        body: z.object({
          resourceId: packageResourceId,
          userId: z.string().min(1),
        }),
        response: {
          200: z.object({
            sessionId: z.string(),
            resourceId: packageResourceId,
            userId: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      return reply.send({
        sessionId: randomUUID(),
        resourceId: request.body.resourceId,
        userId: request.body.userId,
      });
    },
  );
}
