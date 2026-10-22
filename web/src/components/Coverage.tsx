import { Alert, Typography } from "@mui/material";
import type { Coverage as CoverageT } from "@/lib/types";

/**
 * Resposta vazia de um tipo de fato que nenhuma fonte publica: "sem dados", nunca "não existe". Aceita as notas
 * prontas da API (`gaps`, `coverage.note`) ou a cobertura de um tipo de fato.
 */
export function Coverage({ notes, coverage }: { notes?: (string | undefined)[]; coverage?: (CoverageT | undefined)[] }) {
  const lines = [
    ...(notes ?? []),
    // Só a nota da API, que vem quando nenhuma fonte publica o tipo de fato. Com fonte, a falta aparece na lista.
    ...(coverage ?? []).map((c) => c?.note),
  ].filter((l): l is string => !!l);
  if (lines.length === 0) return null;
  return (
    <Alert severity="info" variant="outlined" sx={{ my: 1.5 }}>
      {lines.map((l, i) => (
        <Typography key={i} variant="body2">
          {l}
        </Typography>
      ))}
    </Alert>
  );
}
