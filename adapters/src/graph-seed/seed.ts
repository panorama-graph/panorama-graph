import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NODE_TYPES, RELATION_TYPES } from "@panorama-graph/sdk";
import { nodeTypeFromKey } from "../core/keys";
import { type Props, type Snapshot, SnapshotBuilder } from "../core/snapshot";

/**
 * Retrato declarado num arquivo de carga. As propriedades do nó e da relação ficam no próprio item, ao lado de
 * `key` (ou `type`, `from` e `to`) e `evidence`. O tipo do nó vem do prefixo da chave, quando não é dado.
 */
type SeedItem = Record<string, unknown>;
type SeedSnapshot = {
  source?: string;
  scope?: Record<string, string>;
  evidenceBase?: string;
  /** Evidência dos itens que não trazem a sua. */
  evidence?: string;
  nodes?: SeedItem[];
  relations?: SeedItem[];
};

export type SeedPlan = { snapshots: (Snapshot & { file: string })[]; warnings: string[]; errors: string[] };

const NODE_FIELDS = new Set(["key", "type", "evidence"]);
const RELATION_FIELDS = new Set(["type", "from", "to", "evidence"]);

/**
 * Lê os arquivos `*.yaml` do diretório, em ordem alfabética, e monta um retrato por item de `snapshots`.
 * A validação aqui é a mínima para não enviar lixo (prefixo, evidência, campos obrigatórios); a do modelo é da API.
 */
export function planSeed(dir: string, observedAt: string): SeedPlan {
  const plan: SeedPlan = { snapshots: [], warnings: [], errors: [] };
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
  for (const file of files) {
    const doc = Bun.YAML.parse(readFileSync(join(dir, file), "utf8")) as { snapshots?: SeedSnapshot[] } | null;
    const list = doc?.snapshots ?? [];
    if (list.length === 0) plan.warnings.push(`${file}: nenhum retrato em "snapshots"`);
    list.forEach((s, i) => {
      const where = `${file} #${i + 1}`;
      const built = buildSnapshot(s, where, observedAt, plan.errors);
      if (built) {
        plan.snapshots.push({ ...built.snapshot, file });
        plan.warnings.push(...built.warnings.map((w) => `${where}: ${w}`));
      }
    });
  }
  return plan;
}

function buildSnapshot(s: SeedSnapshot, where: string, observedAt: string, errors: string[]) {
  if (!s.source || !s.scope || Object.keys(s.scope).length === 0) {
    errors.push(`${where}: "source" e "scope" são obrigatórios`);
    return undefined;
  }
  const b = new SnapshotBuilder(s.source, stringify(s.scope), s.evidenceBase);
  const seen = new Set<string>();
  const before = errors.length;

  for (const n of s.nodes ?? []) {
    const key = String(n.key ?? "");
    const type = (n.type as string | undefined) ?? nodeTypeFromKey(key);
    const evidence = (n.evidence as string | undefined) ?? s.evidence;
    if (!type) errors.push(`${where}: nó "${key}" sem tipo, e o prefixo da chave não é conhecido`);
    else if (!evidence && !s.evidenceBase) errors.push(`${where}: nó "${key}" sem evidência`);
    else {
      if (seen.has(key)) b.warn(`nó "${key}" repetido`);
      seen.add(key);
      b.node(key, type, props(n, NODE_FIELDS, numericProps(NODE_TYPES, type)), evidence);
    }
  }
  for (const r of s.relations ?? []) {
    const label = `${r.type} ${r.from} → ${r.to}`;
    const evidence = (r.evidence as string | undefined) ?? s.evidence;
    if (!r.type || !r.from || !r.to) errors.push(`${where}: relação "${label}" sem type, from ou to`);
    else if (!nodeTypeFromKey(String(r.from)) || !nodeTypeFromKey(String(r.to))) errors.push(`${where}: relação "${label}" com prefixo de chave desconhecido`);
    else if (!evidence && !s.evidenceBase) errors.push(`${where}: relação "${label}" sem evidência`);
    else b.relation(String(r.type), String(r.from), String(r.to), props(r, RELATION_FIELDS, numericProps(RELATION_TYPES, String(r.type))), evidence);
  }

  return errors.length > before ? undefined : { snapshot: b.build(observedAt), warnings: b.warnings };
}

/** Propriedades numéricas do tipo, segundo o modelo (ex.: `OrgLevel.order`). */
function numericProps(types: Record<string, { props: Record<string, { type: string }> }>, type: string): Set<string> {
  const specs = types[type]?.props ?? {};
  return new Set(Object.keys(specs).filter((k) => specs[k]!.type === "number"));
}

/**
 * O YAML lê `version: 17` como número: tudo vira texto, menos booleano e as propriedades que o modelo declara
 * numéricas.
 */
function props(item: SeedItem, reserved: Set<string>, numeric: Set<string>): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(item)) {
    if (reserved.has(k) || v === undefined || v === null) continue;
    out[k] = typeof v === "boolean" || (typeof v === "number" && numeric.has(k)) ? v : String(v);
  }
  return out;
}

function stringify(scope: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, String(v)]));
}
