# example-seed — Guia para agentes

Este arquivo diz **como trabalhar** no projeto. **O que ele lê e publica, e como uma organização o adapta,** está no [README.md](README.md).

## Regras

- **É um exemplo para copiar.** Depende só do `@panorama-graph/sdk`; nada de importar de `../adapters`. O código fica curto e direto, com os comentários explicando o porquê de cada regra (é o que quem copia vai ler).
- **A organização fica nos dados.** O ACME Bank está em `data/acme/`; o código não conhece nome, host nem domínio dela. Os níveis da estrutura (`levels` no `directory.json`) também são dado: nenhum nome de nível no código.
- **Sem se denunciar.** As fontes, os escopos e as evidências são os do sistema de onde os fatos vêm (`directory`, `k8s-infra`, `k8s-routes`), como na carga à mão de `../adapters/seeds/acme/`: quem consulta o grafo precisa confiar nele como no sistema final.
- **Mudou o formato de entrada?** Atualize os tipos, os exemplos do README e `data/acme/` na mesma entrega.
- **Modelo novo na API?** Suba a versão do SDK no `package.json`; o `check.ts` lê o modelo do SDK e não precisa mudar.

## Testes

- `bun run lint` e `bun test`.
- `test/translate.test.ts` cobre a tradução e a conferência sobre dados neutros; `test/acme.test.ts`, os exports da organização de exemplo, e a coerência deles com o resto da carga de exemplo (`../adapters`).
- A carga de verdade é validada contra uma instância: `--dry-run`, carga, segunda carga só com `unchanged` e consulta pelo console ou pelo MCP.
