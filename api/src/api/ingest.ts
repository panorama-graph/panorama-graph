import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError } from "../errors";
import type { IngestService } from "../ingest/IngestService";
import { ingestBodySchema, validateSnapshot } from "../ingest/payload";

export const retireBodySchema = z
  .object({
    scope: z
      .record(z.string())
      .refine((s) => Object.keys(s).length > 0, "escopo vazio")
      .describe("Escopo a aposentar, igual ao das cargas (ex.: { component: example/catalog/product-api })"),
    observedAt: z.string().datetime({ offset: true }).describe("Quando o que o escopo descreve deixou de existir (ISO 8601)"),
    retiredBy: z.string().min(1).max(200).describe("Quem aposenta (sistema ou pessoa, ex.: portal-interno)"),
    reason: z.string().min(1).max(1000).describe("Por que o escopo deixou de existir"),
    evidence: z.string().min(1).max(2000).describe("Onde isso está registrado (ex.: o registro da remoção no portal)"),
  })
  .strict();

export function ingestRoutes(ingest: IngestService) {
  return async (fastify: FastifyInstance) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/ingest",
      {
        schema: {
          tags: ["ingestão"],
          summary: "Carga por retrato de uma source e escopo",
          description:
            "Grava o que a fonte viu no escopo e marca como stale o que ela deixou de afirmar. " +
            "400: forma do payload; 422: fora do modelo ou sem evidência; 409: retrato mais antigo que o último do escopo.",
          body: ingestBodySchema,
        },
      },
      async (req) => {
        const v = validateSnapshot(req.body);
        if (!v.ok) throw new ApiError(422, "Carga inválida", { errors: v.errors }, "invalid_snapshot");
        return ingest.ingest(v.snapshot);
      },
    );

    app.post(
      "/scopes/retire",
      {
        schema: {
          tags: ["ingestão"],
          summary: "Aposenta um escopo em todas as fontes",
          description:
            "Para o que deixou de existir e cujas fontes não vão mais publicar (ex.: componente removido, repositório " +
            "excluído): cada fonte que carregou no escopo recebe o equivalente a um retrato vazio, e o que ela afirmava " +
            "vira stale. Grava quem aposentou, o motivo e a evidência. 404: nenhuma fonte carregou o escopo; 409: " +
            "observedAt anterior à última carga de alguma fonte do escopo.",
          body: retireBodySchema,
        },
      },
      async (req) => ingest.retire(req.body),
    );
  };
}
