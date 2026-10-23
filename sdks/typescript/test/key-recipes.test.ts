import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  componentKey,
  contractKey,
  datasetKey,
  domainKey,
  endpointKey,
  environmentKey,
  groupKey,
  httpApiKey,
  levelKey,
  libraryKey,
  normalizeInterfaceVersion,
  pathVersion,
  personKey,
  repositoryKey,
  resourceKey,
  splitServiceVersion,
  systemKey,
  technologyKey,
  topicKey,
  topicVersion,
} from "../src";

/** Os casos compartilhados por todos os SDKs e pelos adaptadores sem SDK (`sdks/key-recipes.json`). */
type Input = Record<string, string | string[] | undefined>;
const cases = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "key-recipes.json"), "utf8")) as {
  keys: { recipe: string; input: Input; key: string }[];
  versions: { convention: string; input: string; version: string | null; service?: string }[];
};

const s = (v: Input[string]) => v as string;

const RECIPES: Record<string, (i: Input) => string> = {
  component: (i) => componentKey(s(i.path)),
  repository: (i) => repositoryKey(s(i.host), s(i.path)),
  httpApi: (i) => httpApiKey(s(i.service), i.version as string | undefined),
  endpoint: (i) => endpointKey(s(i.service), s(i.method), s(i.path), i.version as string | undefined),
  topic: (i) => topicKey(s(i.name)),
  contract: (i) => contractKey(s(i.kind) as Parameters<typeof contractKey>[0], s(i.id)),
  library: (i) => libraryKey(s(i.type), i.namespace as string | undefined, s(i.name)),
  technology: (i) => technologyKey(s(i.name)),
  dataset: (i) => datasetKey(s(i.componentPath), s(i.name)),
  domain: (i) => domainKey(s(i.id)),
  system: (i) => systemKey(s(i.id)),
  group: (i) => groupKey(s(i.id)),
  level: (i) => levelKey(s(i.id)),
  person: (i) => personKey(s(i.login)),
  resource: (i) => resourceKey(s(i.environment), ...(i.names as string[])),
  environment: (i) => environmentKey(s(i.name)),
};

const CONVENTIONS: Record<string, (input: string) => { version: string | null; service?: string }> = {
  interfaceVersion: (v) => ({ version: normalizeInterfaceVersion(v) ?? null }),
  pathVersion: (p) => ({ version: pathVersion(p) ?? null }),
  serviceVersion: (n) => {
    const r = splitServiceVersion(n);
    return { version: r.version ?? null, service: r.service };
  },
  topicVersion: (n) => ({ version: topicVersion(n) ?? null }),
};

describe("casos compartilhados das receitas de chave", () => {
  test.each(cases.keys.map((c) => [c.recipe, JSON.stringify(c.input), c] as const))("%s %s", (_, __, c) => {
    const recipe = RECIPES[c.recipe];
    if (!recipe) throw new Error(`receita sem implementação no SDK: ${c.recipe}`);
    expect(recipe(c.input)).toBe(c.key);
  });

  test.each(cases.versions.map((c) => [c.convention, c.input, c] as const))("%s %s", (_, __, c) => {
    const convention = CONVENTIONS[c.convention];
    if (!convention) throw new Error(`convenção sem implementação no SDK: ${c.convention}`);
    const { convention: _name, input: _input, ...expected } = c;
    expect(convention(c.input)).toEqual(expected);
  });
});
