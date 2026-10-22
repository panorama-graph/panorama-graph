import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import ReactFlow, {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  type Edge as FlowEdge,
  type EdgeProps,
  type Node as FlowNode,
  type NodeProps,
} from "reactflow";
import { Box, Button, Drawer, IconButton, Stack, Tooltip, Typography, alpha } from "@mui/material";
import { ChevronDown, ChevronRight, ChevronUp, Star, Users, X } from "lucide-react";
import type { NodeView, OrgNode } from "@/lib/types";
import { levelOf, levelStyles, type LevelStyle } from "@/lib/orgLevels";
import { displayName, nodePath } from "@/lib/nodes";
import { useTo } from "@/lib/nav";
import {
  ORG_CARD_W,
  ORG_HEADER_H,
  ORG_MEMBER_H,
  ORG_OWNS_ITEM_H,
  ORG_OWNS_TITLE_H,
  ORG_OWNS_TYPE_H,
  ORG_ROW_H,
  ORG_STACK_TRUNK,
  flatten,
  initials,
  isLead,
  memberships,
  orderedMembers,
  orgLayout,
  ownsByType,
  ownsKey,
  type OrgCard,
  type OrgLink,
} from "@/lib/orgLayout";
import { FactsBadge } from "./FactsBadge";
import { NodeLink } from "./NodeLink";
import { EdgeList } from "./EdgeList";
import { Section } from "./Section";

const nameOf = (g: OrgNode) => displayName({ key: g.key, name: g.props.name as string | undefined });

type CardData = {
  card: OrgCard;
  styles: Map<string, LevelStyle>;
  names: Map<string, string>;
  alsoIn: Map<string, string[]>;
  dimmed: boolean;
  marked: boolean;
  onToggle: (key: string) => void;
  expanded: Set<string>;
  onExpand: (key: string) => void;
};

/** Para o clique de um link ou botão de dentro do cartão não abrir também o painel do grupo. */
const Stop = ({ children }: { children: ReactNode }) => (
  <Box component="span" className="nodrag nopan" onClick={(e) => e.stopPropagation()} sx={{ display: "inline-flex", minWidth: 0 }}>
    {children}
  </Box>
);

