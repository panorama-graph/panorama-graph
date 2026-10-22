import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { NodeService } from "../graph/NodeService";

export const aliasBodySchema = z.object({ alias: z.string().min(1), reason: z.string().optional() }).strict();

export const mergeBodySchema = z
  .object({
    from: z.string().min(1).describe("Nó que deixa de existir e vira apelido"),
    into: z.string().min(1).describe("Nó que permanece"),
    reason: z.string().min(1),
    actor: z.string().min(1).describe("Quem pediu a união"),
  })
  .strict();

export function nodeRoutes(nodes: NodeService) {
  return async (fastify: FastifyInstance) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/nodes/:key/aliases",
      {
        schema: {
          tags: ["identidade"],
          summary: "Registra um apelido para o nó (chave URL-encoded)",
          params: z.object({ key: z.string().min(1) }),
          body: aliasBodySchema,
        },
      },
      async (req, reply) => {
        const res = await nodes.addAlias(req.params.key, req.body.alias, req.body.reason);
        return reply.code(res.created ? 201 : 200).send(res);
      },
    );

    app.post(
      "/nodes/merge",
      {
        schema: {
          tags: ["identidade"],
          summary: "Une dois nós do mesmo tipo (auditado)",
          body: mergeBodySchema,
        },
      },
      async (req) => nodes.merge(req.body.from, req.body.into, req.body.reason, req.body.actor),
    );
  };
}
