import { afterAll, describe, expect, test } from "vitest";
import { buildApp } from "../src/app";
import { createTestDb, silentLogger } from "./setup";

const db = createTestDb();
afterAll(() => db.close());

describe("GET /schema", () => {
  test("lista tipos, pares e regras de proveniência", async () => {
    const app = await buildApp({ db, logger: silentLogger, docs: true });
    const res = await app.inject({ method: "GET", url: "/v1/schema" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      modelVersion: number;
      nodeTypes: { type: string; prefix: string }[];
      relationTypes: { type: string; pairs: { from: string; to: string }[]; identityProps: string[] }[];
    }>();
    expect(body.modelVersion).toBe(12);
    expect(body.nodeTypes.find((t) => t.type === "Component")?.prefix).toBe("component");
    expect(body.nodeTypes.some((t) => t.type === "Module")).toBe(false);
    const consumes = body.relationTypes.find((t) => t.type === "CONSUMES");
    expect(consumes?.pairs).toEqual([{ from: "Component", to: "Api" }]);
    expect(body.relationTypes.find((t) => t.type === "ROUTES")?.identityProps).toEqual(["host", "path"]);
    expect(body.relationTypes.find((t) => t.type === "IN_ENVIRONMENT")?.pairs).toEqual([{ from: "Resource", to: "Environment" }]);
    const deployed = body.relationTypes.find((t) => t.type === "DEPLOYED_IN");
    expect(deployed?.pairs).toEqual([{ from: "Component", to: "Environment" }]);
    expect(deployed?.identityProps).toEqual(["commit"]);

    expect((await app.inject({ method: "GET", url: "/docs/json" })).statusCode).toBe(200);
    await app.close();
  });
});
