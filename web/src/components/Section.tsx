import type { ReactNode } from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";

/** Bloco com título, contagem opcional e ações à direita. */
export function Section({ title, count, actions, children }: { title: string; count?: number; actions?: ReactNode; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          {title}
          {count !== undefined && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              {count}
            </Typography>
          )}
        </Typography>
        {actions}
      </Stack>
      <Box sx={{ overflowX: "auto" }}>{children}</Box>
    </Paper>
  );
}

/** Título de página: tipo, nome e a chave. */
export function PageHeader({ overline, title, subtitle, actions }: { overline?: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-end" }, mb: 2 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {overline && (
          <Typography variant="overline" color="text.secondary">
            {overline}
          </Typography>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" component="div" sx={{ wordBreak: "break-all" }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions}
    </Stack>
  );
}
