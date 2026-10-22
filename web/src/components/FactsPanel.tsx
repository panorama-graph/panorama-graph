import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Box, Chip, Divider, Drawer, IconButton, Stack, Table, TableBody, TableCell, TableRow, Typography } from "@mui/material";
import { X } from "lucide-react";
import type { Fact } from "@/lib/types";
import { formatDate, propValues, scopeText } from "@/lib/facts";
import { Evidence } from "./Evidence";
import { StateChip } from "./FactsBadge";

/** Um grupo de afirmações no painel (ex.: as de quem depende e as de quem oferece). */
export type FactsSection = { label?: string; facts: Fact[] };
export type FactsRequest = { title: string; subtitle?: string; sections: FactsSection[] };

const FactsContext = createContext<(req: FactsRequest) => void>(() => {});

/** Abre o painel lateral com as afirmações de uma relação ou de um nó. */
export const useOpenFacts = () => useContext(FactsContext);

export function FactsProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<FactsRequest | null>(null);
  const open = useCallback((r: FactsRequest) => setReq(r), []);
  return (
    <FactsContext.Provider value={open}>
      {children}
      <Drawer
        anchor="right"
        open={!!req}
        onClose={() => setReq(null)}
        sx={{ zIndex: (t) => t.zIndex.modal + 1 }}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 520 } } } }}
      >
        {req && <FactsPanel req={req} onClose={() => setReq(null)} />}
      </Drawer>
    </FactsContext.Provider>
  );
}

function FactsPanel({ req, onClose }: { req: FactsRequest; onClose: () => void }) {
  const all = useMemo(() => req.sections.flatMap((s) => s.facts), [req]);
  const disputed = propValues(all).filter((p) => p.values.length > 1);
  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary">
            Afirmações
          </Typography>
          <Typography variant="h6" sx={{ wordBreak: "break-word" }}>
            {req.title}
          </Typography>
          {req.subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
              {req.subtitle}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label="Fechar">
          <X size={18} />
        </IconButton>
      </Stack>

      {disputed.length > 0 && (
        <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: "warning.light", color: "warning.contrastText" }}>
          <Typography variant="subtitle2">As fontes discordam</Typography>
          {disputed.map((p) => (
            <Typography key={p.prop} variant="body2">
              <b>{p.prop}</b>: {p.values.map((v) => `${v.value} (${v.sources.join(", ")})`).join(" · ")}
            </Typography>
          ))}
        </Box>
      )}

      {req.sections.map((section, i) => (
        <Box key={i} sx={{ mt: 2 }}>
          {section.label && (
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {section.label}
            </Typography>
          )}
          {section.facts.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nenhuma afirmação.
            </Typography>
          )}
          <Stack spacing={1.5}>
            {section.facts.map((f, j) => (
              <FactCard key={j} fact={f} />
            ))}
          </Stack>
        </Box>
      ))}
    </Box>
  );
}

function FactCard({ fact }: { fact: Fact }) {
  const stale = fact.status === "stale";
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, opacity: stale ? 0.7 : 1, borderStyle: stale ? "dashed" : "solid" }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="subtitle2">{fact.source}</Typography>
        <StateChip state={fact.state} />
        {stale && <Chip size="small" label="stale" variant="outlined" />}
      </Stack>
      <Divider sx={{ my: 1 }} />
      <Table size="small" sx={{ "& td": { border: 0, py: 0.25, px: 0, verticalAlign: "top" } }}>
        <TableBody>
          <Row label="Evidência">
            <Evidence value={fact.evidence} />
          </Row>
          <Row label="Escopo">{scopeText(fact.scope)}</Row>
          {fact.observedAt && <Row label={stale ? "Visto por último" : "Visto em"}>{formatDate(fact.observedAt)}</Row>}
          {fact.firstObservedAt && <Row label="Visto pela 1ª vez">{formatDate(fact.firstObservedAt)}</Row>}
          {Object.entries(fact.props ?? {}).map(([k, v]) => (
            <Row key={k} label={k}>
              {typeof v === "string" ? v : JSON.stringify(v)}
            </Row>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell sx={{ width: 140, color: "text.secondary", pr: "12px !important" }}>{label}</TableCell>
      <TableCell sx={{ wordBreak: "break-word" }}>{children}</TableCell>
    </TableRow>
  );
}
