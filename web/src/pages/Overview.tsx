import { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Chip, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { Overview as OverviewT } from "@/lib/types";
import { overviewGraph } from "@/lib/graphLayout";
import { formatDate } from "@/lib/facts";
import { NODE_TYPES, channelWords, displayName } from "@/lib/nodes";
import { useTo, useUrlParam } from "@/lib/nav";
import { QueryView } from "@/components/QueryView";
import { PageHeader, Section } from "@/components/Section";
import { GraphView } from "@/components/GraphView";
import { GraphLayers, useLayers } from "@/components/GraphLayers";
import { Coverage } from "@/components/Coverage";
import { NodePicker } from "@/components/NodePicker";
import { NodeLink } from "@/components/NodeLink";
import { FactsBadge } from "@/components/FactsBadge";

/** A arquitetura numa tela: componentes e dependências em grafo, tópicos, contagem por tipo, fontes e lacunas. */
export function Overview() {
  const [domain, setDomain] = useUrlParam("dominio");
  const [team, setTeam] = useUrlParam("time");
  const [environment, setEnvironment] = useUrlParam("ambiente");
  const query = useGraphQuery<OverviewT>("architecture_overview", { domain, team, environment });
  const to = useTo();

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle="Componentes e o que eles usam: APIs, tópicos e, nas camadas, bancos, cache e mensageria. Com um ambiente, só os recursos dele, e cada componente na versão implantada ali. Clique numa seta para ver quem afirmou."
        actions={
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <NodePicker label="Domínio" types={["Domain"]} value={domain} onChange={setDomain} width={220} />
            <NodePicker label="Time" types={["Group"]} value={team} onChange={setTeam} width={240} />
            <NodePicker label="Ambiente" types={["Environment"]} value={environment} onChange={setEnvironment} width={180} />
          </Stack>
        }
      />
      <QueryView query={query}>
        {(data) => (
          <>
            <Coverage notes={data.gaps} />
            <OverviewGraph data={data} />
            <Section title="Nós por tipo">
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                {Object.entries(data.nodes.current).map(([type, n]) => (
                  <Chip
                    key={type}
                    label={`${NODE_TYPES[type]?.plural ?? type}: ${n}`}
                    variant="outlined"
                    clickable
                    component={RouterLink}
                    to={to(`/busca?tipo=${encodeURIComponent(type)}`)}
                  />
                ))}
              </Stack>
              {data.nodes.staleHidden && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Fora do retrato atual (nenhuma fonte afirma mais):{" "}
                  {Object.entries(data.nodes.staleHidden)
                    .map(([t, n]) => `${NODE_TYPES[t]?.plural ?? t} ${n}`)
                    .join(", ")}
                  . Ligue "Incluir o que sumiu" para vê-los.
                </Typography>
              )}
            </Section>
            <Section title="Tópicos" count={data.topics.length}>
              {data.topics.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nenhum tópico no recorte.
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tópico</TableCell>
                      <TableCell>Publicam</TableCell>
                      <TableCell>Assinam</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.topics.map((t) => (
                      <TableRow key={t.key}>
                        <TableCell>
                          <NodeLink node={{ key: t.key }} />
                          {t.kind === "queue" && <Chip size="small" label="fila" variant="outlined" sx={{ ml: 1 }} />}
                        </TableCell>
                        {[t.publishers, t.subscribers].map((list, i) => (
                          <TableCell key={i}>
                            <Stack spacing={0.5}>
                              {list.map((p) => (
                                <Stack key={p.key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                  <NodeLink node={{ key: p.key }} />
                                  <FactsBadge facts={p.facts} title={`${displayName(p)} ${i === 0 ? channelWords(t.kind).publish : channelWords(t.kind).subscribe} ${displayName(t)}`} />
                                </Stack>
                              ))}
                              {list.length === 0 && "—"}
                            </Stack>
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
            <Section
              title="Fontes carregadas"
              count={data.sources.length}
              actions={
                <Link component={RouterLink} to={to("/fontes")} variant="body2">
                  Ver escopos e cargas
                </Link>
              }
            >
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                {data.sources.map((s) => (
                  <Chip key={s.source} label={`${s.source} · ${s.scopes} escopo${s.scopes > 1 ? "s" : ""} · ${formatDate(s.lastObservedAt)}`} />
                ))}
              </Stack>
            </Section>
          </>
        )}
      </QueryView>
    </>
  );
}

function OverviewGraph({ data }: { data: OverviewT }) {
  const [layers, toggle] = useLayers();
  const { nodes, edges, groups } = useMemo(() => overviewGraph(data, layers), [data, layers]);
  return (
    <Section title="Componentes e dependências" count={data.components.length}>
      <GraphLayers layers={layers} onToggle={toggle} />
      <GraphView nodes={nodes} edges={edges} groups={groups} height={Math.min(720, 160 + nodes.length * 50)} />
    </Section>
  );
}
