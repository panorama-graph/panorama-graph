import { describe, expect, test } from "bun:test";
import { PanoramaGraphClient, PanoramaGraphError } from "@panorama-graph/sdk";
import { ingest } from "../src/core/api";
import type { Snapshot } from "../src/core/snapshot";

const snapshot: Snapshot = { source: "sbom", scope: { component: "a/b" }, observedAt: "2026-09-29T12:00:00.000Z", nodes: [], relations: [] };

const client = (status: number, body: unknown) =>
  new PanoramaGraphClient({
    baseUrl: "http://api",
    fetch: async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  });

describe("carga pelo cliente do SDK", () => {
  test("devolve as contagens da carga", async () => {
    const counts = { nodes: { created: 1, updated: 0, unchanged: 0, stale: 0 }, relations: { created: 2, updated: 0, unchanged: 0, stale: 0 }, referenced: 0 };
    expect(await ingest(client(200, { loadId: "l", source: "sbom", scope: {}, observedAt: "x", counts }), snapshot)).toEqual({ status: "ok", counts });
  });

  test("retrato mais antigo que o da API não é erro", async () => {
    const body = { error: "retrato de 10:00 é anterior ao último", code: "outdated_snapshot", status: 409 };
    expect(await ingest(client(409, body), snapshot)).toEqual({ status: "outdated", message: "retrato de 10:00 é anterior ao último" });
  });

  test("recusa traz os erros de validação", async () => {
    const body = { error: "Carga inválida", code: "invalid_snapshot", status: 422, details: { errors: ["x"] } };
    const err = await ingest(client(422, body), snapshot).catch((e) => e);
    expect(err).toBeInstanceOf(PanoramaGraphError);
    expect(err).toMatchObject({ status: 422, code: "invalid_snapshot", details: { errors: ["x"] } });
  });
});
