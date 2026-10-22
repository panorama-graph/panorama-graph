/**
 * Diretório corporativo → grafo. A entrada é o export do diretório (os níveis da estrutura, os grupos e as pessoas,
 * no vocabulário da organização); a saída é um retrato da fonte `directory`, com o escopo do tenant.
 */
import { groupKey, levelKey, personKey, type Snapshot } from "@panorama-graph/sdk";

/**
 * Um nível da estrutura, como a organização o chama (diretoria, tribo, squad...). `order` é a posição de cima para
 * baixo (1 é o topo; um nível lateral, como chapter, repete a do vizinho); `team` marca os níveis cujos grupos são
 * times, os donos dos componentes.
 */
export type DirectoryLevel = { id: string; displayName: string; order: number; team?: boolean; description?: string };
/** Um grupo como o diretório exporta: o `type` é o nível do grupo, um dos `levels`. */
export type DirectoryGroup = { id: string; type: string; displayName: string; description?: string; parentId?: string };
export type DirectoryUser = {
  userName: string;
  displayName: string;
  email?: string;
  memberships: { groupId: string; title?: string; leader?: boolean }[];
};
export type DirectoryExport = { tenant: string; url: string; levels: DirectoryLevel[]; groups: DirectoryGroup[]; users: DirectoryUser[] };

/**
 * Um retrato com os níveis (`OrgLevel`), os grupos e o nível de cada um (`AT_LEVEL`), as pessoas, a hierarquia
 * (`PART_OF`) e quem é membro de quê (`MEMBER_OF`, com o cargo e se lidera). Os nomes dos níveis são os da
 * organização: o modelo não tem lista fixa. A evidência de cada fato é o registro do diretório que o afirma
 * (`levels/<id>`, `groups/<id>`, `users/<login>`), relativa à URL do diretório.
 */
export function directorySnapshot(exp: DirectoryExport, observedAt: string): { snapshot: Snapshot; errors: string[] } {
  const errors: string[] = [];
  const known = new Set(exp.groups.map((g) => g.id));
  const levels = new Set(exp.levels.map((l) => l.id));
  const snapshot: Snapshot = {
    source: "directory",
    scope: { tenant: exp.tenant },
    observedAt,
    evidenceBase: exp.url,
    nodes: [],
    relations: [],
  };

  for (const l of exp.levels) {
    snapshot.nodes!.push({
      key: levelKey(l.id),
      type: "OrgLevel",
      props: { name: l.displayName, order: l.order, ...(l.team ? { team: true } : {}), ...(l.description ? { description: l.description } : {}) },
      evidence: `levels/${l.id}`,
    });
  }
  for (const g of exp.groups) {
    snapshot.nodes!.push({
      key: groupKey(g.id),
      type: "Group",
      props: { name: g.displayName, ...(g.description ? { description: g.description } : {}) },
      evidence: `groups/${g.id}`,
    });
    // O nível é o que o diretório diz do grupo: um tipo fora dos níveis exportados é erro, e não um palpite.
    if (!levels.has(g.type)) errors.push(`grupo "${g.id}": nível "${g.type}" não está nos níveis do export`);
    else snapshot.relations!.push({ type: "AT_LEVEL", from: groupKey(g.id), to: levelKey(g.type), evidence: `groups/${g.id}` });
  }
  for (const g of exp.groups) {
    if (!g.parentId) continue;
    if (!known.has(g.parentId)) errors.push(`grupo "${g.id}": pai "${g.parentId}" não está no export`);
    snapshot.relations!.push({ type: "PART_OF", from: groupKey(g.id), to: groupKey(g.parentId), evidence: `groups/${g.id}` });
  }

  for (const u of exp.users) {
    const person = personKey(u.userName);
    const evidence = `users/${u.userName}`;
    snapshot.nodes!.push({ key: person, type: "Person", props: { name: u.displayName, ...(u.email ? { email: u.email } : {}) }, evidence });
    if (u.memberships.length === 0) errors.push(`pessoa "${u.userName}": sem nenhum grupo`);
    for (const m of u.memberships) {
      if (!known.has(m.groupId)) errors.push(`pessoa "${u.userName}": grupo "${m.groupId}" não está no export`);
      snapshot.relations!.push({
        type: "MEMBER_OF",
        from: person,
        to: groupKey(m.groupId),
        props: { ...(m.title ? { role: m.title } : {}), ...(m.leader ? { lead: true } : {}) },
        evidence,
      });
    }
  }
  return { snapshot, errors };
}
