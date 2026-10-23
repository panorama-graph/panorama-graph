import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CssBaseline, ThemeProvider } from "@mui/material";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "reactflow/dist/style.css";
import "./styles/index.css";
import App from "./App";
import { AuthGate, SESSION_KEY } from "./components/AuthGate";
import { GraphError } from "./lib/api";
import { theme } from "./theme";

const qc: QueryClient = new QueryClient({
  // A sessão venceu no meio do uso: a consulta volta 401, a sessão é relida e o login aparece.
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof GraphError && err.status === 401) void qc.invalidateQueries({ queryKey: SESSION_KEY });
    },
  }),
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <AuthGate>
            <App />
          </AuthGate>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