function GroupNode({ data }: NodeProps<CardData>) {
  const { card, styles, names, alsoIn, dimmed, marked, onToggle, expanded, onExpand } = data;
  const g = card.group;
  const name = nameOf(g);
  const kind = levelOf(g, styles);
  const description = g.props.description as string | undefined;
  const subgroups = g.groups.length;
  const owns = ownsByType(g.owns);
  return (
    <Box
      title={description}
      sx={{
        width: ORG_CARD_W,
        height: card.height,
        bgcolor: "background.paper",
        border: 1,
        borderColor: marked ? kind.color : "divider",
        borderTop: 4,
        borderTopColor: kind.color,
        borderRadius: 1.5,
        boxShadow: marked ? `0 0 0 3px ${alpha(kind.color, 0.25)}` : 1,
        opacity: dimmed ? 0.35 : 1,
        cursor: "pointer",
        overflow: "hidden",
        transition: "opacity 120ms",
        "&:hover": { borderColor: kind.color },
      }}
    >
      <Handle type="target" id="top" position={Position.Top} style={{ visibility: "hidden" }} />
      <Handle type="target" id="left" position={Position.Left} style={{ visibility: "hidden" }} />
      <Box sx={{ height: ORG_HEADER_H, px: 1.25, pt: 0.75 }}>
        <Stack direction="row" sx={{ alignItems: "center", height: 18 }}>
          <Typography sx={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: kind.color }}>{kind.label}</Typography>
          {subgroups > 0 && (
            <Box
              component="button"
              type="button"
              className="nodrag nopan"
              aria-expanded={card.hidden === 0}
              title={card.hidden > 0 ? `Mostrar os subgrupos (${subgroups})` : "Recolher os subgrupos"}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(g.key);
              }}
              sx={{ display: "flex", alignItems: "center", gap: 0.25, height: 18, px: 0.5, bgcolor: "background.paper", color: "text.secondary", border: 1, borderColor: "divider", borderRadius: 0.75, cursor: "pointer", font: "inherit", fontSize: 10, "&:hover": { color: "text.primary", borderColor: kind.color } }}
            >
              {card.hidden > 0 ? `${subgroups} subgrupo${subgroups === 1 ? "" : "s"}` : null}
              {card.hidden > 0 ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </Box>
          )}
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mt: 0.5 }}>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </Typography>
          {!g.referenced && <FactsBadge size="dense" facts={g.facts} title={name} subtitle="Afirmações de existência" />}
        </Stack>
      </Box>

      {g.members.length === 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", height: ORG_MEMBER_H, px: 1.25 }}>
          Nenhum membro afirmado.
        </Typography>
      ) : (
        orderedMembers(g.members).map((m) => {
          const lead = isLead(m);
          const person = displayName(m.node);
          const role = m.facts.map((f) => f.props?.role).find((r) => typeof r === "string") as string | undefined;
          const others = (alsoIn.get(m.node.key) ?? []).filter((k) => k !== g.key);
          return (
            <Stack key={m.node.key} direction="row" spacing={1} sx={{ alignItems: "center", height: ORG_MEMBER_H, px: 1.25 }}>
              <Box
                sx={{
                  flex: "none",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  border: 1.5,
                  borderColor: kind.color,
                  bgcolor: lead ? kind.color : "transparent",
                  color: lead ? "#fff" : kind.color,
                }}
              >
                {initials(person)}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
                  <Box sx={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 13, fontWeight: lead ? 600 : 400 }}>
                    <Stop>
                      <NodeLink node={m.node} />
                    </Stop>
                  </Box>
                  {lead && (
                    <Tooltip title="Líder">
                      <Box component="span" sx={{ display: "inline-flex", flex: "none", color: kind.color }}>
                        <Star size={12} fill="currentColor" />
                      </Box>
                    </Tooltip>
                  )}
                  {others.length > 0 && (
                    <Tooltip title={`Também em: ${others.map((k) => names.get(k) ?? displayName({ key: k })).join(", ")}`}>
                      <Box component="span" sx={{ display: "inline-flex", flex: "none", color: "text.secondary" }}>
                        <Users size={12} />
                      </Box>
                    </Tooltip>
                  )}
                </Stack>
                {role && (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {role}
                  </Typography>
                )}
              </Box>
              <FactsBadge size="dense" facts={m.facts} title={`${person} é membro de ${name}`} />
            </Stack>
          );
        })
      )}

      {owns.length > 0 && (
        <Box sx={{ borderTop: 1, borderColor: "divider" }}>
          <Typography sx={{ height: ORG_OWNS_TITLE_H, display: "flex", alignItems: "flex-end", px: 1.25, fontSize: 10, fontWeight: 600, color: "text.secondary" }}>É dono de</Typography>
          {owns.map((t) => {
            const key = ownsKey(g.key, t.type);
            const isOpen = expanded.has(key);
            return (
              <Box key={key}>
                <Box
                  component="button"
                  type="button"
                  className="nodrag nopan"
                  aria-expanded={isOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpand(key);
                  }}
                  sx={{ display: "flex", alignItems: "center", gap: 0.5, width: "100%", height: ORG_OWNS_TYPE_H, px: 1, bgcolor: "transparent", color: "text.primary", border: 0, cursor: "pointer", font: "inherit", fontSize: 12, textAlign: "left", "&:hover": { bgcolor: alpha(kind.color, 0.06) } }}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Box component="span" sx={{ fontWeight: 600 }}>{t.edges.length}</Box>
                  {t.label}
                </Box>
                {isOpen &&
                  t.edges.map((e) => (
                    <Stack key={e.node.key} direction="row" spacing={0.75} sx={{ alignItems: "center", height: ORG_OWNS_ITEM_H, pl: 3.5, pr: 1.25 }}>
                      <Box title={displayName(e.node)} sx={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 12 }}>
                        <Stop>
                          {/* Sem o chip do kind: no cartão estreito ele corta o nome; o painel e a página mostram. */}
                          <NodeLink node={{ key: e.node.key, name: e.node.name, type: e.node.type }} />
                        </Stop>
                      </Box>
                      <FactsBadge size="dense" facts={e.facts} title={`${name} é dono de ${displayName(e.node)}`} />
                    </Stack>
                  ))}
              </Box>
            );
          })}
        </Box>
      )}
      {g.moreGroups && g.moreGroups.length > 0 && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ height: ORG_ROW_H, display: "flex", alignItems: "center", px: 1.25 }}>
          Mais {g.moreGroups.length} subgrupo{g.moreGroups.length === 1 ? "" : "s"}, na página do grupo
        </Typography>
      )}
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ visibility: "hidden" }} />
      <Handle type="source" id="stack" position={Position.Bottom} style={{ visibility: "hidden", left: ORG_STACK_TRUNK }} />
    </Box>
  );
}

