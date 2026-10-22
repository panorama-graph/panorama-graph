import { Autocomplete, TextField } from "@mui/material";
import { useGraphQuery } from "@/lib/queries";
import type { FoundNode, NodesFind } from "@/lib/types";
import { displayName } from "@/lib/nodes";

/** Escolhe um nó dos tipos dados (pelo nodes_find). O valor é a chave; vazio quando nada escolhido. */
export function NodePicker({ label, types, value, onChange, width = 260 }: { label: string; types: string[]; value: string; onChange: (key: string) => void; width?: number }) {
  const found = useGraphQuery<NodesFind>("nodes_find", { types, limit: 500 });
  const options = found.data?.nodes ?? [];
  const selected = options.find((o) => o.key === value) ?? (value ? ({ key: value, type: types[0], status: "current", referenced: false } as FoundNode) : null);
  return (
    <Autocomplete<FoundNode>
      size="small"
      sx={{ width }}
      options={options}
      value={selected}
      loading={found.isLoading}
      isOptionEqualToValue={(a, b) => a.key === b.key}
      getOptionLabel={(o) => displayName(o)}
      groupBy={types.length > 1 ? (o) => o.type : undefined}
      onChange={(_, v) => onChange(v?.key ?? "")}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}
