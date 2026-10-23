# @panorama-graph/sdk

Tipos, receitas de chave e cliente REST do panorama-graph, para quem consulta o grafo ou publica fatos nele a partir de TypeScript. Os tipos são gerados do contrato que a API publica (o OpenAPI de `/v1` e o modelo de `GET /v1/schema`), e não escritos à mão.

## Instalar

```sh
npm install @panorama-graph/sdk     # ou pnpm add @panorama-graph/sdk
```

## Consultar

As consultas são as mesmas ferramentas que os agentes chamam pelo MCP, com os mesmos argumentos e a mesma resposta. O nome da consulta escolhe o tipo dos argumentos e da resposta:

```ts
import { PanoramaGraphClient, PanoramaGraphError } from "@panorama-graph/sdk";

const graph = new PanoramaGraphClient({ baseUrl: "http://localhost:3200" });

const { consumers } = await graph.query("api_consumers", { target: "product-api", endpoint: "GET /products/{id}" });
for (const c of consumers) {
  for (const call of c.calls) console.log(c.component.key, call.node.key, call.facts.map((f) => f.evidence));
}
```

Toda relação vem com `facts`: uma afirmação por fonte, com a evidência. Com `detail: "summary"`, as afirmações vêm resumidas (os campos de `Fact` que só existem em `full` ficam ausentes).

## Publicar fatos

```ts
import { PanoramaGraphClient, componentKey, httpApiKey, type Snapshot } from "@panorama-graph/sdk";

const graph = new PanoramaGraphClient({ baseUrl: "http://localhost:3200" });
await graph.assertModel(); // a API está no modelo deste SDK?

const component = componentKey("example/catalog/product-api");
const snapshot: Snapshot = {
  source: "meu-adaptador",
  scope: { component: "example/catalog/product-api" },
  observedAt: new Date().toISOString(),
  evidenceBase: "git.example.com/example/catalog/product-api@abc123:",
  nodes: [{ key: component, type: "Component", props: { kind: "service" }, evidence: "catalog-info.yaml" }],
  relations: [{ type: "PROVIDES", from: component, to: httpApiKey("product-api"), evidence: "openapi.json" }],
};
await graph.ingest(snapshot, { dryRun: true }); // confere e conta, sem gravar
await graph.ingest(snapshot);
```

As receitas de chave (`componentKey`, `endpointKey`, `libraryKey`...) são as mesmas em todos os produtores: com elas, fatos de fontes diferentes caem no mesmo nó. APIs e tópicos versionados seguem uma convenção, com funções próprias: `pathVersion` (o primeiro segmento do caminho), `splitServiceVersion` (o nome do serviço exposto na infraestrutura, `servico-xpto-v2`), `topicVersion` e `normalizeInterfaceVersion` (`1` e `V1` viram `v1`). `httpApiKey` recebe a versão da API; `endpointKey`, só a do código, nunca a do host (veja [Versões de APIs e tópicos](../../api/MODELO.md#versões-de-apis-e-tópicos)). `nodeTypeFromKey` diz o tipo do nó pelo prefixo, segundo o modelo (`NODE_TYPES`). Os casos de [sdks/key-recipes.json](../key-recipes.json) são o contrato das receitas: o SDK se confere contra eles, e um SDK em outra linguagem também.

## Autenticação

Sem SSO configurado, a instância é anônima: nada a mandar, a não ser o token de ingestão na escrita, quando a instância o exige. Com SSO, as máquinas mandam um token, e o navegador usa a sessão do login:

```ts
// Adaptador ou CI: o token de ingestão ou um JWT de um emissor confiável (ex.: o OIDC do CI).
const graph = new PanoramaGraphClient({ baseUrl: "https://grafo.example.com", token: process.env.GRAPH_TOKEN });

// Navegador, com a API em outra origem: o cookie da sessão vai junto.
const browser = new PanoramaGraphClient({ baseUrl: "https://grafo-api.example.com", credentials: "include" });
const { mode, identity } = await browser.me();
if (mode === "sso" && !identity) location.href = browser.loginUrl(location.href);
```

## Erros

Todo erro da API vira `PanoramaGraphError`, com `code`, `status` e `details`. Decida pelo `code`, que é estável, e não pela mensagem:

| `code` | Quando |
|---|---|
| `unauthorized` | Sem sessão ou token, ou token inválido |
| `not_found` | Nó, escopo ou rota que não existe |
| `ambiguous` | O nome casa com mais de um nó (`details.candidates`) |
| `outdated_snapshot` | Retrato mais antigo que o último do mesmo escopo: não é gravado |
| `invalid_snapshot` | Carga fora do modelo ou sem evidência (`details.errors`) |
| `unreachable` | A API não respondeu |

## Versões

- `QUERY_CONTRACT_VERSION`: a versão do contrato das consultas que os tipos descrevem. Na mesma versão, a API só ganha consultas, argumentos opcionais e campos de resposta.
- `MODEL_VERSION`: a versão do modelo (tipos de nó, de relação e propriedades). `assertModel()` recusa uma API em outro modelo.

Uma versão do SDK com o mesmo contrato e o mesmo modelo continua servindo enquanto a API não muda de versão.

## Desenvolvimento

O SDK fica no repositório do grafo, em `sdks/typescript`, e é um projeto do workspace: a API e o console o usam pelo código-fonte (`src/index.ts`), sem passar pelo registry. Os adaptadores, em repositório próprio, usam a versão publicada. Os arquivos de `src/generated/` saem do contrato (`pnpm run sdk:generate` em `api/`) e não são editados à mão; as receitas de chave ficam em `src/keys.ts`.

```sh
pnpm run lint
pnpm test
```

Mudou o SDK? Suba a versão no `package.json`. Quando um push no branch principal muda a versão, o workflow de CI a envia ao npm como staged (`scripts/publish.ts`): compila o `dist` e envia o pacote com ele, o README e a licença do repositório, pelo Trusted Publishing do npm (OIDC do GitHub Actions), sem token guardado no repositório. A versão só fica pública quando um mantenedor a aprova com 2FA, em npmjs.com ou com `npm stage approve`.
