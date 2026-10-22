import { datasetKey } from "../../core/keys";
import { builder, type Context } from "./context";

export const SOURCE = "data-access";

/**
 * `data-access.json`: os datasets do componente e os pontos do código que leem ou escrevem neles, lidos do
 * build. Formato `panorama-graph-data-access/2` (`schemas/data-access.schema.json`).
 */
export type DataAccess = {
  format?: string;
  datasets: { name: string; store: string; kind: string; type?: string; declaredIn: "project" | "library" | "none"; source?: string }[];
  accesses: { dataset: string; store: string; operation: "read" | "write" | "read-write"; via?: string; caller?: string; source: string; line: number }[];
  unresolved?: { reason: string; via?: string; caller?: string; source?: string; line?: number }[];
};

const at = (source: string, line: number | undefined) => (line ? `${source}#L${line}` : source);

/**
 * Dataset, e `OWNS_DATA` quando a classe que o mapeia é do próprio componente; `READS` e `WRITES` por dataset
 * acessado, com a evidência do primeiro ponto de chamada. O que o build não resolveu vira aviso, não fato.
 */
export function mapDataAccess(ctx: Context, doc: DataAccess) {
  const b = builder(ctx, SOURCE);
  const key = (name: string) => datasetKey(ctx.id.path, name);

  for (const d of doc.datasets ?? []) {
    b.node(key(d.name), "Dataset", { name: d.name, kind: d.kind, store: d.store }, d.source);
    if (d.declaredIn === "project") b.relation("OWNS_DATA", ctx.component, key(d.name), {}, d.source);
  }
  for (const a of doc.accesses ?? []) {
    const evidence = at(a.source, a.line);
    if (!b.hasNode(key(a.dataset))) b.node(key(a.dataset), "Dataset", { name: a.dataset, store: a.store }, evidence);
    if (a.operation !== "write") b.relation("READS", ctx.component, key(a.dataset), {}, evidence);
    if (a.operation !== "read") b.relation("WRITES", ctx.component, key(a.dataset), {}, evidence);
  }
  for (const u of doc.unresolved ?? []) {
    b.warn(`data-access: ${u.reason}${u.source ? ` (${at(u.source, u.line)})` : ""}`);
  }
  return b;
}
