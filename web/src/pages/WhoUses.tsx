import type { ReactNode } from "react";
import { MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { ApiConsumers, Edge, Fact, TopicGet } from "@/lib/types";
import { channelWords, displayName } from "@/lib/nodes";
import { useSetUrlParams, useUrlParam } from "@/lib/nav";
import { QueryView } from "@/components/QueryView";
import { PageHeader, Section } from "@/components/Section";
import { NodePicker } from "@/components/NodePicker";
import { NodeLink } from "@/components/NodeLink";
import { FactsBadge } from "@/components/FactsBadge";
import { VersionsInUse, groupByVersion } from "@/components/VersionsInUse";
import { LibraryUsers } from "./node/LibraryView";

const KINDS = [
  { id: "api", label: "API", types: ["Api"], pick: "Escolha a API." },
  { id: "topico", label: "Tópico ou fila", types: ["Topic"], pick: "Escolha o tópico ou a fila." },
  { id: "biblioteca", label: "Biblioteca", types: ["Library", "Component"], pick: "Escolha a biblioteca, ou o componente que gera bibliotecas." },
];

/**
 * Quem usa uma API (api_consumers), um tópico (topic_get) ou uma biblioteca (library_usage), e em que versão.
 * API e tópico vêm com todas as versões, ou com uma escolhida; biblioteca, com faixa de versão e uso direto ou
 * transitivo. Tudo na URL, para mandar a pergunta pronta.
 */
export function WhoUses() {
  const [kindParam] = useUrlParam("tipo");
  const [item] = useUrlParam("item");
  const [environment] = useUrlParam("ambiente");
  const set = useSetUrlParams();
  const kind = KINDS.find((k) => k.id === kindParam) ?? KINDS[0];
  return (
    <>
      <PageHeader title="Quem usa" subtitle="Quem consome uma API, publica ou assina um tópico, ou depende de uma biblioteca, e em que versão." />
      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
        <TextField select size="small" label="O quê" value={kind.id} onChange={(e) => set({ tipo: e.target.value, item: "", versao: "", faixa: "", uso: "" })} sx={{ width: 180 }}>
          {KINDS.map((k) => (
            <MenuItem key={k.id} value={k.id}>
              {k.label}
            </MenuItem>
          ))}
        </TextField>
        <NodePicker key={kind.id} label={kind.label} types={kind.types} value={item} onChange={(k) => set({ item: k, versao: "" })} width={320} />
        <NodePicker label="Ambiente" types={["Environment"]} value={environment} onChange={(v) => set({ ambiente: v })} width={180} />
      </Stack>
      {!item ? (
        <Typography color="text.secondary">{kind.pick} Sem ambiente, vale o código mais recente publicado; com ambiente, o que roda nele.</Typography>
      ) : kind.id === "api" ? (
        <ApiUsers item={item} environment={environment} />
      ) : kind.id === "topico" ? (
        <TopicUsers item={item} environment={environment} />
      ) : (
        <LibraryUsers library={item} environment={environment} header={(data) => <ItemLine node={data.library} />} />
      )}
    </>
  );
}

function ApiUsers({ item, environment }: { item: string; environment: string }) {
  const [version] = useUrlParam("versao");
  const query = useGraphQuery<ApiConsumers>("api_consumers", { target: version || item, allVersions: version ? undefined : true, environment });
  return (
    <QueryView query={query}>
      {(data) => {
        const rows: UseRow[] = data.consumers.map((c) => {
          const versions = [...new Set(c.consumes.map((e) => e.node.version).filter((v): v is string => !!v))];
          return {
            component: c.component,
            versions,
            how: (
              <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="body2">{c.consumes.length > 0 ? "Consome" : "Chama"}</Typography>
                {c.calls.map((e) => (
                  <NodeLink key={e.node.key} node={e.node} />
                ))}
              </Stack>
            ),
            facts: [...c.consumes, ...c.calls].flatMap((e) => e.facts),
          };
        });
        return (
          <>
            <ItemLine node={{ key: data.target }} />
            <VersionSelect versions={data.versions ?? []} />
            <UsageSections rows={rows} order={(data.versions ?? []).map((v) => v.version)} />
          </>
        );
      }}
    </QueryView>
  );
}

function TopicUsers({ item, environment }: { item: string; environment: string }) {
  const [version] = useUrlParam("versao");
  const query = useGraphQuery<TopicGet>("topic_get", { topic: version || item, allVersions: version ? undefined : true, environment });
  return (
    <QueryView query={query}>
      {(data) => {
        const words = channelWords(data.topic.props.kind);
        const own = typeof data.topic.props.version === "string" ? data.topic.props.version : undefined;
        const row = (e: TopicGet["publishers"][number], how: string): UseRow => ({
          component: e.node,
          versions: data.allVersions ? (e.version ? [e.version] : []) : own ? [own] : [],
          how: <Typography variant="body2">{how}</Typography>,
          facts: e.facts,
        });
        const rows = [...data.publishers.map((e) => row(e, words.publish)), ...data.subscribers.map((e) => row(e, words.subscribe))];
        return (
          <>
            <ItemLine node={data.topic} />
            <VersionSelect versions={data.versions} />
            <UsageSections rows={rows} order={data.versions.map((v) => v.version)} />
          </>
        );
      }}
    </QueryView>
  );
}

/** A interface consultada, com o link para a página dela. */
function ItemLine({ node }: { node: { key: string; name?: string | null; type?: string } }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Página de
      </Typography>
      <NodeLink node={node} showType />
    </Stack>
  );
}

