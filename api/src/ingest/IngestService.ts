import type { ManagedTransaction } from "neo4j-driver";
import { ensureConstraints } from "../db/constraints";
import type { GraphDb } from "../db/neo4j";
import { ApiError } from "../errors";
import { refreshNodeStatus } from "../graph/nodeStatus";
import { resolveKeys } from "../graph/resolve";
import { RELATION_TYPE_NAMES, relationSpec, type NodeType } from "../model/model";
import { canonicalScope, relationIdentity, type NodeFact, type RelationFact, type Snapshot } from "./payload";

export type OutcomeCounts = { created: number; updated: number; unchanged: number; stale: number };

export type IngestResult = {
  loadId: string;
  source: string;
  scope: Record<string, string>;
  observedAt: string;
  counts: { nodes: OutcomeCounts; relations: OutcomeCounts; referenced: number };
};

/** Aposentadoria de um escopo: o que deixou de existir, por quem, por quê e onde isso está registrado. */
export type RetireRequest = {
  scope: Record<string, string>;
  observedAt: string;
  retiredBy: string;
  reason: string;
  evidence: string;
};

export type RetireResult = {
  scope: Record<string, string>;
  observedAt: string;
  sources: { source: string; loadId: string; counts: { nodes: { stale: number }; relations: { stale: number } } }[];
};

type Outcome = "created" | "updated" | "unchanged";

const zero = (): OutcomeCounts => ({ created: 0, updated: 0, unchanged: 0, stale: 0 });

function groupBy<T, K extends string>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return m;
}

function propsDiffer(before: Record<string, unknown>, after: Record<string, unknown>, names: Iterable<string>): boolean {
  for (const n of names) if (JSON.stringify(before[n] ?? null) !== JSON.stringify(after[n] ?? null)) return true;
  return false;
}

/**
 * Carga por retrato. Numa transação:
 * trava o escopo (source + scope), recusa retrato mais antigo que o último, resolve apelidos,
 * grava afirmações de nó (Claim) e de relação (relação paralela por source e escopo),
 * cria nós referenciados para pontas desconhecidas, marca como stale o que a fonte deixou de afirmar
 * e recalcula a vigência (`status`) dos nós tocados.
 */
export class IngestService {
  constructor(private readonly db: GraphDb) {}

  async ingest(snapshot: Snapshot): Promise<IngestResult> {
    await ensureConstraints(this.db);
    const loadId = crypto.randomUUID();
    const receivedAt = new Date().toISOString();

    return this.db.writeTx(async (tx) => {
      const rev = snapshot.revision;
      const ctx: Ctx = {
        tx,
        loadId,
        source: snapshot.source,
        scopeKey: snapshot.scopeKey,
        observedAt: snapshot.observedAt,
        revision: rev?.frozen ? rev.commit : null,
      };
      const counts = { nodes: zero(), relations: zero(), referenced: 0 };

      await this.lockScope(ctx);
      const { nodes, relations } = await this.resolveAliases(tx, snapshot);

      const declared = new Set(nodes.map((n) => n.key));
      const known = await resolveKeys(tx, [...new Set(relations.flatMap((r) => [r.from, r.to]))]);
      const referenced = new Map<string, NodeType>();
      for (const r of relations) {
        if (!declared.has(r.from) && !known.has(r.from)) referenced.set(r.from, r.fromType);
        if (!declared.has(r.to) && !known.has(r.to)) referenced.set(r.to, r.toType);
      }

      for (const o of await this.upsertNodes(ctx, nodes)) counts.nodes[o]++;
      counts.referenced = await this.createReferenced(ctx, referenced);
      for (const o of await this.upsertRelations(ctx, relations)) counts.relations[o]++;
      const staleNodes = await this.staleClaims(ctx);
      const staleEnds = await this.staleRelations(ctx);
      counts.nodes.stale = staleNodes.length;
      counts.relations.stale = staleEnds.count;
      await refreshNodeStatus(tx, [
        ...nodes.map((n) => n.key),
        ...relations.flatMap((r) => [r.from, r.to]),
        ...staleNodes,
        ...staleEnds.keys,
      ]);

      // A revisão fica no escopo: de que componente o retrato é versão, de que commit, e se é congelado; e quem o montou.
      await tx.run(
        `MATCH (s:Scope {id: $scopeId})
         SET s.lastObservedAt = $observedAt, s.lastLoadId = $loadId,
             s.revisionOf = $revisionOf, s.commit = $commit, s.version = $version, s.frozen = $frozen,
             s.producer = $producer, s.producerVersion = $producerVersion
         CREATE (l:Load {id: $loadId, source: $source, scopeKey: $scopeKey, observedAt: $observedAt,
                         receivedAt: $receivedAt, counts: $counts, commit: $commit,
                         producer: $producer, producerVersion: $producerVersion})-[:OF_SCOPE]->(s)`,
        {
          ...params(ctx),
          scopeId: scopeId(ctx),
          receivedAt,
          counts: JSON.stringify(counts),
          revisionOf: rev?.component ?? null,
          commit: rev?.commit ?? null,
          version: rev?.version ?? null,
          frozen: rev?.frozen ?? false,
          producer: snapshot.producer?.name ?? null,
          producerVersion: snapshot.producer?.version ?? null,
        },
      );

      return { loadId, source: snapshot.source, scope: snapshot.scope, observedAt: snapshot.observedAt, counts };
    });
  }

