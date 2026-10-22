import { afterAll, describe, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { createTestDb, silentLogger } from "./setup";

const db = createTestDb();
const deadDb = createTestDb({ uri: "bolt://127.0.0.1:1" });

afterAll(async () => {
  await db.close();
  await deadDb.close();
});

describe("saúde", () => {
  test("GET /health responde sem banco", async () => {
    const app = await buildApp({ db: deadDb, logger: silentLogger });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>()).toEqual({ status: "ok" });
  });

  test("GET /health/ready com Neo4j disponível", async () => {
    const app = await buildApp({ db, logger: silentLogger });
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.neo4j.edition).toBe("community");
    expect(body.neo4j.database).toBe("neo4j");
  });

  test("GET /health/ready devolve 503 sem Neo4j", async () => {
    const app = await buildApp({ db: deadDb, logger: silentLogger });
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe("unavailable");
  });
});