/** Todas as versões ou uma delas (`?versao=<chave>`). Só aparece quando a interface tem mais de uma versão. */
function VersionSelect({ versions }: { versions: { key: string; version?: string }[] }) {
  const [version, setVersion] = useUrlParam("versao");
  if (versions.length < 2) return null;
  return (
    <TextField
      select
      size="small"
      label="Versão"
      value={version}
      onChange={(e) => setVersion(e.target.value)}
      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
      sx={{ width: 220, mb: 2 }}
    >
      <MenuItem value="">Todas as versões</MenuItem>
      {[...versions].reverse().map((v) => (
        <MenuItem key={v.key} value={v.key}>
          {v.version ?? "sem versão"}
        </MenuItem>
      ))}
    </TextField>
  );
}

type UseRow = { component: Edge["node"]; versions: string[]; how: ReactNode; facts: Fact[] };

/** Versões em uso (a mais nova primeiro) e a tabela de quem usa, uma linha por componente e forma de uso. */
function UsageSections({ rows, order }: { rows: UseRow[]; order: (string | undefined)[] }) {
  const newestFirst = [...order].reverse();
  const versions = groupByVersion(
    rows.flatMap((r): { version: string | null; component: string }[] => (r.versions.length ? r.versions.map((v) => ({ version: v, component: r.component.key })) : [{ version: null, component: r.component.key }])),
    newestFirst,
  );
  const showVersions = versions.some((v) => v.version !== null);
  return (
    <>
      {showVersions && (
        <Section title="Versões em uso" count={versions.length}>
          <VersionsInUse versions={versions} empty="sem versão declarada" />
        </Section>
      )}
      <Section title="Quem usa" count={rows.length}>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Ninguém afirma usar.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Componente</TableCell>
                {showVersions && <TableCell>Versão</TableCell>}
                <TableCell>Como usa</TableCell>
                <TableCell align="right">Fontes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.component.key}-${i}`} hover>
                  <TableCell>
                    <NodeLink node={r.component} stale={r.facts.length > 0 && r.facts.every((f) => f.status === "stale")} />
                  </TableCell>
                  {showVersions && <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{r.versions.join(", ") || "—"}</TableCell>}
                  <TableCell>{r.how}</TableCell>
                  <TableCell align="right">
                    <FactsBadge facts={r.facts} title={displayName(r.component)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </>
  );
}
