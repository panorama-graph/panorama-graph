import type { Edge } from "./facts";
import { compareVersions } from "./versions";

/**
 * Uso de uma biblioteca por um componente (a relação DEPENDS_ON), com o que as afirmações dizem resumido:
 * se é direta, a versão em uso, se foi declarada sem uso e por quais dependências diretas chega.
 */
export type LibraryUse = Edge & { direct: boolean; version?: string; unused?: true; via?: string[]; library?: string };

/**
 * Direta quando alguma fonte diz que é (`direct` do SBOM, `declared` do build); transitiva quando alguma diz que
 * não é e nenhuma diz que é. Sem informação, conta como direta, para não sumir do recorte padrão.
 */
export function isDirect(e: Edge): boolean {
  const said = e.facts.flatMap((f) => [f.props?.direct, f.props?.declared]).filter((v) => typeof v === "boolean");
  return said.length === 0 || said.includes(true);
}

/** A versão em uso: a resolvida pelo build, quando alguma fonte a dá; senão, a primeira afirmada. */
export function usedVersion(e: Edge): string | undefined {
  const withVersion = e.facts.filter((f) => typeof f.props?.version === "string");
  return (withVersion.find((f) => f.props?.resolved === true) ?? withVersion[0])?.props?.version as string | undefined;
}

export function libraryUse(e: Edge & { library?: string }): LibraryUse {
  const direct = isDirect(e);
  const version = usedVersion(e);
  const unused = e.facts.some((f) => f.props?.declared === true && f.props?.used === false) && !e.facts.some((f) => f.props?.used === true);
  const via = direct ? [] : [...new Set(e.facts.flatMap((f) => (Array.isArray(f.props?.via) ? (f.props.via as string[]) : [])))].sort();
  return { ...e, direct, ...(version ? { version } : {}), ...(unused ? { unused: true as const } : {}), ...(via.length ? { via } : {}) };
}

/** As versões em uso, da mais nova para a mais antiga, com os componentes de cada uma. */
export function versionsInUse(uses: LibraryUse[]): { version: string | null; components: string[] }[] {
  const byVersion = new Map<string | null, Set<string>>();
  for (const u of uses) {
    const v = u.version ?? null;
    byVersion.set(v, (byVersion.get(v) ?? new Set()).add(u.node.key));
  }
  return [...byVersion]
    .map(([version, cs]) => ({ version, components: [...cs].sort() }))
    .sort((a, b) => (a.version === null ? 1 : b.version === null ? -1 : compareVersions(b.version, a.version)));
}
