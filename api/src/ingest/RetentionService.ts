import type { ManagedTransaction } from "neo4j-driver";
import type { GraphDb } from "../db/neo4j";
import { RELATION_TYPE_NAMES } from "../model/model";

/** Quantos dias cada coisa fica depois de deixar de valer. */
export type RetentionPolicy = {
  /** Retrato congelado de um commit que saiu de todos os ambientes (ou nunca foi implantado). */
  frozenDays: number;
  /** Implantação que saiu do ambiente (histórico de deploys). */
  deployHistoryDays: number;
  /** O mesmo, em ambiente `production`. */
  deployHistoryProductionDays: number;
};

export const DEFAULT_RETENTION: RetentionPolicy = { frozenDays: 30, deployHistoryDays: 30, deployHistoryProductionDays: 365 };

export type PruneResult = {
  deployments: number;
  frozenScopes: { source: string; scope: Record<string, string> }[];
  nodes: number;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * Retenção guiada pela implantação. O retrato congelado de um commit existe para o recorte de um ambiente: enquanto
 * o commit está implantado em algum ambiente, fica; quando sai de todos (ou nunca entrou), fica mais `frozenDays` e
 * é apagado, com as afirmações e as cargas. As implantações que saíram (DEPLOYED_IN stale) são o histórico de
 * deploys e ficam `deployHistoryDays` (ou `deployHistoryProductionDays`, em produção). A linha principal nunca é
 * apagada aqui: o que a fonte deixa de afirmar continua stale, como sempre.
 */
export class RetentionService {
  constructor(
    private readonly db: GraphDb,
    private readonly policy: RetentionPolicy = DEFAULT_RETENTION,
  ) {}

  async prune(now: Date = new Date()): Promise<PruneResult> {
    const cutoff = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
    return this.db.writeTx(async (tx) => {
      const deployments = await tx.run(
        `MATCH (:Component)-[d:DEPLOYED_IN {status: 'stale'}]->(e:Environment)
         WHERE d.observedAt < CASE WHEN e.kind = 'production' THEN $production ELSE $other END
         DELETE d
         RETURN count(*) AS n`,
        { other: cutoff(this.policy.deployHistoryDays), production: cutoff(this.policy.deployHistoryProductionDays) },
      );

      // Último sinal de vida do commit: a implantação vista mais recentemente; sem nenhuma, a carga do retrato.
      const expired = await tx.run(
        `MATCH (s:Scope {frozen: true})
         WHERE NOT exists {
           MATCH (:Component {key: s.revisionOf})-[d:DEPLOYED_IN {status: 'current'}]->() WHERE d.commit = s.commit
         }
         OPTIONAL MATCH (:Component {key: s.revisionOf})-[d:DEPLOYED_IN]->() WHERE d.commit = s.commit
         WITH s, max(d.observedAt) AS lastDeployed
         WHERE coalesce(lastDeployed, s.lastObservedAt) < $frozen
         RETURN s.id AS id, s.source AS source, s.scopeKey AS scopeKey`,
        { frozen: cutoff(this.policy.frozenDays) },
      );

      const frozenScopes: PruneResult["frozenScopes"] = [];
      const touched = new Set<string>();
      for (const r of expired.records) {
        const source = r.get("source") as string;
        const scopeKey = r.get("scopeKey") as string;
        for (const k of await deleteScope(tx, r.get("id") as string, source, scopeKey)) touched.add(k);
        frozenScopes.push({ source, scope: JSON.parse(scopeKey) });
      }

      // Nó que só o retrato apagado afirmava, sem relação nem apelido: some com ele.
      const orphans = await tx.run(
        `UNWIND $keys AS k
         MATCH (n:Node {key: k})
         WHERE NOT exists { MATCH (:Claim)-[:CLAIMS]->(n) } AND NOT exists { MATCH (n)-[]-(:Node) }
           AND NOT exists { MATCH (:Alias)-[:ALIAS_OF]->(n) }
         DETACH DELETE n
         RETURN count(*) AS n`,
        { keys: [...touched] },
      );

      return {
        deployments: deployments.records[0].get("n") as number,
        frozenScopes,
        nodes: orphans.records[0].get("n") as number,
      };
    });
  }
}

/** Apaga um escopo inteiro: relações, afirmações de nó, cargas e o próprio escopo. Devolve os nós tocados. */
async function deleteScope(tx: ManagedTransaction, id: string, source: string, scopeKey: string): Promise<string[]> {
  const keys: string[] = [];
  for (const type of RELATION_TYPE_NAMES) {
    const res = await tx.run(
      `MATCH (a:Node)-[r:${type} {source: $source, scopeKey: $scopeKey}]->(b:Node)
       DELETE r
       RETURN a.key AS a, b.key AS b`,
      { source, scopeKey },
    );
    for (const r of res.records) keys.push(r.get("a") as string, r.get("b") as string);
  }
  const claims = await tx.run(
    `MATCH (c:Claim {source: $source, scopeKey: $scopeKey})-[:CLAIMS]->(n:Node)
     DETACH DELETE c
     RETURN n.key AS key`,
    { source, scopeKey },
  );
  keys.push(...claims.records.map((r) => r.get("key") as string));
  await tx.run(`MATCH (s:Scope {id: $id}) OPTIONAL MATCH (l:Load)-[:OF_SCOPE]->(s) DETACH DELETE l, s`, { id });
  return keys;
}
