import { useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Box, CircularProgress, IconButton, Link, List, ListItem, Stack, Tooltip, Typography } from "@mui/material";
import { Check, Copy } from "lucide-react";
import { GraphError } from "@/lib/api";
import { nodePath } from "@/lib/nodes";
import { useTo } from "@/lib/nav";

type QueryLike<T> = { data?: T; error: Error | null; isLoading: boolean; isFetching?: boolean; tool: string; sent: Record<string, unknown> };

/**
 * Estados de uma consulta: carregando, erro (com os candidatos quando o nome é ambíguo) e o resultado. Mostra a
 * consulta feita, para refazê-la pelo MCP ou pelo REST.
 */
export function QueryView<T>({ query, children, showQuery = true }: { query: QueryLike<T>; children: (data: T) => ReactNode; showQuery?: boolean }) {
  if (query.isLoading) {
    return (
      <Box sx={{ py: 6, display: "flex", justifyContent: "center" }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (query.error) return <QueryError error={query.error} />;
  if (query.data === undefined) return null;
  return (
    <Box sx={{ opacity: query.isFetching ? 0.6 : 1, transition: "opacity .2s" }}>
      {children(query.data)}
      {showQuery && <QueryLink tool={query.tool} args={query.sent} />}
    </Box>
  );
}

export function QueryError({ error }: { error: Error }) {
  const to = useTo();
  const candidates = error instanceof GraphError ? error.candidates : undefined;
  return (
    <Alert severity={error instanceof GraphError && error.status === 404 ? "info" : candidates?.length ? "warning" : "error"} sx={{ my: 2 }}>
      <Typography variant="body2">{error.message}</Typography>
      {candidates && candidates.length > 0 && (
        <>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Escolha um:
          </Typography>
          <List dense disablePadding>
            {candidates.map((c) => (
              <ListItem key={c.key} disableGutters sx={{ py: 0 }}>
                <Link component={RouterLink} to={to(nodePath(c.key))}>
                  {c.name ? `${c.name} — ` : ""}
                  <code>{c.key}</code>
                </Link>
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Alert>
  );
}

/** A consulta como um agente a faria: ferramenta e argumentos. */
export function QueryLink({ tool, args }: { tool: string; args: Record<string, unknown> }) {
  const [copied, setCopied] = useState(false);
  const text = `${tool} ${JSON.stringify(args)}`;
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 3, color: "text.secondary" }}>
      <Typography variant="caption" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
        Consulta: {text}
      </Typography>
      <Tooltip title={copied ? "Copiada" : "Copiar a consulta"}>
        <IconButton
          size="small"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
