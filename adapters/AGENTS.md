# adapters — Guia para agentes

Este arquivo diz **como trabalhar** no projeto. **O que cada adaptador lê e grava** está no [README.md](README.md). O modelo do grafo está no [MODELO.md](../api/MODELO.md), e as regras de proveniência no [PROVENIENCIA.md](../api/PROVENIENCIA.md).

## Regras

- **Genérico.** Nenhum adaptador conhece uma organização. O ACME Bank é só o exemplo: os nomes dela aparecem nas fixtures, nos testes e na carga à mão (`seeds/acme/`), nunca no código.
- **Carga à mão sem se denunciar.** Os arquivos de `seeds/` usam a fonte, o escopo e a evidência que o adaptador real daquele assunto vai usar (`directory`, `service-catalog`, `k8s-infra`, `k8s-routes`, `service-config`), e nunca `manual`, `seed` ou `cadastro`: quem consulta o grafo precisa confiar nele como no sistema final. Os dados do ACME Bank são fictícios e coerentes entre si: os mesmos componentes, repositórios, donos e ambientes em todas as cargas.
- **Artefatos neutros primeiro.** Os adaptadores leem formatos padrão (CycloneDX, OpenAPI, AsyncAPI, Pact), em vez de interpretar build ou código. Um formato próprio (manifesto, clientes HTTP, acesso a dados) é pequeno, tem nome do produto (`panorama-graph-<artefato>/<versão>`) e é especificado em JSON Schema em `schemas/`. Mudar o formato muda o esquema, o tradutor, `src/graph-publish/formats.ts` e o README na mesma entrega; campo novo e opcional fica na mesma versão, o resto é versão nova.
- **Um retrato por fonte e escopo.** Cada fonte envia tudo o que viu no escopo, e a API marca como `stale` o que sumiu. Artefato ausente não gera retrato; artefato vazio gera retrato vazio.
- **Linha principal e retrato congelado.** O `graph-publish` do pipeline (ou o `graph-receiver`, com o pacote que o build envia) publica a linha principal (escopo `{component}`). O retrato de uma versão implantada (escopo com `commit`) só é publicado por quem vê o commit rodando, o `graph-deployments`: o pipeline não decide o que está implantado.
- **Chaves pelas receitas do SDK** (`@panorama-graph/sdk`, reexportadas em [src/core/keys.ts](src/core/keys.ts)). Receita nova ou mudada é mudança no SDK (`../sdks/typescript`), e entra no README na mesma entrega.
- **Evidência sempre.** Todo fato aponta `repo@sha:caminho`, com ponteiro JSON ou nome de método quando ajuda a achar o trecho.
- **Nada é inventado.** O que não sai do artefato não entra: um pact sem operação conhecida fica só no `CONSUMES` e gera aviso.
- **Identidade do receptor só do pacote.** O `graph-receiver` chama o `planPublish` com o ambiente vazio: as variáveis de CI do processo do receptor nunca identificam o componente de um pacote.
- **A versão do pacote é a dos tradutores.** Todo retrato diz quem o montou (`producer`: o nome e a versão do `package.json`), e o `graph-deployments` refaz o retrato congelado montado por uma versão mais antiga. Mudou o que um tradutor extrai (fato, propriedade ou evidência novos)? Suba a versão do pacote na mesma entrega; sem isso, os commits já implantados ficam com o retrato antigo.
- **O modelo é da API.** Tipo de nó, relação ou propriedade novos são mudança versionada em `../api`, que regera o SDK; os adaptadores o usam pelo workspace e se ajustam no mesmo commit. Os CLIs conferem o modelo da API contra o do SDK (`assertModel`) antes de enviar.

## Código

| Caminho | Papel |
|---|---|
| `src/core/` | O que todo adaptador usa: `snapshot.ts` (retrato sem repetições), `keys.ts` (as receitas de chave do SDK e os auxiliares de purl e caminhos), `api.ts` (carga pelo cliente do SDK, com o retrato desatualizado como resultado). |
| `src/graph-publish/cli.ts` | CLI: opções, resumo, envio e código de saída. |
| `src/graph-publish/publish.ts` | Lê os artefatos (`bundle.ts`: um diretório ou os arquivos recebidos) e monta um retrato por artefato presente. |
| `src/graph-publish/report.ts` | O resumo do plano e de cada envio, igual no CLI e no receptor. |
| `src/graph-receiver/` | O receptor dos pacotes de build: `receiver.ts` (o `POST /v1/builds`, testável sem abrir porta) e `cli.ts` (o servidor). Usa o `planPublish` sem nada a mais: a tradução é uma só. |
| `src/graph-publish/formats.ts` | Formatos próprios: nome de cada um e conferência do `format`. |
| `src/graph-publish/identity.ts` | Identidade do componente: manifesto, variáveis do CI (GitLab e GitHub) e opções. |
| `src/graph-publish/artifacts/` | Um tradutor puro por artefato: recebe o documento e devolve o retrato. |
| `src/graph-deployments/` | Implantações lidas do cluster: `deployments.ts` monta os retratos por ambiente a partir do JSON do `kubectl` (anotações e labels neutros), `publish.ts` congela os commits em execução (pacote de artefatos → `graph-publish` com retrato congelado) antes de publicar as implantações, `cli.ts` é o CLI. |
| `src/graph-seed/` | CLI e leitura dos retratos em YAML (`seed.ts`). |
| `schemas/` | JSON Schema dos formatos próprios, conferidos contra as fixtures em `test/formats.test.ts`, e do pacote do receptor (`build.schema.json`, em `test/receiver.test.ts`). |
| `seeds/acme/` | Carga à mão da organização de teste (ver README). |
| `test/fixtures/<serviço>/` | Artefatos reais de dois serviços do ACME Bank, gerados pelo plugin Gradle do produto ([../gradle-plugin](../gradle-plugin/README.md)), que a biblioteca interna do ACME Bank aplica (o SBOM sem hashes e licenças). |

## Testes

- `bun run lint` e `bun test` precisam passar antes de entregar.
- Os tradutores são testados sobre as fixtures reais. Para renová-las, rode `./gradlew architectureArtifacts` no serviço e copie `build/architecture/`.
- A carga de verdade é validada contra o banco de desenvolvimento do panorama-graph-api: `--dry-run` revisado, carga, segunda carga só com `unchanged` e consulta pelo MCP. Vale para o `graph-publish`, o `graph-receiver` (pelo `architecturePublish` de um serviço real), o `graph-deployments` e o `graph-seed`.
