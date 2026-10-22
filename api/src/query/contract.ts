import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SHARED_SCHEMAS } from "./responses";
import type { QueryTool } from "./tools";

/**
 * Versão do contrato das consultas: os nomes das ferramentas, os argumentos e o que as respostas trazem. É
 * separada do MODEL_VERSION (o modelo do grafo, que os adaptadores seguem): o modelo pode mudar sem quebrar
 * as consultas, e vice-versa. A política está em CONTRACT_POLICY; o snapshot publicado de cada versão fica em
 * `contract/queries-v<N>.json`, e `bun run contract:write` recusa gravar uma mudança que a política proíbe.
 */
export const QUERY_CONTRACT_VERSION = 1;

export const CONTRACT_POLICY = [
  "Na mesma versão, só entram mudanças compatíveis: ferramenta nova, argumento novo opcional, valor novo num enum e campo novo nas respostas.",
  "Renomear ou remover ferramenta, argumento ou campo de resposta, tornar um argumento obrigatório, tirar valor de um enum ou mudar o tipo ou o sentido de um argumento é versão nova.",
  "O que sai numa versão nova fica obsoleto (deprecated, com o substituto) por pelo menos uma versão antes de ser removido: as duas formas convivem, e uma consulta citada continua refazível nesse período.",
  "Ferramentas exploratórias (graph_query) ficam fora do contrato: a forma interna do grafo pode mudar a qualquer momento.",
];

export type Stability = "stable" | "exploratory";
export type Deprecation = { since: number; use: string };

export type ArgContract = { type: string; required: boolean; enum?: string[]; deprecated?: Deprecation };
export type ToolContract = {
  name: string;
  since: number;
  stability: Stability;
  deprecated?: Deprecation;
  args: Record<string, ArgContract>;
};
/** Esquema JSON (draft-07) de uma resposta, com `$ref` para `#/definitions/<Nome>`. */
export type JsonSchema = Record<string, unknown>;
/**
 * O snapshot publicado: as ferramentas com os argumentos e, em `output`, a referência à forma da resposta, descrita
 * em `definitions` (as formas compartilhadas, como Fact e Edge, e uma `<Ferramenta>Result` por ferramenta).
 */
export type QueryContract = {
  version: number;
  tools: (ToolContract & { output?: JsonSchema })[];
  definitions?: Record<string, JsonSchema>;
};

/** O que o contrato guarda de cada argumento: tipo, se é obrigatório e os valores aceitos, quando é enum. */
function argContract(schema: z.ZodTypeAny): Omit<ArgContract, "deprecated"> {
  let s = schema;
  let required = true;
  for (;;) {
    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
      required = false;
      s = s.unwrap();
    } else if (s instanceof z.ZodDefault) {
      required = false;
      s = s.removeDefault();
    } else if (s instanceof z.ZodEffects) {
      s = s.innerType();
    } else break;
  }
  const type = (s._def as { typeName: string }).typeName.replace(/^Zod/, "").toLowerCase();
  return s instanceof z.ZodEnum ? { type, required, enum: [...(s.options as string[])].sort() } : { type, required };
}

export function toolContract(tool: QueryTool): ToolContract {
  const args: Record<string, ArgContract> = {};
  for (const name of Object.keys(tool.inputSchema).sort()) {
    const dep = tool.deprecatedArgs?.[name];
    args[name] = { ...argContract(tool.inputSchema[name]), ...(dep ? { deprecated: dep } : {}) };
  }
  return {
    name: tool.name,
    since: tool.since ?? 1,
    stability: tool.stability ?? "stable",
    ...(tool.deprecated ? { deprecated: tool.deprecated } : {}),
    args,
  };
}

const pascal = (name: string) => name.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
/** Nome da forma dos argumentos e da resposta de uma ferramenta no contrato (ex.: ComponentGetArgs, ComponentGetResult). */
export const argsName = (tool: { name: string }) => `${pascal(tool.name)}Args`;
export const resultName = (tool: { name: string }) => `${pascal(tool.name)}Result`;

/**
 * As formas das consultas como esquema JSON: as compartilhadas e a resposta de cada ferramenta (e os argumentos,
 * com `args`). `jsonSchema7` referencia `#/definitions/<Nome>` (o snapshot); `openApi3`, `#/components/schemas/<Nome>`.
 */
