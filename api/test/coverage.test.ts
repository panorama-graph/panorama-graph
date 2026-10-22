import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { briefFact, summarize } from "../src/query/brief";
import { QueryService } from "../src/query/QueryService";
import { createTestDb, resetDatabase, silentLogger } from "./setup";

// Um grafo só com o que o pipeline publica (sem ownership, gitlab, k8s): o caso real de hoje.
const db = createTestDb();
const q = new QueryService(db);
let app: FastifyInstance;
const svc = "component:acme/credito/servico";

beforeAll(async () => {
  app = await buildApp({ db, logger: silentLogger });
  await resetDatabase(db);
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    payload: {
      source: "openapi",
      scope: { component: "servico" },
      observedAt: "2026-09-29T10:00:00Z",
      evidenceBase: "servico@abc1234:build/openapi.json",
      nodes: [
        { key: svc, type: "Component", props: { name: "servico", kind: "service" } },
        { key: "api:servico/http", type: "Api", props: { kind: "http" } },
      ],
      relations: [{ type: "PROVIDES", from: svc, to: "api:servico/http" }],
    },
  });
  expect(res.statusCode).toBe(200);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe("cobertura: vazio sem fonte não é vazio de verdade", () => {
  test("org_structure vazio diz que nenhuma fonte publica a estrutura", async () => {
    const res = await q.orgStructure();
    expect(res.groups).toEqual([]);
    expect(res.coverage).toMatchObject({ sources: [] });
    expect(res.coverage!.note).toContain("Nenhuma fonte publicou");
  });

  test("componente sem dono traz a cobertura de OWNED_BY", async () => {
    const res = await q.componentGet("servico");
    expect(res.owners).toEqual([]);
    expect(res.coverage!.owners!.sources).toEqual([]);
    expect(res.data).toEqual([]);
    expect(res.coverage!.data!.note).toContain("OWNS_DATA");
    const libs = await q.componentLibraries("servico");
    expect(libs.libraries).toEqual([]);
    expect(libs.coverage!.note).toContain("DEPENDS_ON");
    const list = await q.componentsList({});
    expect(list.coverage!.owners.note).toContain("OWNED_BY");
  });

  test("a visão geral lista o que ninguém cobre", async () => {
    const res = await q.architectureOverview();
    expect(res.components.map((c) => c.key)).toEqual([svc]);
    expect(res.gaps).toHaveLength(9);
    expect(res.sources).toEqual([{ source: "openapi", scopes: 1, lastObservedAt: "2026-09-29T10:00:00.000Z" }]);
  });
});

describe("resumo das afirmações", () => {
  const fact = {
    source: "sbom",
    scope: { component: "x" },
    state: "observed",
    status: "current",
    evidence: "x@abc:build/bom.json",
    observedAt: "2026-09-29T10:00:00Z",
    firstObservedAt: "2026-09-28T10:00:00Z",
    props: { version: "1.0.0" },
  };

  test("fica fonte, evidência e props; status e state só quando fogem do comum", () => {
    expect(briefFact(fact)).toEqual({ source: "sbom", evidence: "x@abc:build/bom.json", props: { version: "1.0.0" } });
    expect(briefFact({ ...fact, status: "stale", state: "inferred" })).toMatchObject({ status: "stale", state: "inferred" });
  });

  test("resume em qualquer profundidade e não mexe no resto", () => {
    const out: unknown = summarize({ edges: [{ node: { key: "a" }, facts: { dependent: [fact], provider: [] } }], n: 1 });
    expect(out).toEqual({
      edges: [{ node: { key: "a" }, facts: { dependent: [briefFact(fact)], provider: [] } }],
      n: 1,
    });
  });
});
