import { Stack, Typography } from "@mui/material";
import type { Coverage as CoverageT } from "@/lib/types";

/**
 * Resposta vazia de um tipo de fato que nenhuma fonte publica: "sem dados", nunca "não existe". Só no lugar de uma
 * tela que ficaria vazia; numa seção com lista, o vazio da lista basta, e a cobertura por tipo fica na página Fontes.
 * Aceita as notas prontas da API (`coverage.note`) ou a cobertura de um tipo de fato.
 */
export function Coverage({ notes, coverage }: { notes?: (string | undefined)[]; coverage?: (CoverageT | undefined)[] }) {
  const lines = [
    ...(notes ?? []),
    // Só a nota da API, que vem quando nenhuma fonte publica o tipo de fato. Com fonte, a falta aparece na lista.
    ...(coverage ?? []).map((c) => c?.note),
  ].filter((l): l is string => !!l);
  if (lines.length === 0) return null;
  return (
    <Stack spacing={0.5} sx={{ my: 1.5 }}>
      {lines.map((l, i) => (
        <Typography key={i} variant="body2" color="text.secondary">
          {l}
        </Typography>
      ))}
    </Stack>
  );
}
