import type { ManagedTransaction } from "neo4j-driver";

/**
 * Resolve chaves para a chave canônica: a própria, se há nó com ela, ou a do nó de que ela é apelido.
 * Chaves sem nó nem apelido ficam fora do mapa.
 */
export async function resolveKeys(tx: ManagedTransaction, keys: string[]): Promise<Map<string, string>> {
  const res = await tx.run(
    `UNWIND $keys AS k
     OPTIONAL MATCH (n:Node {key: k})
     OPTIONAL MATCH (:Alias {key: k})-[:ALIAS_OF]->(m:Node)
     WITH k, coalesce(n.key, m.key) AS canonical
     WHERE canonical IS NOT NULL
     RETURN k, canonical`,
    { keys },
  );
  return new Map(res.records.map((r) => [r.get("k") as string, r.get("canonical") as string]));
}
