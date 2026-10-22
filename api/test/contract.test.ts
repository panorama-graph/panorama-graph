import { describe, expect, test } from "bun:test";
import { currentContract, readSnapshot } from "../scripts/contract";
import { QUERY_CONTRACT_VERSION, incompatibilities, type QueryContract, type ToolContract } from "../src/query/contract";

const tool = (name: string, args: ToolContract["args"], extra: Partial<ToolContract> = {}): ToolContract => ({
  name,
  since: 1,
  stability: "stable",
  args,
  ...extra,
});
const contract = (version: number, ...tools: ToolContract[]): QueryContract => ({ version, tools });

const base = contract(
  1,
  tool("a_get", {
    target: { type: "string", required: true },
    detail: { type: "enum", required: false, enum: ["full", "summary"] },
  }),
  tool("explorar", { cypher: { type: "string", required: true } }, { stability: "exploratory" }),
);

describe("Contrato das consultas", () => {
  test("o snapshot da versão atual é o que o código serve (rode bun run contract:write)", () => {
    const published = readSnapshot(QUERY_CONTRACT_VERSION);
    expect(published).not.toBeNull();
    expect(currentContract()).toEqual(published!);
  });

  test("na mesma versão, ferramenta nova, argumento opcional e valor de enum novo são compatíveis", () => {
    const next = contract(
      1,
      tool("a_get", {
        ...base.tools[0].args,
        depth: { type: "number", required: false },
        detail: { type: "enum", required: false, enum: ["full", "minimal", "summary"] },
      }),
      tool("b_list", {}),
    );
    expect(incompatibilities(base, next)).toEqual([]);
  });

  test("na mesma versão, remover, renomear, tornar obrigatório ou tirar valor de enum quebra", () => {
    expect(incompatibilities(base, contract(1))).toEqual(["a_get: ferramenta removida na mesma versão"]);
    const changed = contract(
      1,
      tool("a_get", {
        target: { type: "number", required: true },
        detail: { type: "enum", required: true, enum: ["full"] },
        node: { type: "string", required: true },
      }),
    );
    expect(incompatibilities(base, changed)).toEqual([
      "a_get.target: tipo mudou de string para number",
      "a_get.detail: passou a ser obrigatório",
      "a_get.detail: valores removidos do enum (summary)",
      "a_get.node: argumento novo obrigatório",
    ]);
  });

  test("ferramenta exploratória fica fora do contrato", () => {
    const next = contract(1, base.tools[0], tool("explorar", { query: { type: "string", required: true } }, { stability: "exploratory" }));
    expect(incompatibilities(base, next)).toEqual([]);
  });

  test("na versão seguinte, só sai o que já estava obsoleto", () => {
    expect(incompatibilities(base, contract(2))).toEqual([
      "a_get: ferramenta removida sem ter ficado obsoleta na versão 1",
    ]);
    const deprecated = contract(
      1,
      tool("a_get", base.tools[0].args, { deprecated: { since: 1, use: "b_get" } }),
      tool("c_get", { node: { type: "string", required: false, deprecated: { since: 1, use: "target" } }, target: { type: "string", required: false } }),
    );
    const v2 = contract(2, tool("b_get", { target: { type: "string", required: true } }), tool("c_get", { target: { type: "string", required: true } }));
    expect(incompatibilities(deprecated, v2)).toEqual([]);
    expect(incompatibilities(base, contract(3, base.tools[0]))).toEqual(["a versão 3 pula versões: a publicada é a 1"]);
  });

  test("na mesma versão, a resposta só ganha campos: remover, deixar de mandar sempre ou mudar o tipo quebra", () => {
    const fact = { type: "object", properties: { source: { type: "string" }, evidence: { type: "string" } }, required: ["source", "evidence"] };
    const result = (props: Record<string, unknown>, required: string[]) => ({ type: "object", properties: props, required });
    const withOutput = (version: number, output: object, defs: Record<string, object> = { Fact: fact }) =>
      ({
        version,
        tools: [{ ...tool("a_get", {}), output: { $ref: "#/definitions/AGetResult" } }],
        definitions: { ...defs, AGetResult: output },
      }) as QueryContract;
    const facts = { type: "array", items: { $ref: "#/definitions/Fact" } };
    const published = withOutput(1, result({ target: { type: "string" }, facts, path: { type: "string" } }, ["target", "facts"]));

    const grown = withOutput(1, result({ target: { type: "string" }, facts, path: { type: "string" }, novo: { type: "number" } }, ["target", "facts"]));
    expect(incompatibilities(published, grown)).toEqual([]);

    const broken = withOutput(
      1,
      result({ target: { type: "number" }, facts, path: { type: ["string", "null"] } }, ["target"]),
      { Fact: { ...fact, properties: { source: { type: "string" } }, required: ["source"] } },
    );
    expect(incompatibilities(published, broken)).toEqual([
      "a_get.target: tipo da resposta mudou de string para number",
      "a_get.facts: deixou de vir sempre na resposta",
      "a_get.facts[].evidence: campo removido da resposta",
      "a_get.path: tipo da resposta mudou de string para string|null",
    ]);
    expect(incompatibilities(published, { ...broken, version: 2 })).toEqual([]);
  });
});
