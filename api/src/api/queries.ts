import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { GraphDb } from "../db/neo4j";
import { ApiError } from "../errors";
import type { QueryService } from "../query/QueryService";
import { CONTRACT_POLICY, QUERY_CONTRACT_VERSION, toolContract } from "../query/contract";
import { queryTools, runQueryTool, toolDescription } from "../query/tools";

/**
 * Consultas por REST: `POST /v1/queries/<ferramenta>`, com o corpo igual aos argumentos da ferramenta MCP de mesmo
 * nome e a mesma resposta (o JSON que o MCP põe no texto). Erro de domínio volta com o status HTTP (404, 409, 422)
 * e o mesmo corpo de erro do MCP.
 *
 * `GET /v1/queries` devolve o contrato das consultas (versão, política e as ferramentas com os argumentos). Toda
 * resposta traz `Query-Contract-Version`; a de uma ferramenta obsoleta traz também `Deprecation` e o `Link`
 * para a substituta.
 *
 * CORS só nestas rotas, para as origens de `corsOrigins` (ex.: uma tela que mostra a consulta citada por um
 * agente). Ingestão e MCP continuam sem CORS.
 */
export function queryRoutes(queries: QueryService, db: GraphDb, corsOrigins: string[] = []) {
  return async (fastify: FastifyInstance) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const allowed = new Set(corsOrigins);

    app.addHook("onRequest", async (req, reply) => {
      const origin = req.headers.origin;
      reply.header("vary", "Origin");
      if (origin && allowed.has(origin)) {
        reply.header("access-control-allow-origin", origin);
        reply.header("access-control-expose-headers", "query-contract-version, deprecation, link");
      }
      reply.header("query-contract-version", String(QUERY_CONTRACT_VERSION));
    });

    app.options("/queries/:tool", { schema: { hide: true } }, async (req, reply) => {
      if (!reply.getHeader("access-control-allow-origin")) throw new ApiError(403, "Origem não permitida");
      return reply
        .code(204)
        .header("access-control-allow-methods", "POST")
        .header("access-control-allow-headers", "content-type")
        .header("access-control-max-age", "600")
        .send();
    });

    const tools = queryTools(queries, db);

    app.get("/queries", { schema: { tags: ["consulta"], summary: "Contrato das consultas: versão, política e ferramentas" } }, async () => ({
      version: QUERY_CONTRACT_VERSION,
      policy: CONTRACT_POLICY,
      tools: tools.map((t) => ({ ...toolContract(t), description: toolDescription(t) })),
    }));

    for (const tool of tools) {
      app.post(
        `/queries/${tool.name}`,
        {
          schema: {
            tags: ["consulta"],
            summary: `Mesma consulta da ferramenta MCP ${tool.name}`,
            description: toolDescription(tool),
            ...(tool.deprecated ? { deprecated: true } : {}),
            // Sem corpo, o Fastify entrega null: vale como "sem argumentos", como no MCP.
            body: z.preprocess((b) => b ?? {}, z.object(tool.inputSchema).strict()),
          },
        },
        async (req, reply) => {
          if (tool.deprecated) {
            reply.header("deprecation", "true").header("link", `<${fastify.prefix}/queries/${tool.deprecated.use}>; rel="successor-version"`);
          }
          return runQueryTool(tool, req.body as Record<string, unknown>);
        },
      );
    }

    // Ferramenta que não existe (ou que já saiu do contrato): 404 que diz isso, e não o "rota não encontrada".
    app.post("/queries/:tool", { schema: { hide: true } }, async (req) => {
      const { tool } = req.params as { tool: string };
        throw new ApiError(
        404,
        `A ferramenta ${tool} não existe na versão ${QUERY_CONTRACT_VERSION} do contrato das consultas`,
        { contractVersion: QUERY_CONTRACT_VERSION },
        "unknown_tool",
      );
    });
  };
}
