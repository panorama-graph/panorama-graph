import type { NodeView, OrgNode } from "./types";

/**
 * Cor dos níveis que não são times, pela posição de cima para baixo (`order`). Um nível lateral repete a posição do
 * nível ao lado e fica com a cor dele. Mais níveis que cores: a paleta recomeça.
 */
const PALETTE = ["#1d4ed8", "#7c3aed", "#c2410c", "#0e7490", "#be185d", "#4d7c0f"];
/** Os times têm cor própria, em qualquer posição: são os donos dos componentes. */
const TEAM_COLOR = "#059669";
const NO_LEVEL = { label: "Grupo", color: "#475569", team: false };

export type LevelStyle = { label: string; color: string; team: boolean };

/**
 * Rótulo e cor de cada nível citado na resposta do org_structure. A cor vem da posição entre os níveis que não são
 * times; o rótulo é o nome do nível na organização.
 */
export function levelStyles(levels: NodeView[]): Map<string, LevelStyle> {
  const orders = [...new Set(levels.filter((l) => l.props.team !== true).map((l) => l.props.order as number | undefined))]
    .filter((o): o is number => typeof o === "number")
    .sort((a, b) => a - b);
  return new Map(
    levels.map((l) => {
      const team = l.props.team === true;
      const order = l.props.order as number | undefined;
      const rank = typeof order === "number" ? orders.indexOf(order) : -1;
      const color = team ? TEAM_COLOR : rank >= 0 ? PALETTE[rank % PALETTE.length] : NO_LEVEL.color;
      return [l.key, { label: (l.props.name as string | undefined) ?? l.key.replace(/^level:/, ""), color, team }];
    }),
  );
}

/** Estilo do grupo pelo nível afirmado. Com fontes que discordam, vale o primeiro; o painel mostra todas. */
export function levelOf(g: OrgNode, styles: Map<string, LevelStyle>): LevelStyle {
  const key = g.level[0]?.node.key;
  return (key && styles.get(key)) || NO_LEVEL;
}
