import { MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { ComponentsList } from "@/lib/types";
import { useUrlParam } from "@/lib/nav";
import { displayName } from "@/lib/nodes";
import { QueryView } from "@/components/QueryView";
import { PageHeader, Section } from "@/components/Section";
import { NodePicker } from "@/components/NodePicker";
import { NodeLink } from "@/components/NodeLink";
import { FactsBadge } from "@/components/FactsBadge";

const KINDS = ["service", "bff", "frontend", "job", "library"];

/** Componentes com o dono, filtrados por domínio, time (com subgrupos), tipo e tecnologia (components_list). */
export function Components() {
  const [domain, setDomain] = useUrlParam("dominio");
  const [team, setTeam] = useUrlParam("time");
  const [kind, setKind] = useUrlParam("tipo");
  const [technology, setTechnology] = useUrlParam("tecnologia");

  const query = useGraphQuery<ComponentsList>("components_list", { domain, team, kind, technology });

  return (
    <>
      <PageHeader title="Componentes" subtitle="Cada componente com o dono e quem afirmou a existência dele." />
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
        <NodePicker label="Domínio" types={["Domain"]} value={domain} onChange={setDomain} width={220} />
        <NodePicker label="Time" types={["Group"]} value={team} onChange={setTeam} width={240} />
        <TextField select size="small" label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ width: 150 }}>
          <MenuItem value="">Todos</MenuItem>
          {KINDS.map((k) => (
            <MenuItem key={k} value={k}>
              {k}
            </MenuItem>
          ))}
        </TextField>
        <NodePicker label="Tecnologia" types={["Technology"]} value={technology} onChange={setTechnology} width={220} />
      </Stack>
      <QueryView query={query}>
        {(data) => (
          <Section title="Resultado" count={data.count}>
            {data.components.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nenhum componente com estes filtros.
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Componente</TableCell>
                    <TableCell>Dono</TableCell>
                    <TableCell align="right">Existência afirmada por</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.components.map((c) => (
                    <TableRow key={c.key} hover>
                      <TableCell>
                        <NodeLink node={{ key: c.key, name: c.props.name as string, kind: c.props.kind as string }} stale={c.status === "stale"} />
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5}>
                          {c.owners.map((o) => (
                            <Stack key={o.node.key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                              <NodeLink node={o.node} />
                              <FactsBadge facts={o.facts} title={`Dono de ${displayName({ key: c.key, name: c.props.name as string })}`} subtitle={o.node.key} />
                            </Stack>
                          ))}
                          {c.owners.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                              sem dono afirmado
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        {c.facts.length > 0 ? (
                          <FactsBadge facts={c.facts} title={displayName({ key: c.key, name: c.props.name as string })} subtitle="Afirmações de existência do componente" />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            só referenciado
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {data.truncated && (
              <Typography variant="caption" color="text.secondary">
                Lista cortada em {data.count}. Use os filtros.
              </Typography>
            )}
          </Section>
        )}
      </QueryView>
    </>
  );
}
