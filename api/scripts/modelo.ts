/**
 * Referência do modelo para quem adota o grafo: as tabelas de nós, relações e valores fixos do MODELO.md saem do
 * `describeModel` (o mesmo do GET /v1/schema), entre os marcadores `<!-- modelo:inicio -->` e `<!-- modelo:fim -->`.
 *
 *   pnpm run modelo:write   regrava as tabelas
 *
 * O teste `modelo-doc.test.ts` falha quando o modelo muda e o MODELO.md não.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeModel } from "../src/model/describe";

export const MODELO_PATH = join(import.meta.dirname, "..", "MODELO.md");
const START = "<!-- modelo:inicio -->";
const END = "<!-- modelo:fim -->";

type Prop = { type: string; description?: string; enum?: readonly string[]; required?: boolean };

const code = (s: string) => `\`${s}\``;
const cell = (s: string) => s.replace(/\|/g, "\\|");

function props(specs: Record<string, Prop>, identity: readonly string[] = []): string {
  const names = Object.keys(specs);
  if (names.length === 0) return "—";
  return names
    .map((name) => {
      const spec = specs[name]!;
      const marks = [identity.includes(name) ? "identidade" : "", spec.required ? "obrigatória" : ""].filter(Boolean);
      return code(name) + (marks.length ? ` (${marks.join(", ")})` : "");
    })
    .join(", ");
}

/** As tabelas geradas, sem os marcadores. */
export function modelSection(): string {
  const model = describeModel();
  const lines: string[] = [];

  lines.push(`Modelo versão **${model.modelVersion}**. Formato da chave: ${code(model.keyFormat)}.`, "");

  lines.push("### Nós", "");
  lines.push("| Tipo | Prefixo | O que é | Propriedades |", "|---|---|---|---|");
  for (const n of model.nodeTypes) {
    lines.push(`| ${code(n.type)} | ${code(`${n.prefix}:`)} | ${cell(n.description)} | ${props(n.props as Record<string, Prop>)} |`);
  }
  lines.push("");

  lines.push("### Relações", "");
  lines.push("| Relação | De → para | O que é | Natureza | Propriedades |", "|---|---|---|---|---|");
  for (const r of model.relationTypes) {
    const pairs = r.pairs.map((p) => `${p.from} → ${p.to}`).join("<br>");
    lines.push(
      `| ${code(r.type)} | ${pairs} | ${cell(r.description)} | ${r.nature} | ${props(r.props as Record<string, Prop>, r.identityProps)} |`,
    );
  }
  lines.push("");
  lines.push("| Propriedade de relação | O que é |", "|---|---|");
  for (const r of model.relationTypes) {
    for (const [name, spec] of Object.entries(r.props as Record<string, Prop>)) {
      lines.push(`| ${code(`${r.type}.${name}`)} | ${cell(spec.description ?? "")} (${spec.type}) |`);
    }
  }
  lines.push("");
  lines.push(
    "Uma propriedade de **identidade** distingue duas afirmações da mesma fonte entre os mesmos nós (ex.: duas rotas " +
      "do mesmo ingress para o mesmo componente, com `host` diferente). As demais podem divergir entre fontes e ficam " +
      "em cada afirmação.",
    "",
  );

  lines.push("### Valores fixos", "");
  lines.push("| Onde | Valores aceitos |", "|---|---|");
  for (const n of model.nodeTypes) {
    for (const [name, spec] of Object.entries(n.props as Record<string, Prop>)) {
      if (spec.enum) lines.push(`| ${code(`${n.type}.${name}`)} | ${spec.enum.map(code).join(", ")} |`);
    }
  }
  for (const r of model.relationTypes) {
    for (const [name, spec] of Object.entries(r.props as Record<string, Prop>)) {
      if (spec.enum) lines.push(`| ${code(`${r.type}.${name}`)} | ${spec.enum.map(code).join(", ")} |`);
    }
  }
  lines.push(`| ${code("state")} de uma afirmação | ${model.provenance.states.map(code).join(", ")} |`);
  lines.push(`| ${code("status")} de uma afirmação | ${model.provenance.statuses.map(code).join(", ")} |`);

  return lines.join("\n");
}

/** O MODELO.md com as tabelas da versão atual do modelo. */
export function renderModelo(current: string): string {
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  if (start < 0 || end < start) throw new Error(`MODELO.md sem os marcadores ${START} e ${END}`);
  return `${current.slice(0, start + START.length)}\n${modelSection()}\n${current.slice(end)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(MODELO_PATH, renderModelo(readFileSync(MODELO_PATH, "utf8")));
  console.log(`Gravado ${MODELO_PATH}`);
}
