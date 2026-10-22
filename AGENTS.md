# panorama-graph — Guia para agentes

Este arquivo diz **como trabalhar** no repositório. **Por que o grafo existe, e o que ele não deve virar,** está no [PROPOSITO.md](api/PROPOSITO.md); o modelo, no [MODELO.md](api/MODELO.md); as regras de proveniência, no [PROVENIENCIA.md](api/PROVENIENCIA.md); o que vem pela frente, no [ROADMAP.md](ROADMAP.md). Cada projeto tem o próprio `AGENTS.md`, com as regras dele.

## Regras

- **Um repositório, um workspace.** `api`, `web`, `adapters`, `example-seed` e `sdks/typescript` são projetos do workspace do Bun (`package.json` da raiz, um `bun.lock` só, dependências içadas para a raiz pelo `bunfig.toml`). `bun install` roda na raiz. Dependência nova entra no `package.json` do projeto que a usa.
- **Uma mudança, um commit.** Mudança no modelo ou no contrato da API chega ao SDK (`bun run sdk:generate` em `api/`), aos adaptadores, ao console e ao [MODELO.md](api/MODELO.md) na mesma entrega. `bun run lint` e `bun run test` na raiz (ou em cada projeto que a mudança toca) precisam passar antes de entregar.
- **O SDK é o artefato público.** Dentro do repositório, ninguém depende da versão publicada: `api`, `web` e `adapters` usam o SDK pelo workspace (`workspace:*`), lendo o código-fonte. O SDK muda de versão (`sdks/typescript/package.json`) quando muda, e o job `publish_sdk` o publica no branch padrão. Um SDK em outra linguagem entra como `sdks/<linguagem>`, gerado do mesmo contrato (o OpenAPI de `/v1` e o modelo de `GET /v1/schema`) e com as mesmas receitas de chave.
- **Exemplos copiáveis.** Um `example-*` depende só do que é publicado, para que uma organização o copie como está: o SDK pela versão (e não `workspace:*`; o workspace o liga ao código enquanto as versões batem), e nada de importar de `adapters/`. Ao subir a versão do SDK, suba a dele. O que ele tem da organização de exemplo (ACME Bank) fica nos dados (`data/`), nunca no código.
- **Linguagem livre nos adaptadores.** Um projeto novo usa a linguagem da fonte que lê. Fora do TypeScript, ele fica fora do workspace, com o próprio build (o `gradle-plugin` é Java, com o próprio wrapper do Gradle), e entra com uma linha na tabela do [README](README.md).
- **Imagens da raiz.** Todo `Dockerfile` é construído com o contexto na raiz (`docker build -f <projeto>/Dockerfile .`), com o `.dockerignore` da raiz: o workspace resolve as dependências e o SDK vem do código. Mudou o que a instância sobe? Atualize o [docker-compose.yml](docker-compose.yml) e os [primeiros passos](PRIMEIROS-PASSOS.md) na mesma entrega.
- **Roadmap em dia.** Ao concluir um item do [ROADMAP.md](ROADMAP.md) ou mudar o rumo dele, atualize-o na mesma entrega.

## Projetos

| Projeto | Guia |
|---|---|
| `api` | [api/AGENTS.md](api/AGENTS.md) |
| `web` | [web/AGENTS.md](web/AGENTS.md) |
| `sdks/typescript` | [sdks/typescript/README.md](sdks/typescript/README.md) |
| `adapters` | [adapters/AGENTS.md](adapters/AGENTS.md) |
| `gradle-plugin` | [gradle-plugin/AGENTS.md](gradle-plugin/AGENTS.md) |
| `example-seed` | [example-seed/AGENTS.md](example-seed/AGENTS.md) |
| `agent-skills` | [agent-skills/AGENTS.md](agent-skills/AGENTS.md) |
