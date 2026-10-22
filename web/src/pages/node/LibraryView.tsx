import { useEffect, useState, type ReactNode } from "react";
import { MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { LibraryUsage } from "@/lib/types";
import { useUrlParam } from "@/lib/nav";
import { QueryView } from "@/components/QueryView";
import { Section } from "@/components/Section";
import { VersionsInUse } from "@/components/VersionsInUse";
import { LibraryUseTable } from "@/components/LibraryUseTable";
import { NodeLink } from "@/components/NodeLink";
import { NodeHeader, nameOf } from "./common";

const USE_FILTERS = [
  { id: "", label: "Diretos e transitivos" },
  { id: "direto", label: "Só diretos" },
  { id: "transitivo", label: "Só transitivos" },
];

/**
 * Biblioteca: as versões em uso e quem depende dela, em que versão e se direto ou por qual dependência direta, com
 * filtro de faixa e de uso (library_usage).
 */
export function LibraryView({ nodeKey }: { nodeKey: string }) {
  return <LibraryUsers library={nodeKey} header={(data) => <NodeHeader node={data.library} />} />;
}

/** As versões em uso e quem usa a biblioteca, com os filtros de faixa e de uso na URL. Também na tela "Quem usa". */
export function LibraryUsers({ library, environment, header }: { library: string; environment?: string; header?: (data: LibraryUsage) => ReactNode }) {
  const [range, setRange] = useUrlParam("faixa");
  const [use, setUse] = useUrlParam("uso");
  const [input, setInput] = useState(range);
  useEffect(() => {
    const t = setTimeout(() => setRange(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input, setRange]);
  const direct = use === "direto" ? true : use === "transitivo" ? false : undefined;
  const query = useGraphQuery<LibraryUsage>("library_usage", { library, versionRange: range, direct, environment });
  return (
    <QueryView query={query}>
      {(data) => (
        <>
          {header?.(data)}
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
            <TextField size="small" label="Faixa de versão" placeholder="ex.: <3.2.0 ou >=2.0 <3.0" value={input} onChange={(e) => setInput(e.target.value)} sx={{ width: 240 }} />
            <TextField select size="small" label="Uso" value={use} onChange={(e) => setUse(e.target.value)} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} sx={{ width: 220 }}>
              {USE_FILTERS.map((f) => (
                <MenuItem key={f.id} value={f.id}>
                  {f.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <ProducedBy data={data} />
          <Section title="Versões em uso" count={data.versions.length}>
            <VersionsInUse versions={data.versions} />
          </Section>
          <Section title="Quem usa" count={data.users.length}>
            <LibraryUseTable uses={data.users} owner={nameOf(data.library)} header="Componente" showLibrary={!!data.packages} empty={range || use ? "Ninguém neste recorte." : "Ninguém afirma usar."} />
          </Section>
        </>
      )}
    </QueryView>
  );
}

/**
 * De onde a biblioteca sai: o componente cujo build a gera. Consultado o próprio componente, os pacotes que ele gera
 * ficam na Ficha, e a tabela de quem usa já diz qual pacote cada um usa.
 */
function ProducedBy({ data }: { data: LibraryUsage }) {
  if (!data.producedBy) return null;
  return (
    <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mb: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Gerada por
      </Typography>
      {data.producedBy.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          nenhuma fonte afirma.
        </Typography>
      ) : (
        data.producedBy.map((e) => <NodeLink key={e.node.key} node={e.node} />)
      )}
    </Stack>
  );
}
