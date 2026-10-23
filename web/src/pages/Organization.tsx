import { useCallback, useMemo } from "react";
import { Autocomplete, Chip, Stack, TextField, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { OrgStructure } from "@/lib/types";
import { displayName } from "@/lib/nodes";
import { useUrlParam } from "@/lib/nav";
import { flatten } from "@/lib/orgLayout";
import { QueryView } from "@/components/QueryView";
import { PageHeader } from "@/components/Section";
import { OrgChart } from "@/components/OrgChart";

/**
 * Conjunto de chaves na URL (`?recolhidos=a,b`), para o link mostrar o mesmo desenho: os grupos com os subgrupos
 * recolhidos (`recolhidos`) e os tipos de posse abertos nos cartões (`posses`).
 */
export function useUrlSet(param: "recolhidos" | "posses"): [Set<string>, (key: string) => void] {
  const [value, setValue] = useUrlParam(param);
  const collapsed = useMemo(() => new Set(value.split(",").filter(Boolean)), [value]);
  const toggle = useCallback(
    (key: string) => {
      const next = new Set(collapsed);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setValue([...next].join(","));
    },
    [collapsed, setValue],
  );
  return [collapsed, toggle];
}

type Option = { key: string; label: string; kind: "pessoa" | "grupo" };

/** Estrutura organizacional em organograma: grupos, membros com papel e o que cada grupo possui (org_structure). */
export function Organization() {
  const query = useGraphQuery<OrgStructure>("org_structure", { depth: 5 });
  return (
    <>
      <PageHeader title="Organização" subtitle="Grupos, membros e o que cada grupo possui, com quem afirmou cada ligação. Clique num grupo para ver os detalhes." />
      <QueryView query={query}>
        {(data) => (
          <>
            {data.groups.length > 0 ? (
              <OrgView data={data} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Nenhum grupo afirmado.
              </Typography>
            )}
          </>
        )}
      </QueryView>
    </>
  );
}

function OrgView({ data }: { data: OrgStructure }) {
  const [root, setRoot] = useUrlParam("raiz");
  const [highlight, setHighlight] = useUrlParam("destaque");
  const [collapsed, toggle] = useUrlSet("recolhidos");
  const [expanded, expand] = useUrlSet("posses");

  const roots = useMemo(() => (root ? data.groups.filter((g) => g.key === root) : data.groups), [data.groups, root]);
  const options = useMemo(() => {
    const groups = flatten(data.groups);
    const people = new Map<string, string>();
    for (const g of groups) for (const m of g.members) people.set(m.node.key, displayName(m.node));
    const out: Option[] = [
      ...[...people].map(([key, label]) => ({ key, label, kind: "pessoa" as const })),
      ...groups.map((g) => ({ key: g.key, label: displayName({ key: g.key, name: g.props.name as string | undefined }), kind: "grupo" as const })),
    ];
    return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, "pt-BR"));
  }, [data.groups]);
  const selected = options.find((o) => o.key === highlight) ?? null;

  return (
    <>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ alignItems: { md: "center" }, mb: 1.5 }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", flex: 1 }}>
          <Chip label="Todos" color={root ? "default" : "primary"} variant={root ? "outlined" : "filled"} onClick={() => setRoot("")} />
          {data.groups.map((g) => (
            <Chip
              key={g.key}
              label={displayName({ key: g.key, name: g.props.name as string | undefined })}
              color={root === g.key ? "primary" : "default"}
              variant={root === g.key ? "filled" : "outlined"}
              onClick={() => setRoot(root === g.key ? "" : g.key)}
            />
          ))}
        </Stack>
        <Autocomplete<Option>
          size="small"
          sx={{ width: { xs: "100%", md: 320 } }}
          options={options}
          value={selected}
          groupBy={(o) => (o.kind === "pessoa" ? "Pessoas" : "Grupos")}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.key === b.key}
          onChange={(_, o) => setHighlight(o?.key ?? "")}
          renderInput={(params) => <TextField {...params} label="Destacar pessoa ou grupo" />}
        />
      </Stack>
      <OrgChart roots={roots} levels={data.levels} everyone={data.groups} collapsed={collapsed} onToggle={toggle} expanded={expanded} onExpand={expand} highlight={highlight || undefined} height="calc(100vh - 240px)" />
    </>
  );
}
