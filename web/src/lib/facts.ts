import type { Fact } from "./types";

/** Valores que as afirmações dão a uma propriedade, cada um com as fontes que o afirmam. */
export type PropValues = { prop: string; values: { value: string; sources: string[] }[] };

/** Valor para ler: lista de valores simples vira texto separado por vírgula, que quebra linha na célula. */
const show = (v: unknown): string =>
  typeof v === "string" ? v : Array.isArray(v) && v.every((x) => x === null || typeof x !== "object") ? v.join(", ") : JSON.stringify(v);

/** Propriedades das afirmações, com os valores por fonte. Afirmação que não fala da propriedade não conta. */
export function propValues(facts: Fact[]): PropValues[] {
  const byProp = new Map<string, Map<string, Set<string>>>();
  for (const f of facts) {
    for (const [p, v] of Object.entries(f.props ?? {})) {
      const values = byProp.get(p) ?? new Map<string, Set<string>>();
      const value = show(v);
      values.set(value, (values.get(value) ?? new Set()).add(f.source));
      byProp.set(p, values);
    }
  }
  return [...byProp]
    .map(([prop, values]) => ({
      prop,
      values: [...values].map(([value, sources]) => ({ value, sources: [...sources].sort() })),
    }))
    .sort((a, b) => a.prop.localeCompare(b.prop));
}

/** As fontes discordam em alguma propriedade? */
export const diverges = (facts: Fact[]) => propValues(facts).some((p) => p.values.length > 1);

/** Fontes distintas, em ordem. */
export const sourcesOf = (facts: Fact[]) => [...new Set(facts.map((f) => f.source))].sort();

/** Resumo para uma célula: `version 3.2.4` ou `version 3.2.4 (sbom) · 3.2.0 (gitlab-ci)` quando discordam. */
export function propsSummary(facts: Fact[], only?: string[]): string {
  return propValues(facts)
    .filter((p) => !only || only.includes(p.prop))
    .map((p) =>
      p.values.length === 1
        ? `${p.prop} ${p.values[0].value}`
        : `${p.prop} ${p.values.map((v) => `${v.value} (${v.sources.join(", ")})`).join(" · ")}`,
    )
    .join("; ");
}

export function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export const scopeText = (scope?: Record<string, string>) =>
  scope && Object.keys(scope).length > 0 ? Object.entries(scope).map(([k, v]) => `${k}=${v}`).join(", ") : "—";
