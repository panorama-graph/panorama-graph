import { useGraphQuery } from "@/lib/queries";
import type { OrgStructure } from "@/lib/types";
import { QueryView } from "@/components/QueryView";
import { Section } from "@/components/Section";
import { EdgeList } from "@/components/EdgeList";
import { Coverage } from "@/components/Coverage";
import { OrgChart } from "@/components/OrgChart";
import { orgLayout } from "@/lib/orgLayout";
import { levelOf, levelStyles } from "@/lib/orgLevels";
import { useUrlSet } from "../Organization";
import { NodeHeader, Relations, TabBar, nameOf, useTab } from "./common";

const TABS = [
  { id: "grupo", label: "Grupo" },
  { id: "relacoes", label: "Todas as relações" },
];

/** Grupo: o nível, os membros, o que possui e o organograma dos subgrupos (org_structure com group). */
export function GroupView({ nodeKey }: { nodeKey: string }) {
  const [tab, setTab] = useTab(TABS.map((t) => t.id));
  const [collapsed, toggle] = useUrlSet("recolhidos");
  const [expanded, expand] = useUrlSet("posses");
  const query = useGraphQuery<OrgStructure>("org_structure", { group: nodeKey, depth: 2 });
  return (
    <QueryView query={query} showQuery={tab === "grupo"}>
      {(data) => {
        const group = data.groups[0];
        if (!group) return <Coverage coverage={[data.coverage]} />;
        const name = nameOf(group);
        return (
          <>
            <NodeHeader node={group} kindLabel={group.level.length > 0 ? levelOf(group, levelStyles(data.levels)).label : undefined} />
            <TabBar tabs={TABS} value={tab} onChange={setTab} />
            {tab === "grupo" && (
              <>
                <Section title="Membros" count={group.members.length}>
                  <EdgeList edges={group.members} owner={name} empty="Nenhum membro afirmado." />
                </Section>
                <Section title="É dono de" count={group.owns.length}>
                  <EdgeList edges={group.owns} owner={name} showType empty="Nada afirmado." />
                </Section>
                {group.groups.length > 0 && (
                  <Section title="Estrutura" count={group.groups.length}>
                    <OrgChart roots={data.groups} levels={data.levels} collapsed={collapsed} onToggle={toggle} expanded={expanded} onExpand={expand} height={Math.min(720, orgLayout(data.groups, collapsed, expanded).height + 80)} />
                  </Section>
                )}
              </>
            )}
            {tab === "relacoes" && <Relations nodeKey={group.key} />}
          </>
        );
      }}
    </QueryView>
  );
}
