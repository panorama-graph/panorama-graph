import type { FastifyInstance } from "fastify";
import { describeModel } from "../model/describe";
import { QUERY_CONTRACT_VERSION } from "../query/contract";

export function schemaRoutes() {
  return async (app: FastifyInstance) => {
    app.get("/schema", { schema: { tags: ["modelo"], summary: "Tipos de nó e de relação, pares válidos e chaves" } }, async () => ({
      ...describeModel(),
      // O contrato das consultas tem versão própria, detalhada em GET /queries.
      queryContractVersion: QUERY_CONTRACT_VERSION,
    }));
  };
}
