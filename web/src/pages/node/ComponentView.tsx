import { useMemo } from "react";
import { Alert, Button, Chip, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type {
  ApiConsumers,
  ComponentCompare,
  ComponentGet,
  ComponentLibraries,
  Dependencies,
  DependenciesOfKind,
  DependencyGraph as DependencyGraphData,
  Deployment,
  Edge,
  NodeRef,
  Overview,
} from "@/lib/types";
import { fromDependencyEdges, overviewGraph, toGraphNode } from "@/lib/graphLayout";
import { formatDate, propsSummary } from "@/lib/facts";
import { displayName, environmentRank } from "@/lib/nodes";
import { useSetUrlParams, useUrlParam } from "@/lib/nav";
import { QueryView } from "@/components/QueryView";
import { Section } from "@/components/Section";
import { EdgeList } from "@/components/EdgeList";
import { FactsBadge } from "@/components/FactsBadge";
import { NodeLink } from "@/components/NodeLink";
import { GraphView } from "@/components/GraphView";
import { GraphLayers, useLayers } from "@/components/GraphLayers";
import { Coverage } from "@/components/Coverage";
import { TechIcon } from "@/components/TechIcon";
import { NodePicker } from "@/components/NodePicker";
import { LibraryUseTable } from "@/components/LibraryUseTable";
import { techOf } from "@/lib/tech";
import { NodeHeader, Relations, TabBar, nameOf, useTab } from "./common";
import { LibraryUsers } from "./LibraryView";

const TABS = [
  { id: "ficha", label: "Ficha" },
  { id: "vizinhanca", label: "Vizinhança" },
  { id: "dependencias", label: "Dependências" },
  { id: "consumidores", label: "Quem consome" },
  { id: "bibliotecas", label: "Bibliotecas" },
  { id: "comparacao", label: "Comparação" },
  { id: "relacoes", label: "Todas as relações" },
];

/** Componente do tipo biblioteca: quem o usa são os componentes que dependem dos pacotes que ele gera. */
const library = (data: ComponentGet) => data.component.props.kind === "library";

/**
 * Numa biblioteca, "Quem consome" vira "Quem usa", e a aba Dependências sai: ela mostra quem chama quem em execução
 * (API e tópico), e o código de uma biblioteca só roda dentro de quem a usa. Do que ela depende está em Bibliotecas.
 */
const tabsOf = (data: ComponentGet) => (library(data) ? TABS.filter((t) => t.id !== "dependencias").map((t) => (t.id === "consumidores" ? { ...t, label: "Quem usa" } : t)) : TABS);

/**
 * Componente: a ficha (component_get) e, em abas, a vizinhança, as dependências, os consumidores (ou, numa biblioteca,
 * quem usa os pacotes que ela gera), a comparação entre retratos e as relações. Com um ambiente (`?ambiente=`), a ficha, a vizinhança, as dependências e os consumidores
 * mostram a versão implantada nele; sem, a linha principal.
 */
export function ComponentView({ nodeKey }: { nodeKey: string }) {
  const [urlTab, setTab] = useTab(TABS.map((t) => t.id));
  const [environment, setEnvironment] = useUrlParam("ambiente");
  const query = useGraphQuery<ComponentGet>("component_get", { component: nodeKey, environment });
  return (
    <QueryView query={query} showQuery={urlTab === "ficha"}>
      {(data) => {
        // Link antigo para a aba que a biblioteca não tem: abre a ficha.
        const tab = tabsOf(data).some((t) => t.id === urlTab) ? urlTab : "ficha";
        return (
          <>
            <NodeHeader node={data.component} />
            <ViewBar data={data} environment={environment} onEnvironment={setEnvironment} />
            <TabBar tabs={tabsOf(data)} value={tab} onChange={setTab} />
            {tab === "ficha" && <Sheet data={data} onLibraries={() => setTab("bibliotecas")} />}
            {tab === "vizinhanca" && <Neighborhood nodeKey={data.component.key} environment={environment} />}
            {tab === "dependencias" && <DependenciesTab nodeKey={data.component.key} environment={environment} />}
            {tab === "consumidores" &&
              (library(data) ? <LibraryUsers library={data.component.key} environment={environment} /> : <Consumers target={data.component.key} environment={environment} />)}
            {tab === "bibliotecas" && <LibrariesTab nodeKey={data.component.key} environment={environment} />}
            {tab === "comparacao" && <Comparison nodeKey={data.component.key} deployments={data.deployments} />}
            {tab === "relacoes" && <Relations nodeKey={data.component.key} />}
          </>
        );
      }}
    </QueryView>
  );
}

const shortSha = (sha: string) => sha.slice(0, 8);

/** Que retrato a tela mostra: a linha principal (com a versão e o commit dela) ou a versão implantada num ambiente. */
function ViewBar({ data, environment, onEnvironment }: { data: ComponentGet; environment: string; onEnvironment: (v: string) => void }) {
  const here = data.environment ? data.deployments.filter((d) => d.environment.key === data.environment && d.status === "current") : [];
  const line = data.revision ? `versão ${data.revision.version ?? "sem rótulo"}, commit ${shortSha(data.revision.commit)}` : "sem versão informada";
  return (
    <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mb: 2 }}>
      <NodePicker label="Ver como está no ambiente" types={["Environment"]} value={environment} onChange={onEnvironment} width={240} />
      {!data.environment && (
        <Typography variant="body2" color="text.secondary">
          Linha principal (o código mais recente publicado): {line}.
        </Typography>
      )}
      {data.environment && here.length > 0 && (
        <Typography variant="body2">
          Em {displayName(here[0].environment)}: {here.map((d) => `versão ${d.version} (commit ${shortSha(d.commit)})`).join(" e ")}.
          {here.some((d) => !d.frozen) && " O grafo não tem o retrato desta versão: o que aparece abaixo é a linha principal."}
        </Typography>
      )}
      {data.environment && here.length === 0 && (
        <Alert severity="info" sx={{ py: 0 }}>
          Nenhuma fonte informa que o componente está implantado neste ambiente: o que aparece abaixo é a linha principal.
        </Alert>
      )}
    </Stack>
  );
}

