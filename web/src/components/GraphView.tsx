import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ReactFlow, {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  getBezierPath,
  type Edge as FlowEdge,
  type EdgeProps,
  type Node as FlowNode,
  type NodeProps,
} from "reactflow";
import { Box, Stack, Typography, alpha, useTheme } from "@mui/material";
import { GRAPH_NODE_SIZE, edgeEndpoints, layout, type EndpointItem, type GraphEdge, type GraphGroup, type GraphNode, type PositionedGroup, type StackItem, LIBRARY } from "@/lib/graphLayout";
import { CARD_ROLES, TECHS } from "@/lib/tech";
import { displayName, nodePath } from "@/lib/nodes";
import { diverges, sourcesOf } from "@/lib/facts";
import { useOpenFacts } from "./FactsPanel";
import { TechIcon, techImage } from "./TechIcon";
import { useTo } from "@/lib/nav";

const KIND_COLORS: Record<string, string> = {
  service: "#2563eb",
  bff: "#7c3aed",
  frontend: "#059669",
  job: "#d97706",
  library: "#64748b",
  infra: "#0f766e",
};

/** Tópicos e recursos: cores próprias, fora da paleta dos componentes. */
const TOPIC_COLOR = "#0891b2";
const RESOURCE_COLORS: Record<string, string> = { database: "#be123c", bucket: "#be123c", cache: "#c2410c", broker: "#4d7c0f" };

const VIA_NAMES: Record<string, string> = { CONSUMES: "Consome a API", CALLS: "Chama o endpoint", SUBSCRIBES: "Assina o tópico" };

function nodeColor(n: GraphNode): string {
  if (n.type === "Topic") return TOPIC_COLOR;
  if (n.type === "Resource") return (n.kind && RESOURCE_COLORS[n.kind]) || "#475569";
  return (n.kind && KIND_COLORS[n.kind]) || "#475569";
}

type Shape = "box" | "pill" | "cylinder" | "tube";

/** Componente em caixa, banco em cilindro, tópico em tubo deitado; os outros recursos (cache, broker) em pílula. */
function nodeShape(n: GraphNode): Shape {
  if (n.type === "Topic") return "tube";
  if (n.type === "Resource") return n.kind === "database" || n.kind === "bucket" ? "cylinder" : "pill";
  return "box";
}

/** Altura da tampa do cilindro e largura da ponta do tubo, em px. */
const CAP = 7;

