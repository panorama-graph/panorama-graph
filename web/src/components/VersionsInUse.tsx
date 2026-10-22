import { Stack, Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import { NodeLink } from "./NodeLink";

export type VersionInUse = { version: string | null; components: string[] };

/** As versões em uso, cada uma com os componentes que a usam. */
export function VersionsInUse({ versions, empty = "sem versão" }: { versions: VersionInUse[]; empty?: string }) {
  if (versions.length === 0) return null;
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Versão</TableCell>
          <TableCell align="right">Componentes</TableCell>
          <TableCell>Quais</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {versions.map((v) => (
          <TableRow key={v.version ?? ""} hover>
            <TableCell sx={{ fontFamily: "monospace", fontSize: 13, whiteSpace: "nowrap" }}>{v.version ?? empty}</TableCell>
            <TableCell align="right">{v.components.length}</TableCell>
            <TableCell>
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                {v.components.map((k) => (
                  <NodeLink key={k} node={{ key: k }} />
                ))}
              </Stack>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Agrupa (versão, componente) em versões em uso, na ordem das versões dadas (as outras depois); sem versão por último. */
export function groupByVersion(rows: { version?: string | null; component: string }[], order: (string | undefined)[] = []): VersionInUse[] {
  const by = new Map<string | null, Set<string>>();
  for (const r of rows) {
    const v = r.version ?? null;
    by.set(v, (by.get(v) ?? new Set()).add(r.component));
  }
  const rank = (v: string | null) => (v === null ? Infinity : order.includes(v) ? order.indexOf(v) : order.length);
  return [...by]
    .map(([version, cs]) => ({ version, components: [...cs].sort() }))
    .sort((a, b) => rank(a.version) - rank(b.version));
}