  /**
   * Aposenta um escopo: para cada fonte que já carregou nele, é como se ela enviasse um retrato vazio. Tudo o que as
   * fontes afirmavam no escopo vira stale, e a vigência dos nós é recalculada. Serve para o que deixou de existir e
   * cujas fontes não vão mais publicar (ex.: um componente removido, com o repositório excluído). Uma transação só:
   * ou todas as fontes do escopo são aposentadas, ou nenhuma. Cada fonte ganha um `:Load` com quem aposentou, o
   * motivo e a evidência. Uma carga posterior de qualquer fonte no escopo volta a valer normalmente.
   */
  async retire(req: RetireRequest): Promise<RetireResult> {
    await ensureConstraints(this.db);
    const scopeKey = canonicalScope(req.scope);
    const receivedAt = new Date().toISOString();

    return this.db.writeTx(async (tx) => {
      const found = await tx.run(`MATCH (s:Scope {scopeKey: $scopeKey}) RETURN s.source AS source ORDER BY source`, { scopeKey });
      const sources = found.records.map((r) => r.get("source") as string);
      if (sources.length === 0) throw new ApiError(404, `Nenhuma fonte carregou o escopo ${scopeKey}`);

      const result: RetireResult = { scope: req.scope, observedAt: req.observedAt, sources: [] };
      const touched: string[] = [];
      for (const source of sources) {
        const ctx: Ctx = { tx, loadId: crypto.randomUUID(), source, scopeKey, observedAt: req.observedAt, revision: null };
        await this.lockScope(ctx);
        // Sem nada gravado nesta carga, tudo o que a fonte afirmava no escopo fica com outro loadId e vira stale.
        const staleNodes = await this.staleClaims(ctx);
        const staleEnds = await this.staleRelations(ctx);
        touched.push(...staleNodes, ...staleEnds.keys);
        const counts = { nodes: { stale: staleNodes.length }, relations: { stale: staleEnds.count } };
        await tx.run(
          `MATCH (s:Scope {id: $scopeId})
           SET s.lastObservedAt = $observedAt, s.lastLoadId = $loadId
           CREATE (l:Load {id: $loadId, source: $source, scopeKey: $scopeKey, observedAt: $observedAt,
                           receivedAt: $receivedAt, counts: $counts, retiredBy: $retiredBy, reason: $reason,
                           evidence: $evidence})-[:OF_SCOPE]->(s)`,
          {
            ...params(ctx),
            scopeId: scopeId(ctx),
            receivedAt,
            counts: JSON.stringify(counts),
            retiredBy: req.retiredBy,
            reason: req.reason,
            evidence: req.evidence,
          },
        );
        result.sources.push({ source, loadId: ctx.loadId, counts });
      }
      await refreshNodeStatus(tx, touched);
      return result;
    });
  }

  /** Serializa cargas do mesmo escopo e recusa retrato fora de ordem. */
  private async lockScope(ctx: Ctx): Promise<void> {
    const res = await ctx.tx.run(
      `MERGE (s:Scope {id: $scopeId})
       ON CREATE SET s.source = $source, s.scopeKey = $scopeKey
       WITH s, s.lastObservedAt AS last
       SET s.lock = $loadId
       RETURN last`,
      { ...params(ctx), scopeId: scopeId(ctx) },
    );
    const last = res.records[0]?.get("last") as string | null;
    if (last && ctx.observedAt < last) {
      throw new ApiError(
        409,
        `Retrato mais antigo que o último deste escopo (${last}). Cargas de um escopo precisam vir em ordem.`,
        undefined,
        "outdated_snapshot",
      );
    }
  }

