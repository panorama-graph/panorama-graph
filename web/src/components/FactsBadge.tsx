import { Chip, Tooltip } from "@mui/material";
import { AlertTriangle } from "lucide-react";
import type { Fact } from "@/lib/types";
import { diverges, sourcesOf } from "@/lib/facts";
import { useOpenFacts, type FactsSection } from "./FactsPanel";

/** Estado da afirmação: observado (fonte determinística), inferido (agente) ou confirmado (uma pessoa). */
export function StateChip({ state }: { state?: string }) {
  if (!state) return null;
  const color = state === "confirmed" ? "success" : state === "inferred" ? "warning" : "default";
  const label = state === "observed" ? "observado" : state === "inferred" ? "inferido" : state === "confirmed" ? "confirmado" : state;
  return <Chip size="small" label={label} color={color} variant={state === "inferred" ? "outlined" : "filled"} sx={state === "inferred" ? { borderStyle: "dashed" } : undefined} />;
}

/**
 * Quantas fontes afirmam, com o visual do estado: inferido tracejado em âmbar, confirmado em verde, stale
 * esmaecido; e um alerta quando as fontes discordam. O clique abre as afirmações.
 */
export function FactsBadge({
  facts,
  title,
  subtitle,
  sections,
  size = "normal",
}: {
  facts: Fact[];
  title: string;
  subtitle?: string;
  sections?: FactsSection[];
  /** `dense`: menor, para caber num cartão; `count`: só o número de fontes, num círculo, para caber numa aresta. */
  size?: "normal" | "dense" | "count";
}) {
  const open = useOpenFacts();
  const all = sections ? sections.flatMap((s) => s.facts) : facts;
  const sources = sourcesOf(all);
  const inferred = all.some((f) => f.state === "inferred");
  const confirmed = all.length > 0 && all.every((f) => f.state === "confirmed");
  const stale = all.length > 0 && all.every((f) => f.status === "stale");
  const split = diverges(all);
  const label = size === "count" ? String(sources.length) : sources.length === 1 ? sources[0] : `${sources.length} fontes`;
  return (
    <Tooltip title={`${sources.join(", ")}${split ? " — as fontes discordam" : ""}. Clique para ver as afirmações.`}>
      <Chip
        size="small"
        clickable
        onClick={(e) => {
          e.stopPropagation();
          open({ title, subtitle, sections: sections ?? [{ facts }] });
        }}
        label={label}
        icon={split && size !== "count" ? <AlertTriangle size={14} /> : undefined}
        color={split ? "warning" : confirmed ? "success" : inferred ? "warning" : "default"}
        variant={inferred || stale ? "outlined" : "filled"}
        sx={{
          maxWidth: 220,
          ...(size === "dense" ? { height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.75 } } : {}),
          ...(size === "count" ? { height: 16, minWidth: 16, fontSize: 10, borderRadius: 8, "& .MuiChip-label": { px: 0.5 } } : {}),
          ...(inferred ? { borderStyle: "dashed" } : {}),
          ...(stale ? { opacity: 0.6, textDecoration: "line-through" } : {}),
        }}
      />
    </Tooltip>
  );
}