type LinkData = { link: OrgLink; title: string; dimmed: boolean };

/** Ligação com o pai, com o selo das afirmações do PART_OF: no barramento, ou no tronco quando o filho está empilhado. */
function PartOfEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps<LinkData>) {
  const stack = data?.link.kind === "stack";
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8, offset: stack ? 8 : 20 });
  const x = stack ? sourceX : labelX;
  const y = stack ? targetY : labelY;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ ...style, opacity: data?.dimmed ? 0.35 : 1 }} />
      {data && data.link.facts.length > 0 && (
        <EdgeLabelRenderer>
          <Box
            className="nodrag nopan"
            onClick={(e) => e.stopPropagation()}
            sx={{ position: "absolute", transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, pointerEvents: "all", opacity: data.dimmed ? 0.35 : 1 }}
          >
            <FactsBadge size="count" facts={data.link.facts} title={data.title} subtitle="Afirmações de que o grupo faz parte do outro (PART_OF)" />
          </Box>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// "group" é um tipo embutido do reactflow, com estilo próprio: o nome aqui é outro.
const nodeTypes = { orgGroup: GroupNode };
const edgeTypes = { partOf: PartOfEdge };

/** Painel do grupo: o que não cabe no cartão, com as afirmações de cada relação. */
function GroupPanel({ card, parent, styles, onClose }: { card: OrgCard; parent?: OrgCard; styles: Map<string, LevelStyle>; onClose: () => void }) {
  const to = useTo();
  const g = card.group;
  const name = nameOf(g);
  const kind = levelOf(g, styles);
  const description = g.props.description as string | undefined;
  const owns = ownsByType(g.owns);
  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {g.level.length === 0 ? (
            <Typography variant="overline" sx={{ color: kind.color }}>
              {kind.label}
            </Typography>
          ) : (
            // Uma linha por nível afirmado: com fontes que discordam, todas aparecem, cada uma com as afirmações.
            g.level.map((e) => {
              const level = styles.get(e.node.key) ?? kind;
              return (
                <Stack key={e.node.key} direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                  <Typography variant="overline" sx={{ color: level.color }}>
                    {level.label}
                  </Typography>
                  <FactsBadge facts={e.facts} title={`${name} está no nível ${level.label}`} subtitle="Afirmações do nível (AT_LEVEL)" />
                </Stack>
              );
            })
          )}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="h6" sx={{ wordBreak: "break-word" }}>
              {name}
            </Typography>
            {!g.referenced && <FactsBadge facts={g.facts} title={name} subtitle="Afirmações de existência" />}
          </Stack>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label="Fechar">
          <X size={18} />
        </IconButton>
      </Stack>
      {parent && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Faz parte de
          </Typography>
          <NodeLink node={{ key: parent.key, name: nameOf(parent.group) }} />
          {g.parentFacts && g.parentFacts.length > 0 && <FactsBadge facts={g.parentFacts} title={`${name} faz parte de ${nameOf(parent.group)}`} subtitle="PART_OF" />}
        </Stack>
      )}
      <Button component={RouterLink} to={to(nodePath(g.key))} size="small" variant="outlined" sx={{ mt: 1.5 }}>
        Abrir a página do grupo
      </Button>
      <Box sx={{ mt: 2 }}>
        <Section title="Membros" count={g.members.length}>
          <EdgeList edges={orderedMembers(g.members)} owner={name} empty="Nenhum membro afirmado." />
        </Section>
        <Section title="É dono de" count={owns.reduce((n, t) => n + t.edges.length, 0)}>
          {owns.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nada afirmado.
            </Typography>
          ) : (
            owns.map((t) => (
              <Box key={t.type} sx={{ mb: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: "capitalize" }}>
                  {`${t.edges.length} ${t.label}`}
                </Typography>
                <EdgeList edges={t.edges} owner={name} />
              </Box>
            ))
          )}
        </Section>
        {g.groups.length > 0 && (
          <Section title="Subgrupos" count={g.groups.length}>
            <Stack spacing={0.5}>
              {g.groups.map((s) => (
                <Stack key={s.key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <NodeLink node={{ key: s.key, name: nameOf(s) }} />
                  {s.parentFacts && s.parentFacts.length > 0 && <FactsBadge facts={s.parentFacts} title={`${nameOf(s)} faz parte de ${name}`} subtitle="PART_OF" />}
                </Stack>
              ))}
            </Stack>
          </Section>
        )}
      </Box>
    </Box>
  );
}

