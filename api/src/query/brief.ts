import type { Fact } from "./facts";

/**
 * Afirmação resumida: o suficiente para citar (fonte e evidência) e para ver divergência (props).
 * `status` e `state` só aparecem quando fogem do comum (stale, ou não observado diretamente).
 */
export type BriefFact = {
  source: string;
  evidence: string;
  props?: Record<string, unknown>;
  status?: string;
  state?: string;
};

export function briefFact(f: Fact): BriefFact {
  const b: BriefFact = { source: f.source, evidence: f.evidence };
  if (f.props) b.props = f.props;
  if (f.status !== "current") b.status = f.status;
  if (f.state && f.state !== "observed") b.state = f.state;
  return b;
}

const isFact = (v: unknown): v is Fact =>
  !!v && typeof v === "object" && "source" in v && "evidence" in v && "observedAt" in v && "status" in v;

/** Troca, em qualquer profundidade, as listas de Fact pela forma resumida. O resto do resultado não muda. */
export function summarize<T>(value: T): T {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isFact)) return value.map(briefFact) as T;
    return value.map(summarize) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, summarize(v)])) as T;
  }
  return value;
}
