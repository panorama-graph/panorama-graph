import { createTheme } from "@mui/material/styles";

/** Tema neutro: o console não carrega a identidade visual de nenhuma organização. */
export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#2563eb" },
    secondary: { main: "#334155" },
    background: { default: "#f8fafc", paper: "#ffffff" },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'Roboto, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  components: {
    MuiTableCell: { styleOverrides: { root: { paddingTop: 6, paddingBottom: 6 } } },
  },
});