/** Logo da tecnologia na stack, quando há um em `images/`. */
const stackLogo = { header: "", render: (e: Edge) => <TechIcon tech={techOf([e.node.key])} variant="logo" size={20} /> };

/** Recursos na ordem dos ambientes até a produção: o do recurso ou o da instância em que ele está. */
const resourceRank = (r: ComponentGet["resources"][number]) =>
  Math.min(...[...r.environments, ...r.hostedOn.flatMap((h) => h.environments)].map((e) => environmentRank(e.node.kind)), Infinity);

const whereItRuns = {
  header: "Onde roda",
  render: (e: Edge) => <ResourceChain resource={e as ComponentGet["resources"][number]} />,
};

function Sheet({ data, onLibraries }: { data: ComponentGet; onLibraries: () => void }) {
  const name = nameOf(data.component);
  const resources = [...data.resources].sort((a, b) => resourceRank(a) - resourceRank(b) || a.node.key.localeCompare(b.node.key));
  const databases = resources.filter((r) => r.node.kind === "database");
  const others = resources.filter((r) => r.node.kind !== "database");
  // Uma biblioteca não roda sozinha: no lugar das APIs, os pacotes que ela gera, e o que é de execução (implantação,
  // bancos, recursos, saídas e dados) só aparece se alguma fonte afirmar.
  const lib = library(data);
  const runtime = (count: number) => !lib || count > 0;
  return (
    <>
      {runtime(data.deployments.length) && <Deployments name={name} deployments={data.deployments} />}
      <Section title="Dono" count={data.owners.length}>
        <EdgeList edges={data.owners} owner={name} empty="Nenhum dono afirmado." />
      </Section>
      <Section title="Sistema e domínio">
        <EdgeList
          edges={data.systems}
          owner={name}
          empty="Nenhum sistema afirmado."
          extra={{
            header: "Domínio",
            render: (e) => (
              <Stack spacing={0.5}>
                {(e as ComponentGet["systems"][number]).domains.map((d) => (
                  <Stack key={d.node.key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <NodeLink node={d.node} />
                    <FactsBadge facts={d.facts} title={`${displayName(e.node)} faz parte de ${displayName(d.node)}`} />
                  </Stack>
                ))}
              </Stack>
            ),
          }}
        />
      </Section>
      <Section title="Repositório">
        <EdgeList edges={data.repositories} owner={name} empty="Nenhum repositório afirmado." />
      </Section>
      <Section title="Stack" count={data.stack.length}>
        <EdgeList edges={data.stack} owner={name} extra={stackLogo} />
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {data.libraries.count} biblioteca{data.libraries.count === 1 ? "" : "s"}, diretas e transitivas.
          </Typography>
          {data.libraries.count > 0 && (
            <Button size="small" onClick={onLibraries}>
              Ver as bibliotecas
            </Button>
          )}
        </Stack>
      </Section>
      {lib && (
        <Section title="Pacotes que gera" count={data.packages.length}>
          <EdgeList edges={data.packages} owner={name} empty="Nenhum pacote afirmado." />
        </Section>
      )}
      {runtime(data.provides.length) && (
        <Section title="APIs oferecidas" count={data.provides.length}>
          {data.provides.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nenhuma API afirmada.
            </Typography>
          )}
          {data.provides.map((api) => (
            <Stack key={api.node.key} spacing={1} sx={{ mb: 2 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <NodeLink node={api.node} showType />
                <FactsBadge facts={api.facts} title={`${name} oferece ${displayName(api.node)}`} />
              </Stack>
              <EdgeList edges={api.endpoints} owner={displayName(api.node)} empty="Nenhum endpoint afirmado." />
            </Stack>
          ))}
        </Section>
      )}
      {runtime(databases.length) && (
        <Section title="Bancos de dados" count={databases.length}>
          <EdgeList edges={databases} owner={name} empty="Nenhum banco afirmado." extra={whereItRuns} />
        </Section>
      )}
      {runtime(others.length) && (
        <Section title="Outros recursos (cache, mensageria...)" count={others.length}>
          <EdgeList edges={others} owner={name} empty="Nenhum outro recurso afirmado." extra={whereItRuns} />
        </Section>
      )}
      {runtime(data.reachesVia.length) && (
        <Section title="Sai por (gateway, ingress)" count={data.reachesVia.length}>
          <EdgeList edges={data.reachesVia} owner={name} empty="Nenhuma saída afirmada." />
        </Section>
      )}
      {runtime(data.data.length) && (
        <Section title="Dados" count={data.data.length}>
          {data.data.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nenhum dataset afirmado.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Dataset</TableCell>
                  <TableCell>Dono da estrutura</TableCell>
                  <TableCell>Lê</TableCell>
                  <TableCell>Escreve</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.data.map((d) => (
                  <TableRow key={d.dataset.key}>
                    <TableCell>
                      <NodeLink node={d.dataset} />
                    </TableCell>
                    {(["owns", "reads", "writes"] as const).map((k) => (
                      <TableCell key={k}>
                        {d[k] ? (
                          <FactsBadge facts={d[k]!} title={`${name} ${k === "owns" ? "é dono da estrutura de" : k === "reads" ? "lê" : "escreve"} ${displayName(d.dataset)}`} />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      )}
    </>
  );
}

/** Onde o componente roda: uma linha por ambiente e commit, em ordem até a produção, com a comparação com a linha principal. */
function Deployments({ name, deployments }: { name: string; deployments: Deployment[] }) {
  const setParams = useSetUrlParams();
  return (
    <Section title="Implantações" count={deployments.filter((d) => d.status === "current").length}>
      {deployments.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nenhuma implantação afirmada.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Ambiente</TableCell>
              <TableCell>Versão</TableCell>
              <TableCell>Commit</TableCell>
              <TableCell>Desde</TableCell>
              <TableCell>Linha principal</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {deployments.map((d) => (
              <TableRow key={`${d.environment.key}@${d.commit}`} sx={d.status === "stale" ? { opacity: 0.6 } : undefined}>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <NodeLink node={d.environment} />
                    <FactsBadge facts={d.facts} title={`${name} está implantado em ${displayName(d.environment)}`} />
                    {d.status === "stale" && <Chip size="small" variant="outlined" label={`saiu em ${formatDate(d.lastSeen)}`} />}
                  </Stack>
                </TableCell>
                <TableCell>{d.version}</TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>{shortSha(d.commit)}</TableCell>
                <TableCell>{formatDate(d.since)}</TableCell>
                <TableCell>
                  {d.sameAsDefault === null ? "—" : d.sameAsDefault ? <Chip size="small" color="success" variant="outlined" label="mesmo commit" /> : <Chip size="small" color="warning" variant="outlined" label="outro commit" />}
                </TableCell>
                <TableCell>
                  {d.status === "current" && d.frozen && d.sameAsDefault === false && (
                    <Button size="small" onClick={() => setParams({ aba: "comparacao", de: d.environment.key, para: "" })}>
                      Comparar com a linha principal
                    </Button>
                  )}
                  {d.status === "current" && !d.frozen && (
                    <Typography variant="caption" color="text.secondary">
                      sem retrato desta versão
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

const COMPARE_LABELS: Record<string, string> = {
  endpoints: "Endpoints oferecidos",
  consumes: "APIs consumidas",
  calls: "Endpoints chamados",
  publishes: "Tópicos publicados",
  subscribes: "Tópicos assinados",
  owns: "Datasets (dono da estrutura)",
  reads: "Datasets lidos",
  writes: "Datasets escritos",
  resources: "Recursos usados",
  libraries: "Bibliotecas diretas",
  stack: "Stack",
};

/** O que mudou entre dois retratos do componente (component_compare): um ambiente e a linha principal, ou dois ambientes. */
function Comparison({ nodeKey, deployments }: { nodeKey: string; deployments: Deployment[] }) {
  const [fromParam, setFrom] = useUrlParam("de");
  const [to, setTo] = useUrlParam("para");
  const from = fromParam || deployments.find((d) => d.status === "current" && d.frozen && d.sameAsDefault === false)?.environment.key || "";
  const same = from === to;
  const query = useGraphQuery<ComponentCompare>("component_compare", { component: nodeKey, from, to }, { enabled: !same });
  const side = (s: ComponentCompare["from"]) =>
    s.line
      ? `linha principal${s.version ? `, versão ${s.version}` : ""}${s.commit ? ` (${shortSha(s.commit)})` : ""}`
      : `${displayName({ key: s.environment ?? "" })}${s.version ? `, versão ${s.version}` : ""}${s.commit ? ` (${s.commit.split(", ").map(shortSha).join(", ")})` : ""}`;
  return (
    <>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mb: 2 }}>
        <NodePicker label="De (vazio: linha principal)" types={["Environment"]} value={from} onChange={setFrom} width={240} />
        <Typography>→</Typography>
        <NodePicker label="Para (vazio: linha principal)" types={["Environment"]} value={to} onChange={setTo} width={240} />
      </Stack>
      {same ? (
        <Typography variant="body2" color="text.secondary">
          Escolha dois retratos diferentes: um ambiente e a linha principal, ou dois ambientes.
        </Typography>
      ) : (
        <QueryView query={query}>
          {(data) => (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                De {side(data.from)} para {side(data.to)}.
              </Typography>
              {[data.from.note, data.to.note].filter(Boolean).map((n) => (
                <Alert key={n} severity="info" sx={{ mb: 1 }}>
                  {n}
                </Alert>
              ))}
              {data.same && (
                <Typography variant="body2" color="text.secondary">
                  Nada mudou no que o componente oferece, consome e usa.
                </Typography>
              )}
              {Object.entries(data.changes).map(([cat, c]) => (
                <Section key={cat} title={COMPARE_LABELS[cat] ?? cat} count={c.added.length + c.removed.length + c.changed.length}>
                  <ChangeList label="Entrou" nodes={c.added} color="success" />
                  <ChangeList label="Saiu" nodes={c.removed} color="error" />
                  {c.changed.map((x) => (
                    <Stack key={x.node.key} direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
                      <Chip size="small" variant="outlined" color="warning" label="Mudou" />
                      <NodeLink node={x.node} />
                      <Typography variant="body2" color="text.secondary">
                        {x.from || x.to ? `${x.from ?? "—"} → ${x.to ?? "—"}` : "contrato diferente"}
                      </Typography>
                    </Stack>
                  ))}
                </Section>
              ))}
            </>
          )}
        </QueryView>
      )}
    </>
  );
}

function ChangeList({ label, nodes, color }: { label: string; nodes: NodeRef[]; color: "success" | "error" }) {
  return nodes.map((n) => (
    <Stack key={n.key} direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
      <Chip size="small" variant="outlined" color={color} label={label} />
      <NodeLink node={n} />
    </Stack>
  ));
}

/** Banco → servidor → ambiente, motor e versão, cada passo com as suas afirmações. */
function ResourceChain({ resource }: { resource: ComponentGet["resources"][number] }) {
  const environments = (of: Edge["node"], edges: Edge[]) =>
    edges.map((e) => (
      <Stack key={e.node.key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2">no ambiente</Typography>
        <NodeLink node={e.node} />
        <FactsBadge facts={e.facts} title={`${displayName(of)} está no ambiente ${displayName(e.node)}`} />
      </Stack>
    ));
  const runs = (edges: Edge[]) =>
    edges.map((r) => (
      <Stack key={r.node.key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2">roda</Typography>
        <NodeLink node={r.node} />
        <Typography variant="body2" color="text.secondary">
          {propsSummary(r.facts, ["version"])}
        </Typography>
        <FactsBadge facts={r.facts} title={`${displayName(resource.node)} roda ${displayName(r.node)}`} />
      </Stack>
    ));
  return (
    <Stack spacing={0.5}>
      {environments(resource.node, resource.environments)}
      {runs(resource.runs)}
      {resource.hostedOn.map((h) => (
        <Stack key={h.node.key} spacing={0.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="body2">em</Typography>
            <NodeLink node={h.node} />
            <FactsBadge facts={h.facts} title={`${displayName(resource.node)} hospedado em ${displayName(h.node)}`} />
          </Stack>
          <Stack sx={{ pl: 2 }}>
            {environments(h.node, h.environments)}
            {runs(h.runs)}
          </Stack>
        </Stack>
      ))}
      {resource.runs.length === 0 && resource.hostedOn.length === 0 && resource.environments.length === 0 && "—"}
    </Stack>
  );
}

const LIBRARY_FILTERS = [
  { id: "", label: "Diretas" },
  { id: "todas", label: "Diretas e transitivas" },
  { id: "sem-uso", label: "Declaradas sem uso" },
];

/** As bibliotecas do componente (component_libraries): as diretas, as transitivas sob pedido e as declaradas sem uso. */
function LibrariesTab({ nodeKey, environment }: { nodeKey: string; environment: string }) {
  const [filter, setFilter] = useUrlParam("bibliotecas");
  const query = useGraphQuery<ComponentLibraries>("component_libraries", { component: nodeKey, transitive: filter === "todas" || undefined, unused: filter === "sem-uso" || undefined, environment });
  return (
    <>
      <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mb: 2 }}>
        <TextField select size="small" label="Mostrar" value={filter} onChange={(e) => setFilter(e.target.value)} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} sx={{ width: 220 }}>
          {LIBRARY_FILTERS.map((f) => (
            <MenuItem key={f.id} value={f.id}>
              {f.label}
            </MenuItem>
          ))}
        </TextField>
        {query.data && (
          <Typography variant="body2" color="text.secondary">
            {query.data.counts.direct} direta{query.data.counts.direct === 1 ? "" : "s"}, {query.data.counts.transitive} transitiva{query.data.counts.transitive === 1 ? "" : "s"}
            {query.data.counts.unused > 0 && `, ${query.data.counts.unused} declarada${query.data.counts.unused === 1 ? "" : "s"} sem uso`}.
          </Typography>
        )}
      </Stack>
      <QueryView query={query}>
        {(data) => (
          <>
            <Section title={LIBRARY_FILTERS.find((f) => f.id === filter)?.label ?? "Bibliotecas"} count={data.libraries.length}>
              <LibraryUseTable uses={data.libraries} owner={nameOf(data.component)} header="Biblioteca" empty={filter === "sem-uso" ? "Nenhuma declarada sem uso (ou nenhuma fonte analisa o uso)." : "Nenhuma afirmada."} />
            </Section>
          </>
        )}
      </QueryView>
    </>
  );
}

const DEPTHS = [1, 2, 3, 4, 5];

function Neighborhood({ nodeKey, environment }: { nodeKey: string; environment: string }) {
  const [depthParam, setDepth] = useUrlParam("niveis");
  const depth = Number(depthParam) || 1;
  const query = useGraphQuery<Overview>("architecture_overview", { component: nodeKey, depth, environment });
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
        <TextField select size="small" label="Níveis" value={depth} onChange={(e) => setDepth(e.target.value === "1" ? "" : e.target.value)} sx={{ width: 120 }}>
          {DEPTHS.map((d) => (
            <MenuItem key={d} value={d}>
              {d}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          De quem ele depende e quem depende dele, até {depth} nível{depth > 1 ? "s" : ""}.
        </Typography>
      </Stack>
      <QueryView query={query}>{(data) => <NeighborhoodGraph data={data} />}</QueryView>
    </>
  );
}

function NeighborhoodGraph({ data }: { data: Overview }) {
  const [layers, toggle] = useLayers();
  const { nodes, edges, groups } = useMemo(() => overviewGraph(data, layers), [data, layers]);
  return (
    <>
      <GraphLayers layers={layers} onToggle={toggle} />
      <GraphView nodes={nodes} edges={edges} groups={groups} />
    </>
  );
}

function DependenciesTab({ nodeKey, environment }: { nodeKey: string; environment: string }) {
  const [direction, setDirection] = useUrlParam("direcao");
  const [depthParam, setDepth] = useUrlParam("profundidade");
  const [kind, setKind] = useUrlParam("tipo");
  const dir = direction || "out";
  const depth = Number(depthParam) || 1;
  const query = useGraphQuery<Dependencies>("component_dependencies", { component: nodeKey, direction: dir, depth, kind, environment });
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", mb: 2 }} useFlexGap>
        <TextField select size="small" label="Direção" value={dir} onChange={(e) => setDirection(e.target.value === "out" ? "" : e.target.value)} sx={{ width: 220 }}>
          <MenuItem value="out">De quem ele depende</MenuItem>
          <MenuItem value="in">Quem depende dele</MenuItem>
          <MenuItem value="both">As duas</MenuItem>
        </TextField>
        <TextField select size="small" label="Profundidade" value={depth} onChange={(e) => setDepth(e.target.value === "1" ? "" : e.target.value)} sx={{ width: 130 }}>
          {DEPTHS.map((d) => (
            <MenuItem key={d} value={d}>
              {d}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Só do tipo" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ width: 150 }}>
          <MenuItem value="">Todos</MenuItem>
          {["service", "bff", "frontend", "job"].map((k) => (
            <MenuItem key={k} value={k}>
              {k}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <QueryView query={query}>{(data) => ("kind" in data ? <OfKind data={data} /> : <DependencyGraph data={data} />)}</QueryView>
    </>
  );
}

function DependencyGraph({ data }: { data: DependencyGraphData }) {
  const nodes = useMemo(() => data.components.map((c) => toGraphNode(c, data.root)), [data]);
  const edges = useMemo(() => fromDependencyEdges(data.edges), [data]);
  return (
    <>
      <GraphView nodes={nodes} edges={edges} />
      <Section title="Componentes" count={data.components.length - 1}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Componente</TableCell>
              <TableCell>Nível</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.components
              .filter((c) => c.key !== data.root)
              .map((c) => (
                <TableRow key={c.key}>
                  <TableCell>
                    <NodeLink node={c} />
                    {c.version && (
                      <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                        {c.version}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{c.level}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Section>
    </>
  );
}

/** Componentes de um tipo, cada um com os caminhos mais curtos até o componente. */
function OfKind({ data }: { data: DependenciesOfKind }) {
  if (data.components.length === 0) return <Coverage notes={[data.coverage?.note ?? "Nenhum componente deste tipo no percurso."]} />;
  return (
    <>
      {data.components.map((c) => (
        <Section key={c.key} title={displayName(c)} actions={<NodeLink node={c} />}>
          {c.paths.map((path, i) => (
            <Stack key={i} direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mb: 1 }}>
              {path.map((hop, j) => (
                <Stack key={j} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {j === 0 && <NodeLink node={{ key: hop.from }} />}
                  <FactsBadge
                    facts={[]}
                    title={`${displayName({ key: hop.from })} depende de ${displayName({ key: hop.to })}`}
                    sections={hop.via.flatMap((v) => [
                      { label: `${v.type} ${displayName(v.node)}: quem depende`, facts: v.facts.dependent },
                      { label: `${v.type} ${displayName(v.node)}: quem oferece`, facts: v.facts.provider },
                    ])}
                  />
                  <Typography>→</Typography>
                  <NodeLink node={{ key: hop.to }} />
                </Stack>
              ))}
            </Stack>
          ))}
        </Section>
      ))}
    </>
  );
}

/**
 * Quem consome as APIs do alvo (componente ou API), e quais endpoints chama; com `endpoint`, só quem chama aquele.
 * Com `environment`, o retrato das versões implantadas nele (cada consumidor com a versão em execução).
 */
export function Consumers({ target, endpoint, environment }: { target: string; endpoint?: string; environment?: string }) {
  const query = useGraphQuery<ApiConsumers>("api_consumers", { target, endpoint, environment });
  return (
    <QueryView query={query}>
      {(data) => (
        <>
          {data.consumers.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nenhum consumidor afirmado para {data.endpoint ? displayName({ key: data.endpoint }) : data.apis.length > 0 ? data.apis.map((a) => displayName({ key: a })).join(", ") : "as APIs deste componente"}.
            </Typography>
          )}
          {data.consumers.map((c) => (
            <Section
              key={c.component.key}
              title={c.component.version ? `${displayName(c.component)} · ${c.component.version}` : displayName(c.component)}
              actions={<NodeLink node={c.component} />}
            >
              <Typography variant="subtitle2">Consome</Typography>
              <EdgeList edges={c.consumes} owner={displayName(c.component)} />
              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                Chama
              </Typography>
              <EdgeList edges={c.calls} owner={displayName(c.component)} empty="Nenhum endpoint afirmado." />
            </Section>
          ))}
        </>
      )}
    </QueryView>
  );
}
