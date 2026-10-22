import { ApiError } from "../errors";

/**
 * Comparação de versões como os ecossistemas de pacote costumam escrever (Maven, npm):
 * segmentos numéricos separados por ponto, comparados como números (`3.10 > 3.9`), e um qualificador
 * depois de `-` que fica antes da versão final (`1.0.0-RC1 < 1.0.0`). Segmento ausente vale 0.
 */
export function compareVersions(a: string, b: string): number {
  const [an, aq] = split(a);
  const [bn, bq] = split(b);
  for (let i = 0; i < Math.max(an.length, bn.length); i++) {
    const d = (an[i] ?? 0) - (bn[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (aq === bq) return 0;
  if (!aq) return 1;
  if (!bq) return -1;
  return aq.localeCompare(bq, "en", { numeric: true, sensitivity: "base" });
}

function split(v: string): [number[], string] {
  const m = /^v?([0-9]+(?:\.[0-9]+)*)(?:[-.+]?(.*))?$/i.exec(v.trim());
  if (!m) return [[], v.trim()];
  const qualifier = (m[2] ?? "").replace(/^(release|final|ga)$/i, "");
  return [m[1].split(".").map(Number), qualifier];
}

type Comparator = { op: "<" | "<=" | ">" | ">=" | "="; version: string };

/** Faixa como `<3.2.0`, `>=2.0 <3.0` ou `1.4.2` (igual). Todas as condições precisam valer. */
export function parseRange(range: string): Comparator[] {
  const parts = range.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) throw new ApiError(422, "Faixa de versão vazia");
  return parts.map((p) => {
    const m = /^(<=|>=|<|>|=)?(.+)$/.exec(p);
    if (!m || !/^v?[0-9]/i.test(m[2])) throw new ApiError(422, `Faixa de versão inválida: "${p}" (ex.: "<3.2.0", ">=2.0 <3.0")`);
    return { op: (m[1] ?? "=") as Comparator["op"], version: m[2] };
  });
}

export function satisfies(version: string, range: Comparator[]): boolean {
  return range.every(({ op, version: v }) => {
    const c = compareVersions(version, v);
    switch (op) {
      case "<":
        return c < 0;
      case "<=":
        return c <= 0;
      case ">":
        return c > 0;
      case ">=":
        return c >= 0;
      case "=":
        return c === 0;
    }
  });
}