/** Centraliza nos grupos destacados quando o destaque muda. */
function FitOn({ keys }: { keys: string[] }) {
  const flow = useReactFlow();
  // O efeito depende das chaves, não do array novo a cada render.
  const id = keys.join(",");
  useEffect(() => {
    const t = setTimeout(() => {
      if (keys.length > 0) flow.fitView({ nodes: keys.map((k) => ({ id: k })), padding: 0.4, maxZoom: 1, duration: 400 });
      else flow.fitView({ maxZoom: 1, duration: 400 });
    }, 50);
    return () => clearTimeout(t);
  }, [id]);
  return null;
}

/**
 * Organograma: os grupos de cima para baixo, com os membros (papel, quem lidera e quem está em mais de um grupo) e o
 * que cada grupo possui no cartão, um tipo por linha, que abre para mostrar os itens. Toda ligação tem o selo das
 * afirmações: a filiação, no membro; a posse, no item; o PART_OF, na aresta. O clique no cartão abre o painel do grupo. `highlight` (pessoa ou grupo) esmaece o resto.
 */
export function OrgChart({
  roots,
  levels,
  everyone = roots,
  collapsed,
  onToggle,
  expanded,
  onExpand,
  highlight,
  height = 560,
}: {
  roots: OrgNode[];
  /** Os níveis da resposta do org_structure: dão o rótulo e a cor de cada cartão. */
  levels: NodeView[];
  /** Toda a estrutura carregada, para o "também em" considerar grupos fora do recorte. */
  everyone?: OrgNode[];
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  /** Tipos de posse abertos nos cartões (`ownsKey`). */
  expanded: Set<string>;
  onExpand: (key: string) => void;
  highlight?: string;
  height?: number | string;
}) {
  const positioned = useMemo(() => orgLayout(roots, collapsed, expanded), [roots, collapsed, expanded]);
  const styles = useMemo(() => levelStyles(levels), [levels]);
  const all = useMemo(() => flatten(everyone), [everyone]);
  const names = useMemo(() => new Map(all.map((g) => [g.key, nameOf(g)])), [all]);
  const alsoIn = useMemo(() => memberships(everyone), [everyone]);
  const byKey = useMemo(() => new Map(positioned.cards.map((c) => [c.key, c])), [positioned]);
  const [open, setOpen] = useState<string | null>(null);

  const marked = useMemo(() => {
    if (!highlight) return new Set<string>();
    if (byKey.has(highlight)) return new Set([highlight]);
    return new Set(positioned.cards.filter((c) => c.group.members.some((m) => m.node.key === highlight)).map((c) => c.key));
  }, [highlight, byKey, positioned]);
  const dim = (key: string) => marked.size > 0 && !marked.has(key);

  const nodes: FlowNode<CardData>[] = positioned.cards.map((c) => ({
    id: c.key,
    type: "orgGroup",
    position: { x: c.x, y: c.y },
    data: { card: c, styles, names, alsoIn, dimmed: dim(c.key), marked: marked.has(c.key), onToggle, expanded, onExpand },
  }));
  const edges: FlowEdge<LinkData>[] = positioned.links.map((l) => ({
    id: l.id,
    source: l.from,
    target: l.to,
    sourceHandle: l.kind === "stack" ? "stack" : "bottom",
    targetHandle: l.kind === "stack" ? "left" : "top",
    type: "partOf",
    data: { link: l, title: `${names.get(l.to) ?? displayName({ key: l.to })} faz parte de ${names.get(l.from) ?? displayName({ key: l.from })}`, dimmed: dim(l.from) && dim(l.to) },
    style: { strokeWidth: 1.5, stroke: "#94a3b8" },
  }));

  const card = open ? byKey.get(open) : undefined;
  return (
    <ReactFlowProvider>
      <Box sx={{ height, minHeight: 420, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.default" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => setOpen(n.id)}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <FitOn keys={[...marked]} />
        </ReactFlow>
      </Box>
      <Drawer anchor="right" open={!!card} onClose={() => setOpen(null)} sx={{ zIndex: (t) => t.zIndex.modal }} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 560 } } } }}>
        {card && <GroupPanel card={card} parent={card.parent ? byKey.get(card.parent) : undefined} styles={styles} onClose={() => setOpen(null)} />}
      </Drawer>
    </ReactFlowProvider>
  );
}
