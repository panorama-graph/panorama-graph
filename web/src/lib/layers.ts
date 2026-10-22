/**
 * Camadas do grafo da visão geral e da vizinhança: que tipos de componente e que ligações aparecem, e se o desenho
 * agrupa por domínio. O padrão foca nas integrações (componentes que se integram, dependências por API e eventos),
 * agrupadas por domínio; recursos, bibliotecas e a infraestrutura entram quando a pessoa liga. Bibliotecas são os componentes `library` (com
 * repositório), com a seta de quem os usa; as de terceiros não entram. Na URL, `?camadas=` guarda a seleção, para o link mostrar o mesmo desenho.
 */

export type LayerOption = { id: string; label: string };

export const COMPONENT_LAYERS: LayerOption[] = [
  { id: "service", label: "service" },
  { id: "bff", label: "bff" },
  { id: "frontend", label: "frontend" },
  { id: "job", label: "job" },
  { id: "library", label: "library" },
  { id: "infra", label: "infra" },
];

export const LINK_LAYERS: LayerOption[] = [
  { id: "api", label: "API" },
  { id: "eventos", label: "Eventos" },
  { id: "bancos", label: "Bancos" },
  { id: "cache", label: "Cache" },
  { id: "mensageria", label: "Mensageria" },
  { id: "outros", label: "Outros recursos" },
];

/** Como agrupar o desenho: cada domínio vira um contorno em volta dos seus componentes. */
export const GROUP_LAYERS: LayerOption[] = [{ id: "dominios", label: "Domínios" }];

export const DEFAULT_LAYERS = ["service", "bff", "frontend", "job", "api", "eventos", "dominios"];

/** Valor da URL para nenhuma camada marcada (sem o parâmetro, vale o padrão). */
const NONE = "nenhuma";

const ORDER = [...COMPONENT_LAYERS, ...LINK_LAYERS, ...GROUP_LAYERS].map((l) => l.id);

/** Camada de um recurso pelo `kind`; gateway e ingress são rotas (físico) e não entram no grafo. */
export function resourceLayer(kind: string | undefined): string | null {
  switch (kind) {
    case "database":
    case "bucket":
      return "bancos";
    case "cache":
      return "cache";
    case "broker":
      return "mensageria";
    case "gateway":
    case "ingress":
      return null;
    default:
      return "outros";
  }
}

export function parseLayers(param: string): Set<string> {
  if (!param) return new Set(DEFAULT_LAYERS);
  if (param === NONE) return new Set();
  return new Set(param.split(",").filter((id) => ORDER.includes(id)));
}

/** Seleção → valor da URL: o padrão some da URL, e a seleção vazia é gravada. */
export function serializeLayers(layers: Set<string>): string {
  const ids = ORDER.filter((id) => layers.has(id));
  if (ids.length === 0) return NONE;
  if (ids.length === DEFAULT_LAYERS.length && DEFAULT_LAYERS.every((id) => layers.has(id))) return "";
  return ids.join(",");
}
