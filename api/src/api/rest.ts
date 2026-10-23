import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import type { Access, Auth } from "../auth/guard";
import type { GraphDb } from "../db/neo4j";
import { errorBodySchema } from "../errors";
import type { NodeService } from "../graph/NodeService";
import type { IngestService } from "../ingest/IngestService";
import type { QueryService } from "../query/QueryService";
import { QUERY_CONTRACT_VERSION } from "../query/contract";
import { authRoutes } from "./auth";
import { ingestRoutes } from "./ingest";
import { nodeRoutes } from "./nodes";
import { queryRoutes } from "./queries";
import { schemaRoutes } from "./schema";

/**
 * Versão do REST: o caminho das rotas (`/v1/...`), o formato dos erros e a forma de cada pedido. Muda com a mesma
 * política do contrato das consultas: compatível fica na mesma versão; quebra é `/v2`, e o `/v1` continua servido
 * por um tempo. Saúde (`/health`) e MCP (`/mcp`, que tem versão de protocolo própria) ficam fora do prefixo.
 */
export const API_PREFIX = "/v1";

export const openApiInfo = {
  info: {
    title: "panorama-graph-api",
    description:
      "Grafo da arquitetura e da estrutura organizacional, com proveniência em cada fato. " +
      `Contrato das consultas: versão ${QUERY_CONTRACT_VERSION} (GET ${API_PREFIX}/queries). ` +
      "Todo erro vem no esquema Error: error (mensagem), code (estável), status e details. " +
      "Autenticação: sem SSO configurado, a instância é anônima; com SSO, o navegador usa a sessão (cookie, login em " +
      `GET ${API_PREFIX}/auth/login) e as máquinas mandam Authorization: Bearer (token de ingestão ou JWT de um emissor confiável).`,
    version: "0.1.0",
  },
  components: {
    securitySchemes: {
      bearer: { type: "http" as const, scheme: "bearer", description: "Token de ingestão ou JWT de um emissor confiável (JWT_ISSUERS)" },
      session: { type: "apiKey" as const, in: "cookie", name: "pg_session", description: "Sessão do login por SSO" },
    },
  },
  // O objeto vazio: no modo anônimo, nada é exigido.
  security: [{ bearer: [] }, { session: [] }, {}] as Record<string, string[]>[],
};

const successSchema = z.unknown().describe("Sucesso");

export type RestDeps = {
  ingest: IngestService;
  nodes: NodeService;
  queries: QueryService;
  db: GraphDb;
  auth: Auth;
  logger: Logger;
};

/** As rotas do REST, sem prefixo: o app as registra em `/v1`. */
export function restApi({ ingest, nodes, queries, db, auth, logger }: RestDeps): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    // Toda rota documenta o formato único dos erros. O corpo do sucesso fica sem esquema no Fastify (a resposta não é
    // validada nem filtrada em produção); o tipo dele entra no documento OpenAPI por `openApiTransformObject`.
    app.addHook("onRoute", (route) => {
      route.schema = {
        ...route.schema,
        response: { "2XX": successSchema, ...(route.schema?.response as object), "4XX": errorBodySchema, "5XX": errorBodySchema },
      };
    });
    await app.register(authRoutes(auth, logger));
    await app.register(schemaRoutes());
    await app.register(withAccess("write", ingestRoutes(ingest), nodeRoutes(nodes)));
    await app.register(queryRoutes(queries, db));
  };
}

/** Marca o acesso de todas as rotas dos plugins (`config.access`), que o guarda da autenticação confere. */
function withAccess(access: Access, ...plugins: FastifyPluginAsync[]): FastifyPluginAsync {
  return async (app) => {
    app.addHook("onRoute", (route) => {
      route.config = { ...route.config, access };
    });
    for (const plugin of plugins) await app.register(plugin);
  };
}
