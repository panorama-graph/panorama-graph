import type { ManagedTransaction } from "neo4j-driver";
import { canonicalScope } from "../ingest/payload";
import { resolveRef } from "./resolveRef";

/** Uma implantação de um componente no ambiente do recorte: a versão (rótulo) e o commit em execução. */
export type Deployed = { version: string; commit: string };

/**
 * O retrato que uma consulta enxerga. Sem ambiente, a linha principal: as afirmações dos retratos congelados ficam
 * de fora. Com ambiente, para cada componente implantado nele cujo commit tem retrato congelado, valem as afirmações
 * desse retrato (`shown`) no lugar das da linha principal das mesmas fontes (`hidden`). O resto (organização,
 * infraestrutura, componentes sem retrato congelado) segue a linha principal.
 * `shown` e `hidden` guardam `source|scopeKey`.
 */
export type Vis = {
  includeStale: boolean;
  environment: string | null;
  shown: string[];
  hidden: string[];
  /** Componente → implantações no ambiente do recorte (mais de uma no canário). */
  deployed: Map<string, Deployed[]>;
  /** Componentes cujo retrato congelado da versão implantada está no recorte. */
  frozenOf: Set<string>;
};

export type ViewOpt = { includeStale?: boolean; environment?: string };

/** Parâmetros que todo Cypher com `live` ou `liveNode` recebe. */
export function visParams(v: Vis) {
  return { includeStale: v.includeStale, shown: v.shown, hidden: v.hidden };
}

export function lineView(includeStale = false): Vis {
  return { includeStale, environment: null, shown: [], hidden: [], deployed: new Map(), frozenOf: new Set() };
}

const scopeId = (v: string) => `(${v}.source + '|' + ${v}.scopeKey)`;

/**
 * Filtro de uma afirmação (relação ou Claim) no retrato da consulta: vigente (ou stale, sob pedido) e do retrato
 * certo. Da linha principal, desde que o recorte não a troque por um retrato congelado; congelada, só a do commit
 * implantado no ambiente do recorte.
 */
export const live = (v: string) =>
  `((${v}.status = 'current' OR $includeStale) AND ` +
  `CASE WHEN ${v}.revision IS NULL THEN NOT ${scopeId(v)} IN $hidden ELSE ${scopeId(v)} IN $shown END)`;

/**
 * O mesmo para nós. Na linha principal, a vigência derivada (`status` do nó; sem ela, conta como current). No recorte
 * de um ambiente, o nó vale se alguma afirmação dele, ou alguma relação que chega nele, vale no retrato.
 */
export function liveNode(v: string, vis: Vis): string {
  if (!vis.environment) return `(coalesce(${v}.status, 'current') = 'current' OR $includeStale)`;
  return `(exists { MATCH (lc:Claim)-[:CLAIMS]->(${v}) WHERE ${live("lc")} } OR exists { MATCH (${v})-[lr]-() WHERE ${live("lr")} })`;
}

/** A mesma regra do `live`, em JavaScript, para afirmações já lidas (ex.: as Claim de um nó). */
export function visible(raw: Record<string, unknown>, vis: Vis): boolean {
  const id = `${raw.source}|${raw.scopeKey}`;
  return raw.revision == null ? !vis.hidden.includes(id) : vis.shown.includes(id);
}

/** Monta o retrato da consulta. Com ambiente, lê as implantações current dele e os retratos congelados existentes. */
export async function resolveView(tx: ManagedTransaction, opts: ViewOpt = {}): Promise<Vis> {
  const vis = lineView(!!opts.includeStale);
  if (!opts.environment) return vis;
  vis.environment = (await resolveRef(tx, opts.environment, ["Environment"])).key;

  const deps = await tx.run(
    `MATCH (c:Component)-[d:DEPLOYED_IN]->(:Node {key: $env}) WHERE d.status = 'current'
     RETURN c.key AS component, d.version AS version, d.commit AS commit ORDER BY component, version`,
    { env: vis.environment },
  );
  for (const r of deps.records) {
    const c = r.get("component") as string;
    vis.deployed.set(c, [...(vis.deployed.get(c) ?? []), { version: r.get("version"), commit: r.get("commit") }]);
  }
  const pairs = [...vis.deployed].flatMap(([component, ds]) => ds.map((d) => ({ component, commit: d.commit })));
  if (pairs.length === 0) return vis;

  const frozen = await tx.run(
    `UNWIND $pairs AS p
     MATCH (s:Scope {frozen: true, revisionOf: p.component, commit: p.commit})
     RETURN s.source AS source, s.scopeKey AS scopeKey, s.revisionOf AS component`,
    { pairs },
  );
  for (const r of frozen.records) {
    vis.frozenOf.add(r.get("component") as string);
    const source = r.get("source") as string;
    const scopeKey = r.get("scopeKey") as string;
    const { commit: _, ...line } = JSON.parse(scopeKey) as Record<string, string>;
    vis.shown.push(`${source}|${scopeKey}`);
    vis.hidden.push(`${source}|${canonicalScope(line)}`);
  }
  return vis;
}

/** Rótulo da versão implantada de um componente no recorte (mais de uma, no canário, separadas por vírgula). */
export function deployedVersion(vis: Vis, component: string): string | undefined {
  const ds = vis.deployed.get(component);
  return ds && ds.length > 0 ? [...new Set(ds.map((d) => d.version))].join(", ") : undefined;
}

/**
 * No recorte de um ambiente, carimba a versão implantada em toda ponta ou nó de componente da resposta
 * (`{ key, type: "Component" }`). Fora do recorte, devolve o resultado como veio.
 */
export function stampVersions<T>(value: T, vis: Vis): T {
  if (!vis.environment || vis.deployed.size === 0) return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    if (o.type === "Component" && typeof o.key === "string") {
      const version = deployedVersion(vis, o.key);
      if (version) o.version = version;
    }
    return o;
  };
  return walk(value) as T;
}
