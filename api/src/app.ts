import fastify, { type FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Logger } from "pino";
import { ZodError } from "zod";
import type { GraphDb } from "./db/neo4j";
import type { AuthConfig } from "./auth/config";
import { Auth, installAuth } from "./auth/guard";
import { ApiError, errorBody } from "./errors";
import { healthRoutes } from "./api/health";
import { openApiTransformObject } from "./api/openapi";
import { API_PREFIX, openApiInfo, restApi } from "./api/rest";
import { IngestService } from "./ingest/IngestService";
import { NodeService } from "./graph/NodeService";
import { QueryService } from "./query/QueryService";
import { mcpRoutes } from "./mcp/route";

export type AppDeps = {
  db: GraphDb;
  logger: Logger;
  docs?: boolean;
  /** Origens que podem chamar as consultas REST do navegador (CORS). Vazio: nenhuma. */
  corsOrigins?: string[];
  /** Sem SSO, a instância roda no modo anônimo. */
  auth?: AuthConfig;
};

/** Monta a aplicação sem abrir porta: o main escuta, os testes usam inject(). */
export async function buildApp({ db, logger, docs = false, corsOrigins = [], auth: authConfig = {} }: AppDeps): Promise<FastifyInstance> {
  const app = fastify({
    logger: false,
    disableRequestLogging: true,
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 20 * 1024 * 1024, // retratos grandes (SBOM de muitos componentes)
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook("onResponse", (req, reply, done) => {
    logger.info(
      {
        reqId: req.id,
        method: req.method,
        url: req.url,
        status: reply.statusCode,
        ms: reply.elapsedTime.toFixed(2),
        ...(req.identity ? { who: req.identity.subject } : {}),
      },
      "http.request",
    );
    done();
  });

  app.setErrorHandler((err, req, reply) => {
    const zod = err instanceof ZodError ? err : null;
    const status = err.validation || zod ? 400 : (err.statusCode ?? 500);
    if (status >= 500) logger.error({ reqId: req.id, err, method: req.method, url: req.url }, "http.request.error");
    const details: Record<string, unknown> = err instanceof ApiError ? { ...err.details } : {};
    if (err.validation) details.validation = err.validation;
    if (zod) details.validation = zod.issues;
    const message = zod
      ? `Pedido inválido: ${zod.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ")}`
      : status >= 500 && !(err instanceof ApiError)
        ? "Erro interno"
        : err.message || "Erro";
    reply.status(status).send(errorBody(status, message, err instanceof ApiError ? err.code : undefined, details));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(errorBody(404, `Rota ${req.method} ${req.url.split("?")[0]} não encontrada`));
  });

  const auth = new Auth(authConfig, corsOrigins);
  installAuth(app, auth);

  // O OpenAPI é sempre servido (GET /v1/openapi.json); a tela do Swagger, só com docs.
  await app.register(fastifySwagger, { openapi: openApiInfo, transform: jsonSchemaTransform, transformObject: openApiTransformObject() });
  if (docs) await app.register(fastifySwaggerUi, { routePrefix: "/docs" });

  await app.register(healthRoutes(db));
  const queries = new QueryService(db);
  await app.register(restApi({ ingest: new IngestService(db), nodes: new NodeService(db), queries, db, auth, logger }), {
    prefix: API_PREFIX,
  });
  await app.register(mcpRoutes(queries, db, logger));
  app.get(`${API_PREFIX}/openapi.json`, { config: { access: "public" }, schema: { hide: true } }, async () => app.swagger());
  return app;
}
