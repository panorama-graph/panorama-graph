import { MenuItem, TextField } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { NodesFind } from "@/lib/types";
import { NODE_TYPES } from "@/lib/nodes";
import { useUrlParam } from "@/lib/nav";
import { QueryView } from "@/components/QueryView";
import { PageHeader, Section } from "@/components/Section";
import { NodeTable } from "./Search";

/**
 * Nós que nenhuma fonte declarou: existem só porque alguma relação aponta para eles. Normal para bibliotecas e
 * tecnologias citadas; num componente ou API, costuma ser apelido faltando ou fonte que ainda não publica.
 */
export function Referenced() {
  const [type, setType] = useUrlParam("tipo");
  const query = useGraphQuery<NodesFind>("nodes_find", { referencedOnly: true, types: type ? [type] : undefined, limit: 500 });
  return (
    <>
      <PageHeader
        title="Nós referenciados"
        subtitle="Apontados por alguma relação, mas sem nenhuma fonte que declare que existem. Num componente ou numa API, costuma indicar um apelido faltando ou uma fonte que ainda não publica."
        actions={
          <TextField select size="small" label="Tipo" value={type} onChange={(e) => setType(e.target.value)} sx={{ width: 200 }}>
            <MenuItem value="">Todos</MenuItem>
            {Object.entries(NODE_TYPES).map(([t, spec]) => (
              <MenuItem key={t} value={t}>
                {spec.label}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      <QueryView query={query}>
        {(data) => (
          <Section title="Nós" count={data.count}>
            <NodeTable nodes={data.nodes} truncated={data.truncated} empty="Nenhum nó só referenciado." />
          </Section>
        )}
      </QueryView>
    </>
  );
}
