import { Chip, MenuItem, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { FoundNode, NodesFind } from "@/lib/types";
import { NODE_TYPES, typeLabel } from "@/lib/nodes";
import { useUrlParam } from "@/lib/nav";
import { QueryView } from "@/components/QueryView";
import { PageHeader, Section } from "@/components/Section";
import { NodeLink } from "@/components/NodeLink";

/** Busca (nodes_find) por texto no nome, na chave ou num apelido, ou todos os nós de um tipo. */
export function Search() {
  const [q] = useUrlParam("q");
  const [type, setType] = useUrlParam("tipo");
  const query = useGraphQuery<NodesFind>(
    "nodes_find",
    { text: q || undefined, types: type ? [type] : undefined, limit: q ? 200 : 500 },
    { enabled: !!q || !!type },
  );
  return (
    <>
      <PageHeader
        title={q ? `Busca: ${q}` : type ? (NODE_TYPES[type]?.plural ?? type) : "Busca"}
        subtitle={q || !type ? "Por texto no nome, na chave ou num apelido." : "Todos os nós deste tipo."}
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
      {!q && !type ? (
        <Typography color="text.secondary">Digite na busca acima, ou escolha um tipo.</Typography>
      ) : (
        <QueryView query={query}>
          {(data) => (
            <Section title="Nós" count={data.count}>
              <NodeTable nodes={data.nodes} truncated={data.truncated} empty={q ? "Nenhum nó com este texto." : "Nenhum nó deste tipo."} />
            </Section>
          )}
        </QueryView>
      )}
    </>
  );
}

export function NodeTable({ nodes, truncated, empty }: { nodes: FoundNode[]; truncated: boolean; empty: string }) {
  if (nodes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    );
  }
  return (
    <>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Nó</TableCell>
            <TableCell>Tipo</TableCell>
            <TableCell>Chave</TableCell>
            <TableCell>Situação</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {nodes.map((n) => (
            <TableRow key={n.key} hover>
              <TableCell>
                <NodeLink node={n} stale={n.status === "stale"} />
              </TableCell>
              <TableCell>
                {typeLabel(n.type)}
                {n.kind && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    {n.kind}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}>
                {n.key}
                {n.matchedAlias && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    apelido {n.matchedAlias}
                  </Typography>
                )}
              </TableCell>
              <TableCell>
                {n.referenced && <Chip size="small" variant="outlined" label="só referenciado" sx={{ mr: 0.5 }} />}
                {n.status === "stale" && <Chip size="small" variant="outlined" label="fora do retrato atual" />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {truncated && (
        <Typography variant="caption" color="text.secondary">
          Mostrando os {nodes.length} primeiros.
        </Typography>
      )}
    </>
  );
}
