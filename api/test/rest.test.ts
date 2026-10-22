import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { currentOpenApi, openApiPath } from "../scripts/openapi";
import { K, loadAcme } from "./fixtures/acme";
import { createTestDb, resetDatabase, silentLogger } from "./setup";

const db = createTestDb();
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ db, logger: silentLogger });
  await resetDatabase(db);
  await loadAcme(async (method, url, payload) => {
    const res = await app.inject({ method, url, payload: payload as Record<string, unknown> });
    return { statusCode: res.statusCode, body: res.body };
  });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

type ErrorBody = { error: string; code: string; status: number; details?: Record<string, unknown> };

describe("REST /v1", () => {
  test("erros no formato único: error, code, status e details", async () => {
    const invalid = await app.inject({ method: "POST", url: "/v1/queries/component_dependencies", payload: { component: K.pca, depth: 9 } });
    expect(invalid.statusCode).toBe(400);
    const body = invalid.json<ErrorBody>();
    expect(body).toMatchObject({ code: "invalid_request", status: 400 });
    expect(body.details?.validation).toBeDefined();

    const ambiguous = await app.inject({ method: "POST", url: "/v1/queries/node_get", payload: { node: "credito" } });
    expect(ambiguous.statusCode).toBe(409);
    const amb = ambiguous.json<ErrorBody>();
    expect(amb.code).toBe("ambiguous");
    expect(amb.details?.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ key: K.domain })]));
    expect(amb).not.toHaveProperty("candidates");

    const route = await app.inject({ method: "GET", url: "/v1/nao-existe" });
    expect(route.statusCode).toBe(404);
    expect(route.json<ErrorBody>()).toEqual({ error: "Rota GET /v1/nao-existe não encontrada", code: "not_found", status: 404 });
  });

  test("rota sem o prefixo de versão não existe", async () => {
    const res = await app.inject({ method: "POST", url: "/queries/component_get", payload: { component: K.pca } });
    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().code).toBe("not_found");
    expect((await app.inject({ method: "GET", url: "/schema" })).statusCode).toBe(404);
  });

  test("OpenAPI servido em /v1/openapi.json, só com as rotas versionadas, igual ao snapshot", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{ paths: Record<string, Record<string, { responses: Record<string, unknown> }>>; components: { schemas: object } }>();
    const paths = Object.keys(doc.paths);
    expect(paths).toContain("/v1/queries/people_list");
    expect(paths).toContain("/v1/ingest");
    expect(paths.filter((p) => !p.startsWith("/v1/") && p !== "/mcp" && !p.startsWith("/health"))).toEqual([]);
    expect(doc.components.schemas).toHaveProperty("Error");
    expect(doc.paths["/v1/ingest"].post.responses["4XX"]).toEqual({
      description: "Erro",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    });

    // Toda rota versionada tem o corpo e a resposta tipados, com nome em components.schemas (src/api/openapi.ts).
    type Op = { requestBody?: { content: Record<string, { schema: { $ref?: string } }> }; responses: Record<string, { content?: Record<string, { schema: { $ref?: string } }> }> };
    for (const [path, methods] of Object.entries(doc.paths as unknown as Record<string, Record<string, Op>>)) {
      if (!path.startsWith("/v1/")) continue;
      for (const [method, op] of Object.entries(methods)) {
        const untyped = (s?: { $ref?: string }) => !s?.$ref;
        if (op.requestBody && untyped(op.requestBody.content["application/json"].schema)) throw new Error(`${method} ${path}: corpo sem tipo`);
        if (untyped(op.responses["2XX"]?.content?.["application/json"].schema)) throw new Error(`${method} ${path}: resposta sem tipo`);
      }
    }

    // Rotas mudaram e o snapshot não: rode `bun run openapi:write`.
    expect(JSON.parse(readFileSync(openApiPath, "utf8"))).toEqual(await currentOpenApi());
  });
});
