import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { PanoramaGraphClient, MODEL_VERSION } from "@panorama-graph/sdk";
import type { Snapshot } from "../src/core/snapshot";
import { planPublish } from "../src/graph-publish/publish";
import { BUILD_FORMAT, createReceiver, type BuildResponse } from "../src/graph-receiver/receiver";

const fixture = (name: string) => join(import.meta.dir, "fixtures", name);
const AT = "2026-10-19T12:00:00.000Z";

/** O que o plugin Gradle envia: cada arquivo JSON de build/architecture pelo caminho relativo. */
function filesOf(dir: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".json")) out[relative(dir, path)] = JSON.parse(readFileSync(path, "utf8"));
    }
  };
  walk(dir);
  return out;
}

const counts = { nodes: { created: 1, updated: 0, unchanged: 0, stale: 0 }, relations: { created: 0, updated: 0, unchanged: 0, stale: 0 }, referenced: 0 };

/** O grafo de mentira: guarda os retratos recebidos e responde como a API. */
function graph(reply: (s: Snapshot) => { status: number; body: unknown } = () => ({ status: 200, body: { counts } })) {
  const received: Snapshot[] = [];
  const client = new PanoramaGraphClient({
    baseUrl: "http://api",
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/schema")) return Response.json({ modelVersion: MODEL_VERSION });
      const snapshot = JSON.parse(String(init?.body)) as Snapshot;
      received.push(snapshot);
      const { status, body } = reply(snapshot);
      return Response.json(body, { status });
    },
  });
  return { received, receiver: createReceiver({ client, now: () => new Date(AT) }) };
}

const post = (body: unknown, accept = "application/json") =>
  new Request("http://receiver/v1/builds", { method: "POST", headers: { "content-type": "application/json", accept }, body: JSON.stringify(body) });

describe("graph-receiver", () => {
  test("publica os mesmos retratos que o graph-publish montaria do diretório", async () => {
    const { received, receiver } = graph();
    const res = await receiver(post({ format: BUILD_FORMAT, files: filesOf(fixture("loan-simulation-api")) }));
    const body = (await res.json()) as BuildResponse;

    expect(res.status).toBe(200);
    expect(body.status).toBe("published");
    expect(received).toEqual(planPublish(fixture("loan-simulation-api"), AT, { env: {} }).snapshots);
    expect(body.snapshots.every((s) => s.result === "ok")).toBe(true);
    expect(body.snapshots.map((s) => s.source)).toContain("pact");
  });

  test("a identidade vem do pacote, nunca do ambiente do receptor", async () => {
    const before = process.env.CI_PROJECT_PATH;
    process.env.CI_PROJECT_PATH = "outro/projeto";
    try {
      const { receiver } = graph();
      const res = await receiver(post({ files: filesOf(fixture("product-catalog-api")), dryRun: true }));
      expect(((await res.json()) as BuildResponse).identity.path).toBe("acme/credito/product-catalog-api");
    } finally {
      if (before === undefined) delete process.env.CI_PROJECT_PATH;
      else process.env.CI_PROJECT_PATH = before;
    }
  });

  test("as opções do pedido passam por cima do manifesto", async () => {
    const { received, receiver } = graph();
    await receiver(post({ files: filesOf(fixture("product-catalog-api")), options: { version: "1.4.0", kind: "bff" } }));
    const manifest = received.find((s) => s.source === "build-manifest")!;
    expect(manifest.revision?.version).toBe("1.4.0");
    expect(manifest.nodes.find((n) => n.type === "Component")?.props?.kind).toBe("bff");
  });

  test("dryRun monta e confere sem gravar", async () => {
    const { received, receiver } = graph();
    const res = await receiver(post({ files: filesOf(fixture("product-catalog-api")), dryRun: true }));
    const body = (await res.json()) as BuildResponse;
    expect(res.status).toBe(200);
    expect(body.status).toBe("planned");
    expect(received).toEqual([]);
    expect(body.skipped).toEqual(["pact (pacts/)"]);
  });

  test("retrato recusado pela API volta como 422, com os detalhes", async () => {
    const { receiver } = graph((s) =>
      s.source === "sbom" ? { status: 422, body: { error: "Carga inválida", code: "invalid_snapshot", status: 422, details: { errors: ["x"] } } } : { status: 200, body: { counts } },
    );
    const res = await receiver(post({ files: filesOf(fixture("product-catalog-api")) }));
    const body = (await res.json()) as { code: string; details: BuildResponse };
    expect(res.status).toBe(422);
    expect(body.code).toBe("snapshot_rejected");
    expect(body.details.snapshots.find((s) => s.source === "sbom")).toMatchObject({ result: "rejected", details: { errors: ["x"] } });
    expect(body.details.snapshots.find((s) => s.source === "openapi")?.result).toBe("ok");
  });

  test("retrato mais antigo que o da API não é erro", async () => {
    const { receiver } = graph(() => ({ status: 409, body: { error: "anterior ao último", code: "outdated_snapshot", status: 409 } }));
    const res = await receiver(post({ files: filesOf(fixture("product-catalog-api")) }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as BuildResponse).snapshots.every((s) => s.result === "outdated")).toBe(true);
  });

  test("text/plain devolve o resumo do graph-publish", async () => {
    const { receiver } = graph();
    const res = await receiver(post({ files: filesOf(fixture("product-catalog-api")) }, "text/plain"));
    const text = await res.text();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(text).toContain("componente acme/credito/product-catalog-api");
    expect(text).toContain("openapi: nós (created 1");
  });

  test("recusa pacote sem manifesto, com caminho inválido ou com formato desconhecido", async () => {
    const { receiver } = graph();
    const files = filesOf(fixture("product-catalog-api"));
    for (const body of [
      { files: { "bom.json": {} } },
      { files: { ...files, "../etc/passwd.json": {} } },
      { files, format: "panorama-graph-build/9" },
      { files: { ...files, "manifest.json": { ...(files["manifest.json"] as object), format: "outro/1" } } },
    ]) {
      const res = await receiver(post(body));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("invalid_build");
    }
  });

  test("o esquema do pacote aceita o que o receptor lê", () => {
    const schema = JSON.parse(readFileSync(join(import.meta.dir, "..", "schemas", "build.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, validateFormats: false }).compile(schema);
    expect(schema.properties.format.const).toBe(BUILD_FORMAT);
    expect(validate({ format: BUILD_FORMAT, files: filesOf(fixture("loan-simulation-api")), options: { version: "1.0.0" } })).toBe(true);
    expect(validate({ files: { "../x.json": {}, "manifest.json": {} } })).toBe(false);
  });
});
