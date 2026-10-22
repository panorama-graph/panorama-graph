import type { ManagedTransaction } from "neo4j-driver";
import { ApiError } from "../errors";
import { resolveKeys } from "../graph/resolve";
import { typeFromKey } from "../model/keys";
import { NODE_TYPES, type NodeType } from "../model/model";

export type Resolved = { key: string; type: NodeType };

const MAX_CANDIDATES = 10;

/**
 * Resolve o que o consumidor informou para um nó de um dos tipos esperados, nesta ordem:
 * chave ou apelido; nome (sem diferenciar maiúsculas); último segmento da chave ou de um apelido, depois de `/` ou `:`
 * (`product-api` acha `component:example/catalog/product-api`; `platform-starter` acha `lib:maven/com.example:platform-starter`).
 * Nenhum → 404. Mais de um → 409 com os candidatos, para o consumidor escolher pela chave; se só um dos
 * candidatos está current (os outros ficaram stale), fica ele.
 */
export async function resolveRef(tx: ManagedTransaction, ref: string, types: readonly NodeType[]): Promise<Resolved> {
  const expected = types.join(" ou ");
  const canonical = (await resolveKeys(tx, [ref])).get(ref);
  if (canonical) {
    const type = typeFromKey(canonical);
    if (!type || !types.includes(type)) throw new ApiError(422, `"${ref}" é ${type ?? "desconhecido"}, esperado ${expected}`);
    return { key: canonical, type };
  }
  if (typeFromKey(ref)) throw new ApiError(404, `${expected} "${ref}" não encontrado (nem como apelido)`);

  const prefixes = types.map((t) => NODE_TYPES[t].prefix);
  const res = await tx.run(
    `CALL {
       MATCH (n:Node) WHERE n.type IN $types AND toLower(n.name) = toLower($ref)
       RETURN n
       UNION
       MATCH (n:Node) WHERE n.type IN $types
         AND (any(p IN $prefixes WHERE n.key = p + ':' + $ref) OR n.key ENDS WITH '/' + $ref OR n.key ENDS WITH ':' + $ref)
       RETURN n
       UNION
       MATCH (a:Alias)-[:ALIAS_OF]->(n:Node) WHERE n.type IN $types
         AND (any(p IN $prefixes WHERE a.key = p + ':' + $ref) OR a.key ENDS WITH '/' + $ref OR a.key ENDS WITH ':' + $ref)
       RETURN n
     }
     RETURN n.key AS key, n.type AS type, n.name AS name, coalesce(n.status, 'current') AS status
     ORDER BY key LIMIT ${MAX_CANDIDATES + 1}`,
    { ref, types, prefixes },
  );
  let found = res.records.map((r) => r.toObject() as { key: string; type: NodeType; name: string | null; status: string });
  // Um nome antigo que ficou stale não disputa com o atual.
  const current = found.filter((f) => f.status === "current");
  if (found.length > 1 && current.length === 1) found = current;
  if (found.length === 0) throw new ApiError(404, `${expected} "${ref}" não encontrado por chave, apelido ou nome`);
  if (found.length > 1) {
    throw new ApiError(409, `"${ref}" é ambíguo: informe a chave de um dos candidatos`, {
      candidates: found.slice(0, MAX_CANDIDATES).map(({ key, name }) => ({ key, ...(name ? { name } : {}) })),
    }, "ambiguous");
  }
  return { key: found[0].key, type: found[0].type };
}
