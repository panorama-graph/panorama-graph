import type { ManagedTransaction } from "neo4j-driver";
import { ensureConstraints } from "../db/constraints";
import type { GraphDb } from "../db/neo4j";
import { ApiError } from "../errors";
import { checkKey } from "../model/keys";
import { RELATION_TYPE_NAMES, relationSpec, type RelationType } from "../model/model";
import { refreshNodeStatus } from "./nodeStatus";
import { resolveKeys } from "./resolve";

export type AliasResult = { key: string; alias: string; created: boolean };

export type MergeResult = {
  mergeId: string;
  from: string;
  into: string;
  relations: { moved: number; deduplicated: number };
  claims: { moved: number; deduplicated: number };
  aliases: string[];
};

type RelRow = { eid: string; props: Record<string, unknown>; from: string; to: string };

const NODE_META = new Set(["key", "type", "createdAt", "status"]);

/** Identidade dos nós: apelidos e união auditada. */
export class NodeService {
  constructor(private readonly db: GraphDb) {}

  async addAlias(key: string, alias: string, reason?: string): Promise<AliasResult> {
    const a = checkKey(alias);
    if (!a.ok) throw new ApiError(422, `Apelido inválido: ${a.error}`);
    await ensureConstraints(this.db);

    return this.db.writeTx(async (tx) => {
      const canonical = await this.canonical(tx, key);
      const k = checkKey(canonical);
      if (k.ok && k.type !== a.type) {
        throw new ApiError(422, `O apelido "${alias}" é de ${a.type}, mas o nó "${canonical}" é ${k.type}`);
      }
      if (alias === canonical) throw new ApiError(409, `"${alias}" já é a chave do nó`);

      const res = await tx.run(
        `OPTIONAL MATCH (n:Node {key: $alias})
         OPTIONAL MATCH (:Alias {key: $alias})-[:ALIAS_OF]->(t:Node)
         RETURN n.key AS node, t.key AS target`,
        { alias },
      );
      const { node, target } = res.records[0].toObject() as { node: string | null; target: string | null };
      if (node) throw new ApiError(409, `"${alias}" já é um nó. Para juntar os dois, use POST /nodes/merge`);
      if (target === canonical) return { key: canonical, alias, created: false };
      if (target) throw new ApiError(409, `"${alias}" já é apelido de "${target}"`);

      await tx.run(
        `MATCH (n:Node {key: $key})
         CREATE (:Alias {key: $alias, reason: $reason, createdAt: $now})-[:ALIAS_OF]->(n)`,
        { key: canonical, alias, reason: reason ?? null, now: new Date().toISOString() },
      );
      return { key: canonical, alias, created: true };
    });
  }

  /**
   * Une `from` em `into`: move afirmações de nó e de relação, resolve colisões pela afirmação mais recente,
   * completa propriedades que faltam em `into`, transforma `from` e seus apelidos em apelidos de `into`,
   * apaga `from` e registra a união.
   */
  async merge(fromKey: string, intoKey: string, reason: string, actor: string): Promise<MergeResult> {
    await ensureConstraints(this.db);
    const mergeId = crypto.randomUUID();

    return this.db.writeTx(async (tx) => {
      const from = await this.canonical(tx, fromKey);
      const into = await this.canonical(tx, intoKey);
      if (from === into) throw new ApiError(422, `"${fromKey}" e "${intoKey}" já são o mesmo nó (${into})`);
      const ft = checkKey(from);
      const it = checkKey(into);
      if (!ft.ok || !it.ok || ft.type !== it.type) {
        throw new ApiError(422, `Só nós do mesmo tipo podem ser unidos ("${from}" e "${into}")`);
      }

      const relations = { moved: 0, deduplicated: 0 };
      for (const type of RELATION_TYPE_NAMES) {
        for (const rel of await this.relationsOf(tx, type, from)) {
          const moved = await this.moveRelation(tx, type, rel, from, into);
          relations[moved ? "moved" : "deduplicated"]++;
        }
      }
      const claims = await this.moveClaims(tx, from, into);

      const res = await tx.run(
        `MATCH (f:Node {key: $from}), (i:Node {key: $into})
         OPTIONAL MATCH (a:Alias)-[x:ALIAS_OF]->(f)
         RETURN properties(f) AS fp, properties(i) AS ip, collect(a.key) AS aliases`,
        { from, into },
      );
      const { fp, ip, aliases } = res.records[0].toObject() as {
        fp: Record<string, unknown>;
        ip: Record<string, unknown>;
        aliases: string[];
      };
      const missing = Object.fromEntries(Object.entries(fp).filter(([k]) => !NODE_META.has(k) && ip[k] === undefined));

      const now = new Date().toISOString();
      await tx.run(
        `MATCH (f:Node {key: $from}), (i:Node {key: $into})
         SET i += $missing
         WITH f, i
         OPTIONAL MATCH (a:Alias)-[x:ALIAS_OF]->(f)
         FOREACH (_ IN CASE WHEN a IS NULL THEN [] ELSE [1] END | CREATE (a)-[:ALIAS_OF]->(i) DELETE x)
         WITH DISTINCT f, i
         DETACH DELETE f
         WITH i
         CREATE (:Alias {key: $from, reason: $aliasReason, createdAt: $now})-[:ALIAS_OF]->(i)
         CREATE (:Merge {id: $mergeId, from: $from, into: $into, reason: $reason, actor: $actor, at: $now,
                         summary: $summary})-[:MERGED_INTO]->(i)`,
        {
          from,
          into,
          missing,
          now,
          mergeId,
          reason,
          actor,
          aliasReason: `união em ${into}: ${reason}`,
          summary: JSON.stringify({ relations, claims }),
        },
      );

      await refreshNodeStatus(tx, [into]);
      return { mergeId, from, into, relations, claims, aliases: [from, ...aliases] };
    });
  }

