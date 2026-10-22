import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { sdkModel, sdkModelPath, sdkTypes, sdkTypesPath } from "../scripts/sdk";
import { PanoramaGraphClient, PanoramaGraphError, type FetchLike } from "@panorama-graph/sdk";
import { buildApp } from "../src/app";
import { K, loadAcme } from "./fixtures/acme";
import { createTestDb, resetDatabase, silentLogger } from "./setup";

const db = createTestDb();
let app: FastifyInstance;
let client: PanoramaGraphClient;

beforeAll(async () => {
  app = await buildApp({ db, logger: silentLogger });
  await resetDatabase(db);
  await loadAcme(async (method, url, payload) => {
    const res = await app.inject({ method, url, payload: payload as Record<string, unknown> });
    return { statusCode: res.statusCode, body: res.body };
  });
  // O cliente do SDK falando com esta API, sem abrir porta.
  const viaInject: FetchLike = async (url, init) => {
    const { pathname, search } = new URL(url);
    const res = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST",
      url: pathname + search,
      headers: init?.headers as Record<string, string>,
      payload: init?.body as string | undefined,
    });
    return new Response(res.body, { status: res.statusCode });
  };
  client = new PanoramaGraphClient({ baseUrl: "http://grafo", fetch: viaInject });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe("SDK", () => {
  test("os arquivos gerados são os do contrato atual (rode bun run openapi:write && bun run sdk:generate)", async () => {
    expect(readFileSync(sdkTypesPath, "utf8")).toBe(await sdkTypes());
    expect(readFileSync(sdkModelPath, "utf8")).toBe(sdkModel());
  });

  test("o cliente consulta, confere o modelo e devolve os erros com o código da API", async () => {
    await client.assertModel();
    const consumers = await client.query("api_consumers", { target: K.pca, endpoint: "GET /products/{id}" });
    expect(consumers.endpoint).toBe(K.epGetOne);
    expect(consumers.consumers.map((c) => c.component.key)).toContain(K.lsa);
    expect((await client.queryContract()).tools.length).toBeGreaterThan(10);

    const missing = await client.query("component_get", { component: "component:nao-existe" }).catch((e) => e);
    expect(missing).toBeInstanceOf(PanoramaGraphError);
    expect(missing).toMatchObject({ code: "not_found", status: 404 });
    const ambiguous = await client.query("node_get", { node: "credito" }).catch((e) => e);
    expect(ambiguous.code).toBe("ambiguous");
    expect(ambiguous.details.candidates.length).toBeGreaterThan(1);
  });
});
