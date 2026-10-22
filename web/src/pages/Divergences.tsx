import { Chip, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { Divergence, FactDivergences } from "@/lib/types";
import { propValues } from "@/lib/facts";
import { RELATION_LABELS, displayName, relationLabel } from "@/lib/nodes";
import { useUrlParam } from "@/lib/nav";
import { QueryView } from "@/components/QueryView";
import { PageHeader, Section } from "@/components/Section";
import { NodeLink } from "@/components/NodeLink";
import { FactsBadge } from "@/components/FactsBadge";

/**
 * Onde as fontes discordam, no retrato atual (fact_divergences): a mesma relação com valores diferentes, ou uma
 * relação de alvo único (dono, sistema, repositório) com mais de um alvo. A tela não escolhe vencedor.
 */
export function Divergences() {
  const [type, setType] = useUrlParam("relacao");
  const query = useGraphQuery<FactDivergences>("fact_divergences", { relationType: type });
  return (
    <>
      <PageHeader
        title="Divergências"
        subtitle="Fontes que afirmam coisas diferentes sobre o mesmo fato. Cada uma continua com a sua afirmação; a divergência é informação."
        actions={
          <TextField select size="small" label="Relação" value={type} onChange={(e) => setType(e.target.value)} sx={{ width: 220 }}>
            <MenuItem value="">Todas</MenuItem>
            {Object.keys(RELATION_LABELS).map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      <QueryView query={query}>
        {(data) => (
          <Section title="Divergências" count={data.count}>
            {data.divergences.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nenhuma divergência no retrato atual.
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>De</TableCell>
                    <TableCell>Relação</TableCell>
                    <TableCell>Para</TableCell>
                    <TableCell>O que cada fonte afirma</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.divergences.map((d, i) => (
                    <DivergenceRow key={i} d={d} />
                  ))}
                </TableBody>
              </Table>
            )}
            {data.truncated && (
              <Typography variant="caption" color="text.secondary">
                Lista cortada em {data.count}. Filtre por relação.
              </Typography>
            )}
          </Section>
        )}
      </QueryView>
    </>
  );
}

function DivergenceRow({ d }: { d: Divergence }) {
  const from = displayName(d.from);
  if (d.kind === "targets") {
    return (
      <TableRow>
        <TableCell>
          <NodeLink node={d.from} />
        </TableCell>
        <TableCell>
          <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
            <Typography variant="body2">{relationLabel(d.type)}</Typography>
            <Chip size="small" color="warning" variant="outlined" label={`${d.edges.length} alvos, deveria ser um`} />
          </Stack>
        </TableCell>
        <TableCell colSpan={2}>
          <Stack spacing={0.5}>
            {d.edges.map((e) => (
              <Stack key={e.node.key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <NodeLink node={e.node} />
                <FactsBadge facts={e.facts} title={`${from}: ${relationLabel(d.type)} ${displayName(e.node)}`} subtitle={d.type} />
              </Stack>
            ))}
          </Stack>
        </TableCell>
      </TableRow>
    );
  }
  const edge = d.edges[0];
  const disputed = propValues(edge.facts).filter((p) => (d.props ?? []).includes(p.prop));
  return (
    <TableRow>
      <TableCell>
        <NodeLink node={d.from} />
      </TableCell>
      <TableCell>{relationLabel(d.type)}</TableCell>
      <TableCell>
        <NodeLink node={edge.node} />
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Stack spacing={0.25} sx={{ flex: 1 }}>
            {disputed.map((p) => (
              <Typography key={p.prop} variant="body2">
                <b>{p.prop}</b>: {p.values.map((v) => `${v.value} (${v.sources.join(", ")})`).join(" · ")}
              </Typography>
            ))}
          </Stack>
          <FactsBadge facts={edge.facts} title={`${from}: ${relationLabel(d.type)} ${displayName(edge.node)}`} subtitle={d.type} />
        </Stack>
      </TableCell>
    </TableRow>
  );
}