/** Contorno desenhado em SVG, do tamanho do nó: o cilindro e o tubo têm a tampa à mostra, como no desenho clássico. */
function ShapeOutline({ shape, color, fill, dashed }: { shape: "cylinder" | "tube"; color: string; fill: string; dashed?: boolean }) {
  const { width: w, height: h } = GRAPH_NODE_SIZE;
  // O traço tem 2px: o desenho fica 1px para dentro, para não ser cortado.
  const [x0, y0, x1, y1] = [1, 1, w - 1, h - 1];
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  const [body, cap] =
    shape === "cylinder"
      ? [
          `M${x0},${y0 + CAP} A${rx},${CAP} 0 0 1 ${x1},${y0 + CAP} V${y1 - CAP} A${rx},${CAP} 0 0 1 ${x0},${y1 - CAP} Z`,
          `M${x0},${y0 + CAP} A${rx},${CAP} 0 0 0 ${x1},${y0 + CAP}`,
        ]
      : [
          `M${x0 + CAP},${y0} H${x1 - CAP} A${CAP},${ry} 0 0 1 ${x1 - CAP},${y1} H${x0 + CAP} A${CAP},${ry} 0 0 1 ${x0 + CAP},${y0} Z`,
          `M${x1 - CAP},${y0} A${CAP},${ry} 0 0 0 ${x1 - CAP},${y1}`,
        ];
  return (
    <Box component="svg" width={w} height={h} sx={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
      <g fill={fill} stroke={color} strokeWidth={2} strokeDasharray={dashed ? "6 4" : undefined}>
        <path d={body} />
        <path d={cap} fill="none" />
      </g>
    </Box>
  );
}

/** Dados do nó no React Flow: o nó do grafo e o estado da lista da stack. */
type NodeData = GraphNode & { expanded: boolean; onToggle: (key: string) => void };

/** Insígnia na borda de cima do cartão: o ícone, ou o nome quando não há SVG da tecnologia (ex.: gradle). */
function TechBadge({ tech, label, version }: { tech?: string; label: string; version?: string }) {
  const image = tech ? techImage(tech, "icon") : undefined;
  return (
    <Box
      title={version ? `${label} ${version}` : label}
      sx={{ height: 22, minWidth: 22, px: image ? 0.25 : 0.75, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 1 }}
    >
      {image ? <TechIcon tech={tech} size={16} /> : <Typography sx={{ fontSize: 10, fontWeight: 600, lineHeight: 1 }}>{label}</Typography>}
    </Box>
  );
}

/**
 * A stack inteira (`BUILT_WITH`), aberta pelo botão do cartão: cada linha abre as afirmações da tecnologia; o alerta
 * marca quando as fontes discordam.
 */
function StackPanel({ owner, stack }: { owner: string; stack: StackItem[] }) {
  const openFacts = useOpenFacts();
  return (
    <Box
      onClick={(e) => e.stopPropagation()}
      sx={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: GRAPH_NODE_SIZE.width + 40, p: 1, bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 1, boxShadow: 3, cursor: "default" }}
    >
      <Typography variant="caption" color="text.secondary">
        Construído com
      </Typography>
      {stack.map((t) => {
        const name = t.label ?? t.name;
        return (
          <Stack
            key={t.key}
            direction="row"
            spacing={0.75}
            role="button"
            tabIndex={0}
            title={`${sourcesOf(t.facts).join(", ")}. Clique para ver as afirmações.`}
            onClick={() => openFacts({ title: `${owner} é construído com ${name}`, sections: [{ facts: t.facts }] })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openFacts({ title: `${owner} é construído com ${name}`, sections: [{ facts: t.facts }] });
            }}
            sx={{ alignItems: "center", py: 0.25, px: 0.5, mx: -0.5, borderRadius: 0.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
          >
            <Box sx={{ width: 16, display: "flex" }}>
              <TechIcon tech={t.tech} size={16} />
            </Box>
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
              {t.version && (
                <Typography component="span" variant="caption" color="text.secondary">
                  {` ${t.version}`}
                </Typography>
              )}
            </Typography>
            {diverges(t.facts) && <AlertTriangle size={14} color="#d97706" />}
          </Stack>
        );
      })}
    </Box>
  );
}

function ComponentNode({ data }: NodeProps<NodeData>) {
  const color = nodeColor(data);
  const shape = nodeShape(data);
  const theme = useTheme();
  const fill = data.center ? alpha(color, 0.13) : theme.palette.background.paper;
  const drawn = shape === "cylinder" || shape === "tube";
  // Insígnias: a tecnologia do nó (a do recurso; a biblioteca, no componente `library`) e, no componente, a primeira
  // tecnologia conhecida de cada papel da stack (linguagem, framework, build).
  const own: StackItem[] = data.tech
    ? [{ key: data.tech, name: data.tech, tech: data.tech, label: data.tech === LIBRARY ? "biblioteca" : TECHS.find((t) => t.id === data.tech)?.label, facts: [] }]
    : [];
  const fromStack = CARD_ROLES.map((role) => data.stack?.find((t) => t.role === role)).filter((t): t is StackItem => !!t);
  const badges = [...own, ...fromStack];
  return (
    <Box
      title={(data.keys ?? [data.key]).join("\n")}
      sx={{
        position: "relative",
        width: GRAPH_NODE_SIZE.width,
        height: GRAPH_NODE_SIZE.height,
        // O texto fica longe da tampa e das insígnias: abaixo delas no alto, antes da ponta no tubo.
        pl: shape === "tube" ? 2 : 1.25,
        pr: shape === "tube" ? 2.5 : 1.25,
        pt: badges.length > 0 || shape === "cylinder" ? "12px" : 0,
        borderRadius: shape === "pill" ? 7 : 1.5,
        border: drawn ? 0 : 2,
        borderColor: color,
        borderStyle: data.stale ? "dashed" : "solid",
        bgcolor: drawn ? "transparent" : fill,
        opacity: data.stale ? 0.6 : 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {drawn && <ShapeOutline shape={shape} color={color} fill={fill} dashed={data.stale} />}
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      {badges.length > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ position: "absolute", top: -11, left: 10 }}>
          {badges.map((t) => (
            <TechBadge key={t.key} tech={t.tech} label={t.label ?? t.name} version={t.version} />
          ))}
        </Stack>
      )}
      {data.stack && (
        <Box
          component="button"
          type="button"
          aria-expanded={data.expanded}
          aria-label={data.expanded ? "Fechar a stack" : "Ver a stack"}
          title={data.expanded ? "Fechar a stack" : `Ver a stack (${data.stack.length})`}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle(data.key);
          }}
          sx={{ position: "absolute", top: -11, right: 8, height: 22, px: 0.5, display: "flex", alignItems: "center", gap: 0.25, bgcolor: "background.paper", color: "text.secondary", border: 1, borderColor: "divider", borderRadius: 1, cursor: "pointer", font: "inherit", fontSize: 10, "&:hover": { color: "text.primary", borderColor: color } }}
        >
          {data.stack.length}
          {data.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </Box>
      )}
      <Typography variant="body2" sx={{ position: "relative", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {data.name}
      </Typography>
      <Typography variant="caption" component="div" sx={{ position: "relative", color, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {data.caption ?? data.kind ?? "componente"}
        {data.level !== undefined && data.level !== 0 ? ` · nível ${data.level}` : ""}
      </Typography>
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
      {data.expanded && data.stack && <StackPanel owner={data.name} stack={data.stack} />}
    </Box>
  );
}

/**
 * Contorno de um domínio, atrás dos cartões. Só o título recebe o clique (abre a página do domínio); o resto deixa
 * o clique passar para o fundo, para clicar no vazio dentro do contorno não navegar.
 */
function DomainNode({ data }: NodeProps<PositionedGroup>) {
  const theme = useTheme();
  const color = theme.palette.text.secondary;
  return (
    <Box
      sx={{
        width: data.width,
        height: data.height,
        border: 1.5,
        borderStyle: "dashed",
        borderColor: alpha(color, 0.45),
        borderRadius: 2,
        bgcolor: alpha(theme.palette.primary.main, 0.035),
        pointerEvents: "none",
      }}
    >
      <Typography
        variant="caption"
        title={`Domínio ${data.name}. Sistemas: ${data.systems.join(", ")}`}
        sx={{ pointerEvents: "auto", cursor: "pointer", display: "inline-block", px: 1.25, pt: 0.5, fontWeight: 600, color, "&:hover": { textDecoration: "underline" } }}
      >
        {data.name}
        <Box component="span" sx={{ fontWeight: 400, ml: 0.75 }}>
          domínio
        </Box>
      </Typography>
    </Box>
  );
}

type EdgeData = { edge: GraphEdge; endpoints: EndpointItem[]; expanded: boolean; onToggle: (id: string) => void; onOpen: (e: GraphEdge) => void };

/**
 * Aresta com o rótulo em HTML: clicar no rótulo abre as afirmações, como clicar na seta. Quando a ligação chama
 * mais de um endpoint, o botão do rótulo abre a lista deles (método e caminho), e cada um leva à página do endpoint.
 */
function LinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }: EdgeProps<EdgeData>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const navigate = useNavigate();
  const to = useTo();
  if (!data) return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
  const { edge, endpoints, expanded, onToggle, onOpen } = data;
  const stroke = (style?.stroke as string | undefined) ?? "#64748b";
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <Box
          className="nodrag nopan"
          // O rótulo fica num portal, mas o clique sobe pela árvore do React até a aresta: aqui ele para.
          onClick={(e) => e.stopPropagation()}
          sx={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all", zIndex: expanded ? 1000 : 0 }}
        >
          <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", bgcolor: "rgba(255,255,255,0.9)", borderRadius: 0.5, px: 0.25 }}>
            <Typography component="span" onClick={() => onOpen(edge)} sx={{ fontSize: 11, whiteSpace: "nowrap", cursor: "pointer", "&:hover": { textDecoration: "underline" } }}>
              {edge.label}
            </Typography>
            {endpoints.length > 0 && (
              <Box
                component="button"
                type="button"
                aria-expanded={expanded}
                aria-label={expanded ? "Fechar os endpoints" : "Ver os endpoints"}
                title={expanded ? "Fechar os endpoints" : `Ver os endpoints (${endpoints.length})`}
                onClick={() => onToggle(id)}
                sx={{ display: "flex", alignItems: "center", p: 0, height: 16, bgcolor: "background.paper", color: "text.secondary", border: 1, borderColor: "divider", borderRadius: 0.5, cursor: "pointer", "&:hover": { color: "text.primary", borderColor: stroke } }}
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </Box>
            )}
          </Stack>
          {expanded && endpoints.length > 0 && (
            <Box sx={{ position: "absolute", top: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)", minWidth: 180, p: 1, bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 1, boxShadow: 3 }}>
              <Typography variant="caption" color="text.secondary">
                Endpoints chamados
              </Typography>
              {endpoints.map((ep) => (
                <Stack
                  key={ep.key}
                  direction="row"
                  spacing={0.75}
                  onClick={() => navigate(to(nodePath(ep.key)))}
                  title={ep.key}
                  sx={{ alignItems: "baseline", py: 0.25, cursor: "pointer", "&:hover .ep-path": { textDecoration: "underline" } }}
                >
                  {ep.method && <Typography sx={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{ep.method}</Typography>}
                  <Typography className="ep-path" sx={{ fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {ep.path ?? displayName({ key: ep.key })}
                  </Typography>
                </Stack>
              ))}
            </Box>
          )}
        </Box>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { component: ComponentNode, domain: DomainNode };
const edgeTypes = { link: LinkEdge };

/**
 * Componentes e o que eles usam: dependências por API (CONSUMES, CALLS), tópicos e recursos. Toda seta sai de quem
 * usa, então quem depende fica à esquerda. Com `groups`, cada domínio é um contorno em volta dos seus nós. Rotas físicas não entram. Clique no nó abre a página dele; na aresta, as
 * afirmações: de cada via, das duas pontas, ou da ligação com o tópico ou o recurso (por ambiente).
 */
export function GraphView({
  nodes,
  edges,
  groups,
  height = 520,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups?: GraphGroup[];
  height?: number;
}) {
  const navigate = useNavigate();
  const to = useTo();
  const openFacts = useOpenFacts();
  const positioned = useMemo(() => layout(nodes, edges, groups), [nodes, edges, groups]);
  const names = useMemo(() => new Map(nodes.map((n) => [n.key, n.name])), [nodes]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (key: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );

  const [openEdges, setOpenEdges] = useState<Set<string>>(new Set());
  const toggleEdge = useCallback(
    (id: string) =>
      setOpenEdges((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const openEdge = useCallback(
    (e: GraphEdge) => {
      if (e.facts) {
        openFacts(e.facts);
        return;
      }
      const from = names.get(e.from) ?? displayName({ key: e.from });
      const target = names.get(e.to) ?? displayName({ key: e.to });
      openFacts({
        title: `${from} depende de ${target}`,
        subtitle: "Dependência lógica, derivada das afirmações de quem depende e de quem oferece.",
        sections: e.via.flatMap((v) => {
          const what = `${VIA_NAMES[v.type] ?? v.type} ${v.endpoint?.method && v.endpoint.path ? `${v.endpoint.method} ${v.endpoint.path}` : displayName({ key: v.node })}`;
          return [
            { label: `${what}: afirmações de ${from}`, facts: v.facts.dependent },
            { label: `${what}: afirmações de ${target}`, facts: v.facts.provider },
          ];
        }),
      });
    },
    [names, openFacts],
  );

  // O nó aberto fica por cima dos outros, para a lista da stack não ficar escondida.
  const domainNodes: FlowNode<PositionedGroup>[] = positioned.groups.map((g) => ({
    id: g.key,
    type: "domain",
    position: { x: g.x, y: g.y },
    data: g,
    zIndex: -1,
    selectable: false,
    focusable: false,
    style: { pointerEvents: "none" },
  }));
  const flowNodes: FlowNode<NodeData>[] = positioned.nodes.map((n) => ({
    id: n.key,
    type: "component",
    position: { x: n.x, y: n.y },
    data: { ...n, expanded: expanded.has(n.key), onToggle: toggle },
    ...(expanded.has(n.key) ? { zIndex: 1000 } : {}),
  }));
  const flowEdges: FlowEdge<EdgeData>[] = positioned.edges.map((e) => {
    const split = e.facts
      ? e.facts.sections.some((x) => diverges(x.facts))
      : e.via.some((v) => diverges([...v.facts.dependent, ...v.facts.provider]));
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      type: "link",
      // Um endpoint só já está no rótulo; o botão aparece com mais de um.
      data: { edge: e, endpoints: ((x) => (x.length > 1 ? x : []))(edgeEndpoints(e)), expanded: openEdges.has(e.id), onToggle: toggleEdge, onOpen: openEdge },
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.5, stroke: split ? "#d97706" : "#64748b" },
    };
  });

  if (nodes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nada para mostrar com estas camadas.
      </Typography>
    );
  }

  return (
    <Box sx={{ height, border: 1, borderColor: "divider", borderRadius: 1 }}>
      <ReactFlow
        nodes={[...domainNodes, ...flowNodes]}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.2}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => navigate(to(nodePath(n.id)))}
        edgeTypes={edgeTypes}
        onEdgeClick={(_, fe) => {
          const d = fe.data as EdgeData | undefined;
          if (d) openEdge(d.edge);
        }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </Box>
  );
}
