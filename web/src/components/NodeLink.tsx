import { Link as RouterLink } from "react-router-dom";
import { Chip, Link, Stack, Tooltip } from "@mui/material";
import type { NodeRef } from "@/lib/types";
import { displayName, nodePath, typeLabel, typeOfKey } from "@/lib/nodes";
import { useTo } from "@/lib/nav";

/** Link para a página de um nó, com o nome e, se pedido, o tipo e o kind. */
export function NodeLink({ node, showType = false, stale = false }: { node: NodeRef | { key: string; name?: string | null; type?: string; kind?: string | null }; showType?: boolean; stale?: boolean }) {
  const to = useTo();
  const type = ("type" in node && node.type) || typeOfKey(node.key);
  return (
    <Stack direction="row" spacing={0.75} component="span" sx={{ alignItems: "center", display: "inline-flex", minWidth: 0 }}>
      {showType && <Chip size="small" variant="outlined" label={typeLabel(type)} sx={{ height: 20, fontSize: 11 }} />}
      <Tooltip title={node.key}>
        <Link
          component={RouterLink}
          to={to(nodePath(node.key))}
          underline="hover"
          sx={{ overflowWrap: "break-word", ...(stale ? { opacity: 0.6, textDecoration: "line-through" } : {}) }}
        >
          {displayName(node)}
        </Link>
      </Tooltip>
      {node.kind && <Chip size="small" label={node.kind} sx={{ height: 20, fontSize: 11 }} />}
    </Stack>
  );
}
