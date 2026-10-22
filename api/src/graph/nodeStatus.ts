import type { ManagedTransaction } from "neo4j-driver";

/**
 * Vigência do nó, derivada das afirmações: `current` enquanto alguma fonte ainda afirma o nó (Claim current)
 * ou alguma relação current chega nele; `stale` quando todas deixaram de afirmar. O nó e o histórico ficam;
 * as consultas escondem nós stale por padrão. Sem esta propriedade, um nó renomeado continuaria contando
 * como parte do retrato atual. Só conta a linha principal: as afirmações de um retrato congelado (`revision`)
 * aparecem no recorte de um ambiente, e não mantêm vivo um nó que a linha principal deixou de afirmar.
 */
export const NODE_STATUS_CYPHER = `
  SET n.status = CASE
    WHEN exists { MATCH (c:Claim {status: 'current'})-[:CLAIMS]->(n) WHERE c.revision IS NULL }
      OR exists { MATCH (n)-[r]-() WHERE r.status = 'current' AND r.revision IS NULL }
    THEN 'current' ELSE 'stale' END`;

/** Recalcula a vigência dos nós informados (os que uma carga ou uma união tocou). */
export async function refreshNodeStatus(tx: ManagedTransaction, keys: Iterable<string>): Promise<void> {
  const list = [...new Set(keys)];
  if (list.length === 0) return;
  await tx.run(`UNWIND $keys AS k MATCH (n:Node {key: k}) ${NODE_STATUS_CYPHER}`, { keys: list });
}
