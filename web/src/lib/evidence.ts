/**
 * Evidência de um fato como link, quando dá. Formatos:
 * - URL (`http://...`): ela mesma;
 * - ponteiro de código `repo@sha:caminho[:linha][#fragmento]`: pelo template configurado, com `{repo}`, `{sha}` e
 *   `{path}`; a linha (`:31` ou `#L31`) entra como `#L<linha>`;
 * - o resto (ex.: `k8s://cluster/ns/ingresses/x`): só texto.
 */
export const EVIDENCE_URL_TEMPLATE = (import.meta.env?.VITE_EVIDENCE_URL_TEMPLATE as string | undefined) ?? "";

const CODE_POINTER = /^(?<repo>[^@\s]+)@(?<sha>[0-9a-zA-Z._-]+):(?<path>[^#\s]+?)(?::(?<line>\d+))?(?:#(?<frag>.*))?$/;

export type CodePointer = { repo: string; sha: string; path: string; line?: number; fragment?: string };

export function parseCodePointer(evidence: string): CodePointer | null {
  const m = CODE_POINTER.exec(evidence.trim());
  if (!m?.groups) return null;
  const { repo, sha, path, line, frag } = m.groups;
  const fromFrag = frag ? /^L(\d+)/.exec(frag) : null;
  const lineNo = line ? Number(line) : fromFrag ? Number(fromFrag[1]) : undefined;
  return { repo, sha, path, ...(lineNo ? { line: lineNo } : {}), ...(frag && !fromFrag ? { fragment: frag } : {}) };
}

export function evidenceHref(evidence: string, template = EVIDENCE_URL_TEMPLATE): string | undefined {
  const e = evidence.trim();
  if (/^https?:\/\//i.test(e)) return e;
  if (!template) return undefined;
  const p = parseCodePointer(e);
  if (!p) return undefined;
  const url = template.replaceAll("{repo}", p.repo).replaceAll("{sha}", p.sha).replaceAll("{path}", p.path);
  return p.line ? `${url}#L${p.line}` : url;
}

/** Texto curto para listas: o sha encurtado. A evidência completa fica no título. */
export function shortEvidence(evidence: string): string {
  const p = parseCodePointer(evidence);
  if (!p) return evidence;
  const where = `${p.path}${p.line ? `:${p.line}` : ""}${p.fragment ? `#${p.fragment}` : ""}`;
  return `${p.repo}@${p.sha.slice(0, 8)}:${where}`;
}
