import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  AppBar,
  Autocomplete,
  Box,
  Chip,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Stack,
  Switch,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { AlertTriangle, Boxes, Database, GitFork, Link2Off, Menu, Network, Users } from "lucide-react";
import { useGraphQuery, useIncludeStale } from "@/lib/queries";
import type { FoundNode, NodesFind } from "@/lib/types";
import { displayName, nodePath, typeLabel } from "@/lib/nodes";
import { useTo } from "@/lib/nav";

const DRAWER = 232;

const NAV: { section: string; items: { to: string; label: string; icon: ReactNode }[] }[] = [
  {
    section: "Consultar",
    items: [
      { to: "/", label: "Visão geral", icon: <Network size={18} /> },
      { to: "/componentes", label: "Componentes", icon: <Boxes size={18} /> },
      { to: "/quem-usa", label: "Quem usa", icon: <GitFork size={18} /> },
      { to: "/organizacao", label: "Organização", icon: <Users size={18} /> },
    ],
  },
  {
    section: "Confiar",
    items: [
      { to: "/fontes", label: "Fontes e cargas", icon: <Database size={18} /> },
      { to: "/divergencias", label: "Divergências", icon: <AlertTriangle size={18} /> },
      { to: "/referenciados", label: "Nós referenciados", icon: <Link2Off size={18} /> },
    ],
  },
];

export function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { includeStale, setIncludeStale } = useIncludeStale();
  const location = useLocation();
  const to = useTo();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const nav = (
    <Box sx={{ pt: 1 }}>
      {NAV.map((group) => (
        <List key={group.section} dense subheader={<ListSubheader sx={{ bgcolor: "transparent", lineHeight: "32px" }}>{group.section}</ListSubheader>}>
          {group.items.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={to(item.to)}
              end={item.to === "/"}
              sx={{ mx: 1, borderRadius: 1, "&.active": { bgcolor: "action.selected", fontWeight: 600 } }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      ))}
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="fixed" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider", zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 2 }}>
          <IconButton sx={{ display: { md: "none" } }} onClick={() => setMobileOpen(true)} aria-label="Menu">
            <Menu size={20} />
          </IconButton>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
            <Box component="img" src="/logo.svg" alt="" sx={{ width: 32, height: 32 }} />
            <Typography variant="h6" noWrap sx={{ display: { xs: "none", sm: "block" }, letterSpacing: "-0.01em" }}>
              <Box component="span" sx={{ fontWeight: 700, color: "secondary.main" }}>
                Panorama
              </Box>{" "}
              <Box component="span" sx={{ fontWeight: 400, color: "primary.main" }}>
                Graph
              </Box>
            </Typography>
          </Stack>
          <Box sx={{ flex: 1, maxWidth: 560 }}>
            <SearchBox />
          </Box>
          <Box sx={{ flex: 1, display: { xs: "none", lg: "block" } }} />
          <Tooltip title="Mostra também as afirmações e os nós que as fontes deixaram de afirmar, com a última data em que foram vistos">
            <FormControlLabel
              control={<Switch size="small" checked={includeStale} onChange={(e) => setIncludeStale(e.target.checked)} />}
              label={<Typography variant="body2">Incluir o que sumiu</Typography>}
              sx={{ mr: 0, whiteSpace: "nowrap" }}
            />
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { md: "none" }, "& .MuiDrawer-paper": { width: DRAWER } }}
      >
        {nav}
      </Drawer>
      <Drawer variant="permanent" sx={{ display: { xs: "none", md: "block" }, width: DRAWER, flexShrink: 0, "& .MuiDrawer-paper": { width: DRAWER, boxSizing: "border-box" } }}>
        <Toolbar />
        {nav}
      </Drawer>
      <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}

/** Busca global (nodes_find): escolher um nó abre a página dele; Enter sem escolher abre os resultados. */
function SearchBox() {
  const navigate = useNavigate();
  const to = useTo();
  const [input, setInput] = useState("");
  const [text, setText] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setText(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);
  const found = useGraphQuery<NodesFind>("nodes_find", { text, limit: 15 }, { enabled: text.length >= 2 });
  const options = text.length >= 2 ? found.data?.nodes ?? [] : [];

  return (
    <Autocomplete<FoundNode, false, false, true>
      freeSolo
      size="small"
      options={options}
      filterOptions={(x) => x}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      getOptionLabel={(o) => (typeof o === "string" ? o : displayName(o))}
      loading={found.isFetching}
      onChange={(_, v) => {
        if (!v) return;
        if (typeof v === "string") {
          if (v.trim()) navigate(to(`/busca?q=${encodeURIComponent(v.trim())}`));
        } else navigate(to(nodePath(v.key)));
        setInput("");
      }}
      renderOption={(props, o) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <li key={key} {...rest}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0, width: "100%" }}>
              <Chip size="small" variant="outlined" label={typeLabel(o.type)} sx={{ height: 20, fontSize: 11 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {displayName(o)}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {o.matchedAlias ? `apelido ${o.matchedAlias}` : o.key}
                </Typography>
              </Box>
            </Stack>
          </li>
        );
      }}
      renderInput={(params) => <TextField {...params} placeholder="Buscar componente, API, tópico, time, biblioteca..." />}
    />
  );
}