  private async canonical(tx: ManagedTransaction, key: string): Promise<string> {
    const c = (await resolveKeys(tx, [key])).get(key);
    if (!c) throw new ApiError(404, `Nó "${key}" não encontrado (nem como apelido)`);
    return c;
  }

  private async relationsOf(tx: ManagedTransaction, type: RelationType, key: string): Promise<RelRow[]> {
    const res = await tx.run(
      `MATCH (a:Node)-[r:${type}]->(b:Node)
       WHERE a.key = $key OR b.key = $key
       RETURN DISTINCT elementId(r) AS eid, properties(r) AS props, a.key AS from, b.key AS to`,
      { key },
    );
    return res.records.map((r) => r.toObject() as RelRow);
  }

  /** Recria a relação em `into`. Se já há afirmação igual (mesma fonte, escopo e identidade), fica a mais recente. */
  private async moveRelation(tx: ManagedTransaction, type: RelationType, rel: RelRow, from: string, into: string): Promise<boolean> {
    const a = rel.from === from ? into : rel.from;
    const b = rel.to === from ? into : rel.to;
    const identity = relationSpec(type)
      .identityProps.map((p) => `coalesce(e.${p}, '') = coalesce($props.${p}, '')`)
      .join(" AND ");

    const res = await tx.run(
      `MATCH (:Node {key: $a})-[e:${type} {source: $props.source, scopeKey: $props.scopeKey}]->(:Node {key: $b})
       WHERE elementId(e) <> $eid ${identity ? `AND ${identity}` : ""}
       RETURN elementId(e) AS eid, e.observedAt AS observedAt
       LIMIT 1`,
      { a, b, props: rel.props, eid: rel.eid },
    );
    const dup = res.records[0]?.toObject() as { eid: string; observedAt: string } | undefined;

    if (dup) {
      if ((rel.props.observedAt as string) > dup.observedAt) {
        await tx.run(`MATCH ()-[e]->() WHERE elementId(e) = $eid SET e = $props`, { eid: dup.eid, props: rel.props });
      }
    } else {
      await tx.run(
        `MATCH (a:Node {key: $a}), (b:Node {key: $b})
         CREATE (a)-[e:${type}]->(b)
         SET e = $props`,
        { a, b, props: rel.props },
      );
    }
    await tx.run(`MATCH ()-[r]->() WHERE elementId(r) = $eid DELETE r`, { eid: rel.eid });
    return !dup;
  }

  private async moveClaims(tx: ManagedTransaction, from: string, into: string): Promise<{ moved: number; deduplicated: number }> {
    const res = await tx.run(
      `MATCH (c:Claim)-[:CLAIMS]->(:Node {key: $from})
       OPTIONAL MATCH (d:Claim {source: c.source, scopeKey: c.scopeKey})-[:CLAIMS]->(:Node {key: $into})
       RETURN c.id AS id, c.observedAt AS observedAt, d.id AS dupId, d.observedAt AS dupObservedAt`,
      { from, into },
    );
    let moved = 0;
    let deduplicated = 0;
    for (const r of res.records) {
      const { id, observedAt, dupId, dupObservedAt } = r.toObject() as Record<string, string | null>;
      if (dupId) {
        deduplicated++;
        const [keep, drop] = (observedAt as string) > (dupObservedAt as string) ? [id, dupId] : [dupId, id];
        await tx.run(`MATCH (c:Claim {id: $drop}) DETACH DELETE c`, { drop });
        if (keep !== id) continue;
      } else {
        moved++;
      }
      await tx.run(
        `MATCH (c:Claim {id: $id})-[k:CLAIMS]->(:Node {key: $from}), (i:Node {key: $into})
         DELETE k CREATE (c)-[:CLAIMS]->(i)`,
        { id, from, into },
      );
    }
    return { moved, deduplicated };
  }
}
