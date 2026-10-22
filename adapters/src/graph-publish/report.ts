import type { IngestOutcome } from "../core/api";
import type { Plan } from "./publish";

/** O resumo de um plano, como o graph-publish e o graph-receiver o mostram (os avisos, à parte). */
export function planLines(plan: Plan, frozen = false): string[] {
  const { identity: id } = plan;
  const what = frozen ? "retrato congelado" : "linha principal";
  return [
    `componente ${id.path} (serviço ${id.service}) @ ${id.commit.slice(0, 12)}${id.version ? ` (${id.version})` : ""} em ${id.host}: ${what}`,
    ...plan.snapshots.map((s) => `  ${s.source.padEnd(17)} ${String(s.nodes.length).padStart(4)} nós  ${String(s.relations.length).padStart(4)} relações`),
    ...plan.skipped.map((s) => `  sem artefato: ${s}`),
  ];
}

/** Uma linha por retrato enviado. */
export function outcomeLine(source: string, outcome: IngestOutcome): string {
  if (outcome.status === "outdated") return `  ${source}: não gravado, a API já tem um retrato mais novo (${outcome.message})`;
  const { nodes, relations, referenced } = outcome.counts;
  const fmt = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ");
  return `  ${source}: nós (${fmt(nodes)}), relações (${fmt(relations)}), referenciados ${referenced}`;
}