  /** Troca apelidos pela chave canônica. Duas entradas que caem no mesmo nó recusam a carga. */
  private async resolveAliases(tx: ManagedTransaction, s: Snapshot): Promise<{ nodes: NodeFact[]; relations: RelationFact[] }> {
    const keys = [...new Set([...s.nodes.map((n) => n.key), ...s.relations.flatMap((r) => [r.from, r.to])])];
    const canonical = await resolveKeys(tx, keys);
    const c = (k: string) => canonical.get(k) ?? k;
    const errors: string[] = [];

    const nodes = s.nodes.map((n) => ({ ...n, key: c(n.key) }));
    const seenNodes = new Map<string, string>();
    s.nodes.forEach((n, i) => {
      const prev = seenNodes.get(nodes[i].key);
      if (prev !== undefined) errors.push(`nós "${prev}" e "${n.key}" são o mesmo nó (${nodes[i].key}) por apelido`);
      seenNodes.set(nodes[i].key, n.key);
    });

    const relations = s.relations.map((r) => ({ ...r, from: c(r.from), to: c(r.to) }));
    const seenRels = new Set<string>();
    relations.forEach((r, i) => {
      const id = relationIdentity(r);
      if (seenRels.has(id)) {
        const o = s.relations[i];
        errors.push(`relação ${o.from} -${o.type}-> ${o.to} repete outra da carga depois de resolver apelidos`);
      }
      seenRels.add(id);
    });

    if (errors.length > 0) throw new ApiError(422, "Carga inválida", { errors }, "invalid_snapshot");
    return { nodes, relations };
  }

  private async upsertNodes(ctx: Ctx, nodes: NodeFact[]): Promise<Outcome[]> {
    if (nodes.length === 0) return [];
    const res = await ctx.tx.run(
      `MATCH (c:Claim {source: $source, scopeKey: $scopeKey})-[:CLAIMS]->(n:Node)
       WHERE n.key IN $keys
       RETURN n.key AS key, c.evidence AS evidence, c.status AS status, properties(n) AS props, c.props AS claimProps`,
      { ...params(ctx), keys: nodes.map((n) => n.key) },
    );
    // No retrato congelado, as propriedades do nó ficam na afirmação: o nó guarda as da linha principal.
    const existing = new Map(
      res.records.map((r) => {
        const o = r.toObject();
        if (ctx.revision) o.props = o.claimProps ? JSON.parse(o.claimProps as string) : {};
        return [r.get("key") as string, o];
      }),
    );
    const outcomes = nodes.map((n): Outcome => {
      const e = existing.get(n.key);
      if (!e) return "created";
      if (e.evidence !== n.evidence || e.status === "stale" || propsDiffer(e.props, n.props, Object.keys(n.props))) {
        return "updated";
      }
      return "unchanged";
    });

    for (const [type, rows] of groupBy(nodes, (n) => n.type)) {
      await ctx.tx.run(
        `UNWIND $rows AS row
         MERGE (n:Node {key: row.key})
         ON CREATE SET n:${type}, n.type = $type, n.createdAt = $receivedAt, n += row.props
         FOREACH (_ IN CASE WHEN $revision IS NULL THEN [1] ELSE [] END | SET n += row.props)
         MERGE (n)<-[:CLAIMS]-(c:Claim {source: $source, scopeKey: $scopeKey})
         ON CREATE SET c.id = randomUUID(), c.firstObservedAt = $observedAt
         SET c.evidence = row.evidence, c.state = coalesce(c.state, 'observed'), c.status = 'current',
             c.observedAt = $observedAt, c.loadId = $loadId, c.revision = $revision,
             c.props = CASE WHEN $revision IS NULL THEN null ELSE row.propsJson END`,
        {
          ...params(ctx),
          type,
          rows: rows.map((r) => ({ ...r, propsJson: JSON.stringify(r.props) })),
          receivedAt: new Date().toISOString(),
        },
      );
    }
    return outcomes;
  }

  private async createReferenced(ctx: Ctx, referenced: Map<string, NodeType>): Promise<number> {
    const byType = groupBy([...referenced], ([, type]) => type);
    for (const [type, entries] of byType) {
      await ctx.tx.run(
        `UNWIND $keys AS key
         CREATE (n:Node:${type} {key: key, type: $type, createdAt: $now})`,
        { type, keys: entries.map(([k]) => k), now: new Date().toISOString() },
      );
    }
    return referenced.size;
  }

