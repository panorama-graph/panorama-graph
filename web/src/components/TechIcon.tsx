import { Box } from "@mui/material";

/** Os SVG de `images/`: `<tecnologia>-icon.svg` (só o ícone) e `<tecnologia>-logo.svg` (ícone e nome). */
const FILES = import.meta.glob("../../images/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const URLS = new Map(Object.entries(FILES).map(([path, url]) => [path.split("/").pop()!.replace(/\.svg$/, ""), url]));

/** Sem o ícone, vale o logo, e vice-versa; sem nenhum dos dois, nada aparece. */
export function techImage(tech: string, variant: "icon" | "logo"): string | undefined {
  const other = variant === "icon" ? "logo" : "icon";
  return URLS.get(`${tech}-${variant}`) ?? URLS.get(`${tech}-${other}`);
}

export function TechIcon({ tech, variant = "icon", size = 22 }: { tech?: string; variant?: "icon" | "logo"; size?: number }) {
  const src = tech ? techImage(tech, variant) : undefined;
  if (!src) return null;
  return (
    <Box
      component="img"
      src={src}
      alt={tech}
      sx={{ height: size, width: variant === "icon" ? size : "auto", maxWidth: variant === "icon" ? size : size * 5, objectFit: "contain", flexShrink: 0 }}
    />
  );
}