export function queryDefinitions(
  tools: QueryTool[],
  target: "jsonSchema7" | "openApi3",
  opts: { args?: boolean } = {},
): Record<string, JsonSchema> {
  const definitions: Record<string, z.ZodTypeAny> = { ...SHARED_SCHEMAS };
  for (const tool of tools) {
    if (opts.args) definitions[argsName(tool)] = z.object(tool.inputSchema).strict();
    definitions[resultName(tool)] = tool.output;
  }
  return toJsonSchemas(definitions, target);
}

/**
 * Converte formas nomeadas em esquema JSON, cada uma referenciando as outras por `$ref` ao nome. O conversor também
 * referencia um pedaço já visto dentro de outra forma (`#/definitions/Edge/properties/type`); esses são
 * expandidos no lugar, para que só as formas nomeadas sejam referências (e virem tipos com nome no SDK).
 */
export function toJsonSchemas(definitions: Record<string, z.ZodTypeAny>, target: "jsonSchema7" | "openApi3"): Record<string, JsonSchema> {
  const prefix = target === "jsonSchema7" ? "#/definitions/" : "#/components/schemas/";
  const raw =
    target === "jsonSchema7"
      ? (zodToJsonSchema(z.object({}), { definitions, target }) as { definitions: Record<string, JsonSchema> }).definitions
      : (zodToJsonSchema(z.object({}), { definitions, target, basePath: ["#", "components"], definitionPath: "schemas" }) as unknown as {
          schemas: Record<string, JsonSchema>;
        }).schemas;
  const resolve = (pointer: string): unknown =>
    pointer
      .slice(prefix.length)
      .split("/")
      .reduce<unknown>((at, part) => (at as Record<string, unknown>)[part.replaceAll("~1", "/").replaceAll("~0", "~")], raw);
  const inline = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(inline);
    if (!value || typeof value !== "object") return value;
    const ref = (value as { $ref?: string }).$ref;
    if (ref?.startsWith(prefix) && ref.slice(prefix.length).includes("/")) {
      const { $ref: _, ...rest } = value as Record<string, unknown>;
      return inline({ ...(resolve(ref) as object), ...rest });
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inline(v)]));
  };
  return inline(raw) as Record<string, JsonSchema>;
}

