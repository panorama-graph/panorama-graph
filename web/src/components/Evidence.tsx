import { Link, Typography } from "@mui/material";
import { evidenceHref, shortEvidence } from "@/lib/evidence";

/** A evidência de um fato: link quando dá (URL ou ponteiro de código com o template), senão texto. */
export function Evidence({ value }: { value: string }) {
  const href = evidenceHref(value);
  const text = shortEvidence(value);
  const sx = { fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" } as const;
  return href ? (
    <Link href={href} target="_blank" rel="noreferrer" title={value} sx={sx}>
      {text}
    </Link>
  ) : (
    <Typography component="span" title={value} sx={sx}>
      {text}
    </Typography>
  );
}
