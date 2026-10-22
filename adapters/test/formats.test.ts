import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { NODE_TYPES } from "@panorama-graph/sdk";
import { FORMATS } from "../src/graph-publish/formats";
import { planPublish } from "../src/graph-publish/publish";

const root = join(import.meta.dir, "..");
const fixture = (name: string) => join(import.meta.dir, "fixtures", name);
const schemaFile = { manifest: "manifest", application: "application", httpClients: "http-clients", dataAccess: "data-access" } as const;
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

const compile = (schema: object) => new Ajv2020({ allErrors: true }).compile(schema);

/** Cópia do fixture com um artefato alterado, para conferir como o graph-publish lê o `format`. */
function withArtifact(file: string, change: (doc: Record<string, unknown>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "graph-publish-"));
  cpSync(fixture("loan-simulation-api"), dir, { recursive: true });
  const doc = readJson(join(dir, file));
  change(doc);
  writeFileSync(join(dir, file), JSON.stringify(doc));
  return dir;
}

describe("formatos de artefato do produto", () => {
  for (const [artifact, spec] of Object.entries(FORMATS)) {
    const schema = readJson(join(root, "schemas", `${schemaFile[artifact as keyof typeof schemaFile]}.schema.json`));

    test(`${spec.file}: o esquema declara o formato atual e aceita os artefatos dos fixtures`, () => {
      expect(schema.properties.format.const).toBe(spec.current);
      const validate = compile(schema);
      for (const name of ["product-catalog-api", "loan-simulation-api"]) {
        const ok = validate(readJson(join(fixture(name), spec.file)));
        expect(validate.errors ?? []).toEqual([]);
        expect(ok).toBe(true);
      }
    });
  }

  test("o esquema recusa o que o graph-publish não sabe ler", () => {
    const validate = compile(readJson(join(root, "schemas", "data-access.schema.json")));
    const doc = readJson(join(fixture("loan-simulation-api"), "data-access.json"));
    expect(validate({ ...doc, accesses: [{ ...doc.accesses[0], operation: "delete" }] })).toBe(false);
    expect(validate({ ...doc, format: "panorama-graph-data-access/3" })).toBe(false);
  });

  test("sem format, lido como o atual, com aviso", () => {
    const dir = withArtifact("manifest.json", (d) => delete d.format);
    const plan = planPublish(dir, "2026-10-18T12:00:00.000Z", { env: {} });
    expect(plan.warnings).toEqual(["manifest.json: sem format; lido como panorama-graph-manifest/1"]);
  });

  test("formato desconhecido é erro, e nada é publicado", () => {
    const dir = withArtifact("data-access.json", (d) => (d.format = "panorama-graph-data-access/1"));
    expect(() => planPublish(dir, "2026-10-18T12:00:00.000Z", { env: {} })).toThrow(
      'data-access.json: formato "panorama-graph-data-access/1" desconhecido; este graph-publish lê panorama-graph-data-access/2',
    );
  });

  test("a categoria do banco no data-access é a de Dataset.store no modelo", () => {
    const schema = readJson(join(root, "schemas", "data-access.schema.json"));
    expect(schema.$defs.store.enum).toEqual([...NODE_TYPES.Dataset.props.store.enum]);
  });
});
