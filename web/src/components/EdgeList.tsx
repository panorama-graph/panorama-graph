import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import type { Edge } from "@/lib/types";
import { propsSummary } from "@/lib/facts";
import { displayName, relationLabel } from "@/lib/nodes";
import { FactsBadge } from "./FactsBadge";
import { NodeLink } from "./NodeLink";

/**
 * Relações vistas de um nó: o nó do outro lado, a identidade e as propriedades (por fonte, quando discordam) e as
 * fontes. Uma linha por relação lógica; as afirmações paralelas ficam no selo.
 */
export function EdgeList({
  edges,
  owner,
  showType = false,
  extra,
  empty = "Nenhuma.",
}: {
  edges: Edge[];
  /** Nome do nó dono, para o título do painel de afirmações. */
  owner: string;
  showType?: boolean;
  /** Coluna a mais, por relação. */
  extra?: { header: string; render: (e: Edge) => ReactNode };
  empty?: string;
}) {
  if (edges.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    );
  }
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Nó</TableCell>
          <TableCell>Detalhe</TableCell>
          {extra && <TableCell>{extra.header}</TableCell>}
          <TableCell align="right">Fontes</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {edges.map((e, i) => {
          const stale = e.facts.length > 0 && e.facts.every((f) => f.status === "stale");
          const identity = Object.entries(e.identity ?? {})
            .filter(([, v]) => v != null)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ");
          const details = [identity, propsSummary(e.facts)].filter(Boolean).join(" · ");
          const arrow = e.direction === "in" ? `${displayName(e.node)} → ${owner}` : `${owner} → ${displayName(e.node)}`;
          return (
            <TableRow key={`${e.type}:${e.node.key}:${i}`} hover>
              <TableCell>
                <NodeLink node={e.node} showType={showType} stale={stale} />
              </TableCell>
              <TableCell sx={{ color: "text.secondary", fontSize: 13 }}>{details || "—"}</TableCell>
              {extra && <TableCell>{extra.render(e)}</TableCell>}
              <TableCell align="right">
                <FactsBadge facts={e.facts} title={`${relationLabel(e.type, e.direction)}: ${displayName(e.node)}`} subtitle={`${e.type} · ${arrow}`} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
