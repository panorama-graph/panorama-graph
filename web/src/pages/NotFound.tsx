import { Link as RouterLink } from "react-router-dom";
import { Link, Typography } from "@mui/material";

export function NotFound() {
  return (
    <>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Página não encontrada
      </Typography>
      <Link component={RouterLink} to="/">
        Voltar à visão geral
      </Link>
    </>
  );
}