  private async upsertRelations(ctx: Ctx, relations: RelationFact[]): Promise<Outcome[]> {
    const outcomes: Outcome[] = [];
    for (const [type, rels] of groupBy(relations, (r) => r.type)) {
      const spec = relationSpec(type);
      const rows = rels.map((r, i) => ({ i, from: r.from, to: r.to, props: r.props, evidence: r.evidence }));
      const identity =
        spec.identityProps.map((p) => `coalesce(r.${p}, '') = coalesce(row.props.${p}, '')`).join(" AND ") || "true";

      const res = await ctx.tx.run(
        `UNWIND $rows AS row
         MATCH (a:Node {key: row.from})-[r:${type} {source: $source, scopeKey: $scopeKey}]->(b:Node {key: row.to})
         WHERE ${identity}
         RETURN row.i AS i, properties(r) AS props`,
        { ...params(ctx), rows },
      );
      const existing = new Map(res.records.map((r) => [r.get("i") as number, r.get("props") as Record<string, unknown>]));

      const toCreate: typeof rows = [];
      const toUpdate: { from: string; to: string; id: string; all: Record<string, unknown> }[] = [];
      for (const row of rows) {
        const e = existing.get(row.i);
        if (!e) {
          toCreate.push(row);
          outcomes.push("created");
          continue;
        }
        const changed = e.evidence !== row.evidence || e.status === "stale" || propsDiffer(e, row.props, Object.keys(spec.props));
        outcomes.push(changed ? "updated" : "unchanged");
        toUpdate.push({
          from: row.from,
          to: row.to,
          id: e.id as string,
          all: {
            ...row.props,
            ...provenance(ctx, row.evidence),
            id: e.id,
            state: e.state ?? "observed",
            firstObservedAt: e.firstObservedAt ?? ctx.observedAt,
          },
        });
      }

      if (toCreate.length > 0) {
        await ctx.tx.run(
          `UNWIND $rows AS row
           MATCH (a:Node {key: row.from}) MATCH (b:Node {key: row.to})
           CREATE (a)-[r:${type}]->(b)
           SET r = row.all, r.id = randomUUID()`,
          {
            rows: toCreate.map((row) => ({
              from: row.from,
              to: row.to,
              all: { ...row.props, ...provenance(ctx, row.evidence), state: "observed", firstObservedAt: ctx.observedAt },
            })),
          },
        );
      }
      if (toUpdate.length > 0) {
        await ctx.tx.run(
          `UNWIND $rows AS row
           MATCH (:Node {key: row.from})-[r:${type} {id: row.id}]->(:Node {key: row.to})
           SET r = row.all`,
          { rows: toUpdate },
        );
      }
    }
    return outcomes;
  }

  /** Marca como stale as afirmações de nó que a fonte deixou de fazer. Devolve as chaves dos nós. */
  private async staleClaims(ctx: Ctx): Promise<string[]> {
    const res = await ctx.tx.run(
      `MATCH (c:Claim {source: $source, scopeKey: $scopeKey, status: 'current'})-[:CLAIMS]->(n:Node)
       WHERE c.loadId <> $loadId
       SET c.status = 'stale'
       RETURN n.key AS key`,
      params(ctx),
    );
    return res.records.map((r) => r.get("key") as string);
  }

  /** Marca como stale as relações que a fonte deixou de afirmar. Devolve quantas e as pontas delas. */
  private async staleRelations(ctx: Ctx): Promise<{ count: number; keys: string[] }> {
    const out = { count: 0, keys: [] as string[] };
    for (const type of RELATION_TYPE_NAMES) {
      const res = await ctx.tx.run(
        `MATCH (a:Node)-[r:${type} {source: $source, scopeKey: $scopeKey, status: 'current'}]->(b:Node)
         WHERE r.loadId <> $loadId
         SET r.status = 'stale'
         RETURN a.key AS a, b.key AS b`,
        params(ctx),
      );
      out.count += res.records.length;
      for (const r of res.records) out.keys.push(r.get("a") as string, r.get("b") as string);
    }
    return out;
  }
}

/** `revision`: o commit, quando a carga é um retrato congelado; null no retrato da linha principal. */
type Ctx = { tx: ManagedTransaction; loadId: string; source: string; scopeKey: string; observedAt: string; revision: string | null };

function params(ctx: Ctx) {
  return { loadId: ctx.loadId, source: ctx.source, scopeKey: ctx.scopeKey, observedAt: ctx.observedAt, revision: ctx.revision };
}

function scopeId(ctx: Ctx): string {
  return JSON.stringify([ctx.source, ctx.scopeKey]);
}

function provenance(ctx: Ctx, evidence: string) {
  return {
    source: ctx.source,
    scopeKey: ctx.scopeKey,
    evidence,
    status: "current",
    observedAt: ctx.observedAt,
    loadId: ctx.loadId,
    ...(ctx.revision ? { revision: ctx.revision } : {}),
  };
}
