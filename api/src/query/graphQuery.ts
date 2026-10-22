import neo4j, { isNode, isPath, isRelationship, isInt, type Neo4jError } from "neo4j-driver";
import type { GraphDb } from "../db/neo4j";
import { ApiError } from "../errors";

export const GRAPH_QUERY_LIMITS = { defaultRows: 100, maxRows: 1000, maxChars: 40_000, timeoutMs: 5_000 } as const;

export type GraphQueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  /** Só quando cortou: por qual limite e o que fazer. As linhas seguintes ficaram de fora, não "não existem". */
  truncatedBy?: "rows" | "size";
  note?: string;
};

const TRUNCATED_NOTE =
  "Resultado cortado: as linhas seguintes ficaram de fora e podem conter o que você procura. Agregue " +
  "(count, collect), exclua o que não precisa (ex.: WHERE NOT b:Library para tirar as DEPENDS_ON de bibliotecas, " +
  "que são a maioria das relações) ou divida a consulta.";

/**
 * Cypher arbitrário, só de leitura. Três camadas:
 * 1. recusa LOAD CSV (lê arquivos e URLs) e EXPLAIN/PROFILE (PROFILE executa);
 * 2. EXPLAIN antes: só segue se o plano é de leitura (queryType "r");
 * 3. roda numa transação de leitura, que o servidor recusa se tentar escrever.
 * Limites: tempo por transação, número de linhas e tamanho do resultado em JSON (as linhas seguintes são
 * descartadas; `truncated`, `truncatedBy` e `note` avisam).
 */
export async function runReadOnly(
  db: GraphDb,
  cypher: string,
  params: Record<string, unknown> = {},
  opts: { limit?: number; timeoutMs?: number; maxChars?: number } = {},
): Promise<GraphQueryResult> {
  const limit = Math.min(Math.max(opts.limit ?? GRAPH_QUERY_LIMITS.defaultRows, 1), GRAPH_QUERY_LIMITS.maxRows);
  const timeout = opts.timeoutMs ?? GRAPH_QUERY_LIMITS.timeoutMs;
  const maxChars = opts.maxChars ?? GRAPH_QUERY_LIMITS.maxChars;
  const text = cypher.trim();
  if (text.length === 0) throw new ApiError(422, "Consulta vazia");
  if (/\bLOAD\s+CSV\b/i.test(text)) throw new ApiError(422, "LOAD CSV não é permitido no graph_query");
  if (/^(EXPLAIN|PROFILE)\b/i.test(text)) throw new ApiError(422, "Envie a consulta sem EXPLAIN ou PROFILE");

  try {
    return await db.readTx(
      async (tx) => {
        const plan = await tx.run(`EXPLAIN ${text}`, params);
        const queryType = plan.summary.queryType;
        if (queryType !== "r") {
          throw new ApiError(422, `graph_query só aceita leitura (a consulta é do tipo "${queryType}")`);
        }
        const res = tx.run(text, params);
        const rows: Record<string, unknown>[] = [];
        let truncatedBy: GraphQueryResult["truncatedBy"];
        let columns: string[] = [];
        let size = 0;
        for await (const record of res) {
          if (rows.length === 0) columns = [...record.keys] as string[];
          if (rows.length >= limit) {
            truncatedBy = "rows";
            break;
          }
          const row = Object.fromEntries(record.keys.map((k) => [k, toPlain(record.get(k))]));
          size += JSON.stringify(row).length;
          if (size > maxChars && rows.length > 0) {
            truncatedBy = "size";
            break;
          }
          rows.push(row);
        }
        if (columns.length === 0) columns = [...((await res.keys()) as string[])];
        if (!truncatedBy) return { columns, rows, truncated: false };
        return { columns, rows, truncated: true, truncatedBy, note: TRUNCATED_NOTE };
      },
      { timeout },
    );
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const e = err as Neo4jError;
    if (typeof e.code === "string" && e.code.startsWith("Neo.ClientError.")) {
      if (e.code.includes("TransactionTimedOut")) {
        throw new ApiError(422, `Consulta passou do limite de ${timeout} ms. Restrinja o padrão ou use LIMIT.`);
      }
      throw new ApiError(422, `Cypher recusado: ${e.message}`, { neo4jCode: e.code });
    }
    throw err;
  }
}

/** Converte valores do driver em JSON: nó, relação e caminho viram objetos; datas e pontos viram texto. */
export function toPlain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (isInt(v)) return v.toNumber();
  if (isNode(v)) return { labels: v.labels, properties: toPlain(v.properties) };
  if (isRelationship(v)) return { type: v.type, properties: toPlain(v.properties) };
  if (isPath(v)) {
    return {
      start: toPlain(v.start),
      segments: v.segments.map((s) => ({ relationship: toPlain(s.relationship), end: toPlain(s.end) })),
    };
  }
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === "object") {
    if (neo4j.isDateTime(v) || neo4j.isDate(v) || neo4j.isLocalDateTime(v) || neo4j.isTime(v) || neo4j.isLocalTime(v) ||
        neo4j.isDuration(v) || neo4j.isPoint(v)) {
      return String(v);
    }
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toPlain(x)]));
  }
  return v;
}
