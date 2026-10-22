import { Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import type { LibraryUse } from "@/lib/types";
import { displayName, relationLabel } from "@/lib/nodes";
import { FactsBadge } from "./FactsBadge";
import { NodeLink } from "./NodeLink";

/**
 * Usos de bibliotecas (DEPENDS_ON), vistos do componente (`node` é a biblioteca) ou da biblioteca (`node` é o
 * componente): a versão em uso, se é direta ou por quais diretas chega, e se é declarada sem uso. Vistos do componente
 * que gera os pacotes, cada uso diz o pacote (`library`).
 */
export function LibraryUseTable({
  uses,
  owner,
  header,
  showLibrary,
  empty = "Nenhuma.",
}: {
  uses: LibraryUse[];
  owner: string;
  header: string;
  /** Coluna do pacote: quem usa um componente que gera vários pacotes, cada uso com o seu. */
  showLibrary?: boolean;
  empty?: string;
}) {
  if (uses.length === 0) {
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
          <TableCell>{header}</TableCell>
          {showLibrary && <TableCell>Pacote</TableCell>}
          <TableCell>Versão</TableCell>
          <TableCell>Uso</TableCell>
          <TableCell align="right">Fontes</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {uses.map((u) => {
          const stale = u.facts.length > 0 && u.facts.every((f) => f.status === "stale");
          const arrow = u.direction === "in" ? `${displayName(u.node)} → ${owner}` : `${owner} → ${displayName(u.node)}`;
          return (
            <TableRow key={`${u.node.key}-${u.library ?? ""}`} hover>
              <TableCell>
                <NodeLink node={u.node} stale={stale} />
              </TableCell>
              {showLibrary && <TableCell>{u.library && <NodeLink node={{ key: u.library }} />}</TableCell>}
              <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{u.version ?? "—"}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Typography variant="body2">{u.direct ? "Direta" : "Transitiva"}</Typography>
                  {u.via && (
                    <>
                      <Typography variant="body2" color="text.secondary">
                        via
                      </Typography>
                      {u.via.map((k) => (
                        <NodeLink key={k} node={{ key: k }} />
                      ))}
                    </>
                  )}
                  {u.unused && <Chip size="small" color="warning" variant="outlined" label="declarada sem uso" sx={{ height: 20, fontSize: 11 }} />}
                </Stack>
              </TableCell>
              <TableCell align="right">
                <FactsBadge facts={u.facts} title={`${relationLabel(u.type, u.direction)}: ${displayName(u.node)}`} subtitle={`${u.type} · ${arrow}`} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