export function queryContract(tools: QueryTool[]): QueryContract {
  return {
    version: QUERY_CONTRACT_VERSION,
    tools: tools
      .map((t) => ({ ...toolContract(t), output: { $ref: `#/definitions/${resultName(t)}` } }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    definitions: queryDefinitions(tools, "jsonSchema7"),
  };
}

/**
 * O que a mudança de `published` para `current` quebra, segundo CONTRACT_POLICY. Vazio: pode publicar.
 * Na mesma versão, só valem mudanças compatíveis; na versão seguinte, só sai o que já estava obsoleto.
 * Ferramentas exploratórias não entram na conta.
 */
export function incompatibilities(published: QueryContract, current: QueryContract): string[] {
  if (current.version < published.version) return [`a versão ${current.version} é anterior à publicada (${published.version})`];
  if (current.version > published.version + 1) {
    return [`a versão ${current.version} pula versões: a publicada é a ${published.version}`];
  }
  const nextVersion = current.version === published.version + 1;
  const problems: string[] = [];
  const byName = new Map(current.tools.map((t) => [t.name, t]));

  for (const old of published.tools) {
    if (old.stability === "exploratory") continue;
    const now = byName.get(old.name);
    if (!now) {
      if (!nextVersion) problems.push(`${old.name}: ferramenta removida na mesma versão`);
      else if (!old.deprecated) problems.push(`${old.name}: ferramenta removida sem ter ficado obsoleta na versão ${published.version}`);
      continue;
    }
    if (now.stability !== "stable") problems.push(`${old.name}: deixou de ser estável`);
    for (const [arg, before] of Object.entries(old.args)) {
      const after = now.args[arg];
      if (!after) {
        if (!nextVersion) problems.push(`${old.name}.${arg}: argumento removido na mesma versão`);
        else if (!before.deprecated) problems.push(`${old.name}.${arg}: argumento removido sem ter ficado obsoleto`);
        continue;
      }
      if (nextVersion) continue; // na versão nova o resto pode mudar; o que sai precisa só ter ficado obsoleto
      if (after.type !== before.type) problems.push(`${old.name}.${arg}: tipo mudou de ${before.type} para ${after.type}`);
      if (after.required && !before.required) problems.push(`${old.name}.${arg}: passou a ser obrigatório`);
      const lost = (before.enum ?? []).filter((v) => !(after.enum ?? []).includes(v));
      if (lost.length > 0) problems.push(`${old.name}.${arg}: valores removidos do enum (${lost.join(", ")})`);
    }
    if (!nextVersion) {
      for (const [arg, after] of Object.entries(now.args)) {
        if (!old.args[arg] && after.required) problems.push(`${old.name}.${arg}: argumento novo obrigatório`);
      }
      if (old.output && now.output) {
        const before = { schema: old.output, defs: published.definitions ?? {} };
        const after = { schema: now.output, defs: current.definitions ?? {} };
        problems.push(...responseChanges(before, after, old.name, new Set()));
      }
    }
  }
  return problems;
}

type At = { schema: JsonSchema; defs: Record<string, JsonSchema> };

const deref = ({ schema, defs }: At): { schema: JsonSchema; ref?: string } => {
  const ref = schema.$ref as string | undefined;
  if (!ref) return { schema };
  const name = ref.replace("#/definitions/", "");
  return { schema: defs[name] ?? {}, ref: name };
};

const typesOf = (s: JsonSchema): string[] =>
  s.type === undefined ? [] : Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];

/**
 * O que a resposta deixou de garantir: campo removido, campo que vinha sempre e passou a ser opcional, tipo
 * diferente, valor nulo onde não havia. Campo novo e valor novo num enum são compatíveis. Uniões são comparadas
 * pela posição de cada alternativa.
 */
function responseChanges(a: At, b: At, path: string, seen: Set<string>): string[] {
  const da = deref(a);
  const db = deref(b);
  if (da.ref && db.ref) {
    const pair = `${da.ref}->${db.ref}`;
    if (seen.has(pair)) return [];
    seen = new Set(seen).add(pair);
  }
  const sa = da.schema;
  const sb = db.schema;
  const problems: string[] = [];
  const ta = typesOf(sa);
  const tb = typesOf(sb);
  if (ta.length > 0 && tb.length > 0) {
    const added = tb.filter((t) => !ta.includes(t));
    if (added.length > 0) problems.push(`${path}: tipo da resposta mudou de ${ta.join("|")} para ${tb.join("|")}`);
  }
  const anyA = (sa.anyOf as JsonSchema[] | undefined) ?? null;
  const anyB = (sb.anyOf as JsonSchema[] | undefined) ?? null;
  if (anyA && anyB) {
    anyA.forEach((alt, i) => {
      if (anyB[i]) problems.push(...responseChanges({ schema: alt, defs: a.defs }, { schema: anyB[i], defs: b.defs }, path, seen));
    });
  }
  const pa = sa.properties as Record<string, JsonSchema> | undefined;
  const pb = (sb.properties as Record<string, JsonSchema> | undefined) ?? {};
  if (pa) {
    const reqA = new Set((sa.required as string[] | undefined) ?? []);
    const reqB = new Set((sb.required as string[] | undefined) ?? []);
    for (const [field, fa] of Object.entries(pa)) {
      const fb = pb[field];
      if (!fb) {
        problems.push(`${path}.${field}: campo removido da resposta`);
        continue;
      }
      if (reqA.has(field) && !reqB.has(field)) problems.push(`${path}.${field}: deixou de vir sempre na resposta`);
      problems.push(...responseChanges({ schema: fa, defs: a.defs }, { schema: fb, defs: b.defs }, `${path}.${field}`, seen));
    }
  }
  if (sa.items && sb.items) {
    problems.push(...responseChanges({ schema: sa.items as JsonSchema, defs: a.defs }, { schema: sb.items as JsonSchema, defs: b.defs }, `${path}[]`, seen));
  }
  const xa = sa.additionalProperties;
  const xb = sb.additionalProperties;
  if (xa && typeof xa === "object" && xb && typeof xb === "object") {
    problems.push(...responseChanges({ schema: xa as JsonSchema, defs: a.defs }, { schema: xb as JsonSchema, defs: b.defs }, `${path}{}`, seen));
  }
  return problems;
}
