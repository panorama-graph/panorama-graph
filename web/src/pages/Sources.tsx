import { Fragment, useState } from "react";
import { Chip, Collapse, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useGraphQuery } from "@/lib/queries";
import type { LoadCounts, SourcesStatus } from "@/lib/types";
import { formatDate, scopeText } from "@/lib/facts";
import { QueryView } from "@/components/QueryView";
import { PageHeader, Section } from "@/components/Section";
import { Evidence } from "@/components/Evidence";

/**
 * De onde vêm os fatos (sources_status): as fontes e os escopos que cada uma carrega, o último retrato de cada
 * escopo, as cargas recentes e, por tipo de fato, quais fontes o publicam. Tipo sem fonte quer dizer sem dados.
 */
export function Sources() {
  const query = useGraphQuery<SourcesStatus>("sources_status", { limit: 50 });
  return (
    <>
      <PageHeader title="Fontes e cargas" subtitle="Cada fonte envia o retrato de um escopo; o que some do retrato deixa de valer (stale), sem apagar o histórico." />
      <QueryView query={query}>
        {(data) => (
          <>
            <Section title="Cobertura por tipo de fato">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Tipo de fato</TableCell>
                    <TableCell>Publicado por</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.coverage.map((c) => (
                    <TableRow key={c.kind}>
                      <TableCell>{c.what}</TableCell>
                      <TableCell>
                        {c.sources.length === 0 ? (
                          <Chip size="small" color="warning" variant="outlined" label="nenhuma fonte: sem dados, não quer dizer que não existe" />
                        ) : (
                          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                            {c.sources.map((s) => (
                              <Chip key={s.source} size="small" label={`${s.source} · ${s.scopes} escopo${s.scopes > 1 ? "s" : ""}`} />
                            ))}
                          </Stack>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
            <Section title="Fontes" count={data.sources.length}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell width={40} />
                    <TableCell>Fonte</TableCell>
                    <TableCell>Escopos</TableCell>
                    <TableCell>Último retrato</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.sources.map((s) => (
                    <SourceRow key={s.source} source={s} />
                  ))}
                </TableBody>
              </Table>
            </Section>
            <Section title="Cargas recentes" count={data.loads.length}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Recebida em</TableCell>
                    <TableCell>Fonte</TableCell>
                    <TableCell>Escopo</TableCell>
                    <TableCell>Retrato de</TableCell>
                    <TableCell>Resultado</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.loads.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(l.receivedAt)}</TableCell>
                      <TableCell>{l.source}</TableCell>
                      <TableCell sx={{ fontSize: 13 }}>{scopeText(l.scope)}</TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(l.observedAt)}</TableCell>
                      <TableCell>
                        <Counts counts={l.counts} />
                        {l.retired && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Escopo aposentado por {l.retired.by}: {l.retired.reason} (<Evidence value={l.retired.evidence} />)
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          </>
        )}
      </QueryView>
    </>
  );
}

function SourceRow({ source }: { source: SourcesStatus["sources"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <TableRow hover onClick={() => setOpen(!open)} sx={{ cursor: "pointer" }}>
        <TableCell>
          <IconButton size="small" aria-label={open ? "Recolher" : "Expandir"}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </IconButton>
        </TableCell>
        <TableCell sx={{ fontWeight: 600 }}>{source.source}</TableCell>
        <TableCell>{source.scopeCount}</TableCell>
        <TableCell>{formatDate(source.lastObservedAt)}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={4} sx={{ py: 0, borderBottom: open ? undefined : 0 }}>
          <Collapse in={open} unmountOnExit>
            <Table size="small" sx={{ my: 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Escopo</TableCell>
                  <TableCell>Retrato de</TableCell>
                  <TableCell>Último resultado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {source.scopes.map((sc, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ fontSize: 13 }}>{scopeText(sc.scope)}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(sc.lastObservedAt)}</TableCell>
                    <TableCell>
                      {sc.counts && <Counts counts={sc.counts} />}
                      {sc.retired && <Chip size="small" variant="outlined" label={`aposentado por ${sc.retired.by}`} title={sc.retired.reason} sx={{ ml: 1 }} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  );
}

const OUTCOMES: [keyof NonNullable<LoadCounts["nodes"]>, string][] = [
  ["created", "novos"],
  ["updated", "alterados"],
  ["unchanged", "iguais"],
  ["stale", "sumiram"],
];

/** Contagens de uma carga: nós e relações novos, alterados, iguais e que sumiram. */
function Counts({ counts }: { counts: LoadCounts }) {
  const part = (label: string, c?: LoadCounts["nodes"]) => {
    if (!c) return null;
    const items = OUTCOMES.filter(([k]) => (c[k] ?? 0) > 0).map(([k, l]) => `${c[k]} ${l}`);
    return `${label}: ${items.length > 0 ? items.join(", ") : "nada"}`;
  };
  const text = [part("nós", counts.nodes), part("relações", counts.relations), counts.referenced ? `${counts.referenced} referenciados` : null]
    .filter(Boolean)
    .join(" · ");
  const lostSomething = (counts.nodes?.stale ?? 0) + (counts.relations?.stale ?? 0) > 0;
  return (
    <Typography variant="body2" sx={{ color: lostSomething ? "warning.dark" : "text.primary", fontSize: 13 }}>
      {text || "—"}
    </Typography>
  );
}
