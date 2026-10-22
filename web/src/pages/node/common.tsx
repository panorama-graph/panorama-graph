import type { ReactNode } from "react";
import { Box, Chip, Stack, Tab, Tabs, Typography } from "@mui/material";
import type { NodeGet, NodeView } from "@/lib/types";
import { displayName, relationLabel, typeLabel } from "@/lib/nodes";
import { useGraphQuery } from "@/lib/queries";
import { useUrlParam } from "@/lib/nav";
import { PageHeader, Section } from "@/components/Section";
import { FactsBadge } from "@/components/FactsBadge";
import { EdgeList } from "@/components/EdgeList";
import { QueryView } from "@/components/QueryView";

export const nameOf = (n: NodeView) => displayName({ key: n.key, name: n.props.name as string | undefined });

/**
 * Cabeçalho de um nó: tipo, nome, chave, apelidos, vigência e quem afirmou a existência. `kindLabel` troca o `kind`
 * no subtítulo do tipo (o grupo mostra o nível).
 */
export function NodeHeader({ node, extra, kindLabel }: { node: NodeView; extra?: ReactNode; kindLabel?: string }) {
  const kind = kindLabel ?? (node.props.kind as string | undefined);
  const description = node.props.description as string | undefined;
  return (
    <PageHeader
      overline={`${typeLabel(node.type)}${kind ? ` · ${kind}` : ""}`}
      title={nameOf(node)}
      subtitle={
        <>
          <code>{node.key}</code>
          {node.aliases.length > 0 && <> · apelidos: {node.aliases.map((a) => <code key={a}>{a} </code>)}</>}
          {description && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
          )}
        </>
      }
      actions={
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {extra}
          {node.status === "stale" && <Chip size="small" label="fora do retrato atual" variant="outlined" />}
          {node.referenced ? (
            <Chip size="small" label="só referenciado" variant="outlined" title="Nenhuma fonte declarou este nó: ele existe só como ponta de relação" />
          ) : (
            <FactsBadge facts={node.facts} title={nameOf(node)} subtitle="Afirmações de existência" />
          )}
        </Stack>
      }
    />
  );
}

/** Abas guardadas na URL (`?aba=`). */
export function useTab(tabs: string[]): [string, (v: string) => void] {
  const [tab, setTab] = useUrlParam("aba");
  return [tabs.includes(tab) ? tab : tabs[0], (v) => setTab(v === tabs[0] ? "" : v)];
}

export function TabBar({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
      <Tabs value={value} onChange={(_, v) => onChange(v)} variant="scrollable" allowScrollButtonsMobile>
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} />
        ))}
      </Tabs>
    </Box>
  );
}

/** Todas as relações de um nó (node_get), agrupadas por tipo e direção. */
export function Relations({ nodeKey, header = false }: { nodeKey: string; header?: boolean }) {
  const query = useGraphQuery<NodeGet>("node_get", { node: nodeKey });
  return (
    <QueryView query={query}>
      {(data) => (
        <>
          {header && <NodeHeader node={data.node} />}
          {data.relations.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nenhuma relação.
            </Typography>
          )}
          {data.relations.map((g) => (
            <Section key={`${g.type}:${g.direction}`} title={`${relationLabel(g.type, g.direction)} (${g.type})`} count={g.total}>
              <EdgeList edges={g.edges} owner={nameOf(data.node)} showType />
              {g.truncated && (
                <Typography variant="caption" color="text.secondary">
                  Mostrando {g.edges.length} de {g.total}.
                </Typography>
              )}
            </Section>
          ))}
        </>
      )}
    </QueryView>
  );
}
