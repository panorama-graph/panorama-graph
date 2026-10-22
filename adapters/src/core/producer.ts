import pkg from "../../package.json" with { type: "json" };

/**
 * Quem monta os retratos destes adaptadores: o pacote, que versiona os tradutores juntos. A API guarda a versão no
 * escopo, e o graph-deployments refaz o retrato congelado de um commit quando ele foi montado por uma versão mais
 * antiga. Por isso, toda mudança no que um tradutor extrai sobe a versão do pacote.
 */
export const PRODUCER = { name: pkg.name, version: pkg.version } as const;
