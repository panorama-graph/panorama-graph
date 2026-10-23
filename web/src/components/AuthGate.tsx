import { createContext, useContext, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Avatar, Box, Button, Chip, CircularProgress, Divider, ListItemText, Menu, MenuItem, Paper, Stack, Tooltip, Typography } from "@mui/material";
import type { AuthSession } from "@panorama-graph/sdk";
import { fetchSession, loginUrl, logoutUrl } from "@/lib/api";

/** Chave da sessão no cache: um 401 de qualquer consulta a invalida, e a tela de login volta. */
export const SESSION_KEY = ["auth", "me"];

const SessionContext = createContext<AuthSession | null>(null);

export const useSession = () => useContext(SessionContext);

/**
 * Sem SSO, o console abre direto, com a identidade anônima. Com SSO e sem sessão, mostra só a entrada pelo provedor.
 * Com a API fora do ar, deixa as telas abrirem: cada uma mostra o erro da própria consulta.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: 5 * 60_000, retry: false });
  if (session.isPending) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (session.data?.mode === "sso" && !session.data.identity) return <Login />;
  return <SessionContext.Provider value={session.data ?? null}>{children}</SessionContext.Provider>;
}

function Login() {
  const [params] = useSearchParams();
  const error = params.get("loginError");
  const back = new URL(window.location.href);
  back.searchParams.delete("loginError");

  return (
    <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh", bgcolor: "background.default", p: 2 }}>
      <Paper variant="outlined" sx={{ p: 4, width: "100%", maxWidth: 400 }}>
        <Stack spacing={3} sx={{ alignItems: "center", textAlign: "center" }}>
          <Box component="img" src="/logo.svg" alt="" sx={{ width: 56, height: 56 }} />
          <Box>
            <Typography variant="h5" sx={{ letterSpacing: "-0.01em" }}>
              <Box component="span" sx={{ fontWeight: 700, color: "secondary.main" }}>
                Panorama
              </Box>{" "}
              <Box component="span" sx={{ fontWeight: 400, color: "primary.main" }}>
                Graph
              </Box>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Entre com a conta da sua organização.
            </Typography>
          </Box>
          {error && (
            <Alert severity="error" sx={{ width: "100%", textAlign: "left" }}>
              {error}
            </Alert>
          )}
          <Button variant="contained" size="large" fullWidth href={loginUrl(back.href)}>
            Entrar com SSO
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

/** Quem está no console, no topo: a pessoa com o "Sair", ou o aviso de que a instância não tem autenticação. */
export function UserMenu() {
  const session = useSession();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!session?.identity) return null;
  const { identity } = session;

  if (session.mode === "anonymous") {
    return (
      <Tooltip title="Instância sem SSO: quem alcança a API consulta o grafo sem entrar">
        <Chip size="small" variant="outlined" label="Anônimo" />
      </Tooltip>
    );
  }

  const initials = identity.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <>
      <Tooltip title={identity.name}>
        <Button onClick={(e) => setAnchor(e.currentTarget)} sx={{ minWidth: 0, p: 0.5, borderRadius: "50%" }} aria-label="Conta">
          <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: "primary.main" }}>{initials}</Avatar>
        </Button>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <Box sx={{ px: 2, py: 1, maxWidth: 280 }}>
          <ListItemText primary={identity.name} secondary={identity.email} slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} />
        </Box>
        <Divider />
        <MenuItem component="a" href={logoutUrl(window.location.origin)}>
          Sair
        </MenuItem>
      </Menu>
    </>
  );
}
