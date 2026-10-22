import { useCallback, useMemo } from "react";
import { Chip, Stack, Typography } from "@mui/material";
import { COMPONENT_LAYERS, GROUP_LAYERS, LINK_LAYERS, parseLayers, serializeLayers, type LayerOption } from "@/lib/layers";
import { useUrlParam } from "@/lib/nav";

/** Camadas marcadas, guardadas na URL (`?camadas=`). */
export function useLayers(): [Set<string>, (id: string) => void] {
  const [param, setParam] = useUrlParam("camadas");
  const layers = useMemo(() => parseLayers(param), [param]);
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(layers);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setParam(serializeLayers(next));
    },
    [layers, setParam],
  );
  return [layers, toggle];
}

/** Marcar e desmarcar o que o grafo mostra: tipos de componente, ligações (API, eventos, recursos) e o agrupamento. */
export function GraphLayers({ layers, onToggle }: { layers: Set<string>; onToggle: (id: string) => void }) {
  const group = (label: string, options: LayerOption[]) => (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
        {label}
      </Typography>
      {options.map((o) => (
        <Chip
          key={o.id}
          size="small"
          label={o.label}
          color={layers.has(o.id) ? "primary" : "default"}
          variant={layers.has(o.id) ? "filled" : "outlined"}
          onClick={() => onToggle(o.id)}
          aria-pressed={layers.has(o.id)}
        />
      ))}
    </Stack>
  );
  return (
    <Stack direction="row" spacing={3} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5 }}>
      {group("Componentes", COMPONENT_LAYERS)}
      {group("Ligações", LINK_LAYERS)}
      {group("Agrupar", GROUP_LAYERS)}
    </Stack>
  );
}
