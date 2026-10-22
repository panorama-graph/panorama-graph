# panorama-graph — Guia para agentes

Este arquivo diz **como trabalhar** no repositório. **Por que o grafo existe, e o que ele não deve virar,** está no [PROPOSITO.md](api/PROPOSITO.md); o modelo, no [MODELO.md](api/MODELO.md); as regras de proveniência, no [PROVENIENCIA.md](api/PROVENIENCIA.md); como alimentar o grafo sem o SDK, no [ADAPTADOR.md](api/ADAPTADOR.md); o que vem pela frente, no [ROADMAP.md](ROADMAP.md). Cada projeto tem o próprio `AGENTS.md`, com as regras dele.

## Regras

- **Este repositório é o produto.** A API, o console e o SDK. O que alimenta o grafo (adaptadores, plugin Gradle, skills) fica em repositórios próprios, na tabela abaixo, e depende só do que este publica: o SDK e o contrato da API. Nada aqui importa código de lá.
- **Um repositório, um workspace.** `api`, `web` e `sdks/typescript` são projetos do workspace do Bun (`package.json` da raiz, um `bun.lock` só, dependências içadas para a raiz pelo `bunfig.toml`). `bun install` roda na raiz. Dependência nova entra no `package.json` do projeto que a usa.
- **Uma mudança, um commit.** Mudança no modelo ou no contrato da API chega ao SDK (`bun run sdk:generate` em `api/`), ao console, ao [MODELO.md](api/MODELO.md) e ao [ADAPTADOR.md](api/ADAPTADOR.md) na mesma entrega. Receita de chave nova ou mudada entra também nos casos compartilhados, [sdks/key-recipes.json](sdks/key-recipes.json). `bun run lint` e `bun run test` na raiz (ou em cada projeto que a mudança toca) precisam passar antes de entregar.
- **O SDK é o artefato público.** Aqui, `api` e `web` usam o SDK pelo workspace (`workspace:*`), lendo o código-fonte. O SDK muda de versão (`sdks/typescript/package.json`) quando muda, e o job `publish-sdk` o publica no branch padrão. Os adaptadores usam a versão publicada: mudou o SDK ou o modelo, publique a versão nova e ajuste o [adapters](https://github.com/panorama-graph/adapters) em seguida. Um SDK em outra linguagem entra como `sdks/<linguagem>`, gerado do mesmo contrato (o OpenAPI de `/v1` e o modelo de `GET /v1/schema`) e com as mesmas receitas de chave, conferidas contra [sdks/key-recipes.json](sdks/key-recipes.json).
- **Imagens da raiz.** Todo `Dockerfile` é construído com o contexto na raiz (`docker build -f <projeto>/Dockerfile .`), com o `.dockerignore` da raiz: o workspace resolve as dependências e o SDK vem do código. Mudou o que a instância sobe? Atualize o [docker-compose.yml](docker-compose.yml) e os [primeiros passos](PRIMEIROS-PASSOS.md) na mesma entrega.
- **Roadmap em dia.** Ao concluir um item do [ROADMAP.md](ROADMAP.md) ou mudar o rumo dele, atualize-o na mesma entrega. O roadmap é um só, para o produto e os repositórios que o alimentam.

## Projetos

| Projeto | Guia |
|---|---|
| `api` | [api/AGENTS.md](api/AGENTS.md) |
| `web` | [web/AGENTS.md](web/AGENTS.md) |
| `sdks/typescript` | [sdks/typescript/README.md](sdks/typescript/README.md) |

## Repositórios que alimentam o grafo

| Repositório | O que tem |
|---|---|
| [adapters](https://github.com/panorama-graph/adapters) | `graph-publish`, `graph-deployments`, `graph-seed`, `graph-receiver`, os formatos dos artefatos de build (`schemas/`), a organização de exemplo e o `example-seed` |
| [gradle-plugin](https://github.com/panorama-graph/gradle-plugin) | Plugin Gradle `panorama-graph` e a biblioteca de teste para Spring |
| [skills](https://github.com/panorama-graph/skills) | Skills para agentes de IA (`panorama-graph-carga-manual`) |
