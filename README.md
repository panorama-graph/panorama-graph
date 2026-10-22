<p align="center"><img src="assets/logo.svg" alt="Panorama Graph" width="360"></p>

# Panorama Graph

Uma visão da estrutura organizacional e da arquitetura, num grafo: quem chama quem, quem é dono, stack, bancos, eventos, rotas e o que roda em cada ambiente, com a fonte de cada fato. Consulta pelo MCP, pelo REST e por um console.

Tudo fica neste repositório, um workspace do Bun: uma mudança no modelo chega à API, ao SDK, aos adaptadores e ao console no mesmo commit.

| Pasta | O que é |
|---|---|
| [api](api/README.md) | Base e API: modelo, registro com proveniência, consultas (MCP e REST) e o contrato de onde os SDKs são gerados |
| [web](web/README.md) | Console: consultar o grafo e conferir as fontes |
| [sdks/typescript](sdks/typescript/README.md) | SDK em TypeScript (`@panorama-graph/sdk`): tipos e modelo gerados do contrato, receitas de chave e cliente do REST. É o artefato publicado para quem escreve o adaptador da própria organização |
| [adapters](adapters/README.md) | Os adaptadores do produto: `graph-publish` (a arquitetura do build, no CI de cada componente), `graph-deployments` (o que roda em cada ambiente, lido do cluster), `graph-seed` (retratos em YAML, para a carga à mão) e `graph-receiver` (recebe os pacotes de build do plugin Gradle). Tem os formatos dos artefatos (`schemas/`) e o resto da carga de exemplo (`seeds/acme/`) |
| [gradle-plugin](gradle-plugin/README.md) | Plugin Gradle `panorama-graph` e a biblioteca de teste para Spring: geram em `build/architecture` o que o build sabe do componente e o enviam ao receptor. Build Gradle próprio, fora do workspace |
| [example-seed](example-seed/README.md) | Exemplo de adaptador próprio de uma organização: traduz o export do diretório (níveis, grupos e pessoas) e o inventário da infraestrutura e os publica pelo SDK. Carrega a organização de exemplo e é o ponto de partida para o adaptador da sua |
| [agent-skills](agent-skills/README.md) | Skills para agentes de IA. A `panorama-graph-carga-manual` alimenta o grafo com a arquitetura real de repositórios que ainda não usam os adaptadores, sem modificar os projetos |

- [PRIMEIROS-PASSOS.md](PRIMEIROS-PASSOS.md): subir, carregar o exemplo e consultar, e a primeira carga da sua organização.
- [MODELO.md](api/MODELO.md): nós e relações, o que é fixo e o que é livre, e o que fazer quando algo não cabe.
- [ROADMAP.md](ROADMAP.md): o que já existe e o que vem pela frente.
- [PROVENIENCIA.md](api/PROVENIENCIA.md): as regras de proveniência e ciclo de vida dos fatos.
- [PROPOSITO.md](api/PROPOSITO.md): por que existe e o que não é.
- [ADOCAO.md](ADOCAO.md): levar os adaptadores a uma organização (convenções, ordem de implantação, pipeline, cluster e conferência).
- [AGENTS.md](AGENTS.md): como trabalhar no repositório.

## Subir

```sh
cp .env.example .env
docker compose --profile exemplo up -d --build    # sem --profile exemplo, a instância vazia
```

| Serviço | Endereço |
|---|---|
| Console | <http://localhost:5180> |
| API (REST em `/v1`, MCP em `/mcp`) | <http://localhost:3200> |
| Receptor dos builds (`graph-receiver`, para onde o plugin Gradle envia) | <http://localhost:3210> |
| Neo4j Browser | <http://localhost:7474> (usuário `neo4j`, senha do `.env`) |

## Licença

[Sustainable Use License 1.0](LICENSE), que vale para todo o repositório, inclusive o SDK publicado. Empresas podem usar e modificar o grafo para os próprios fins internos, e qualquer pessoa pode usá-lo para fins pessoais ou não comerciais. Vender o grafo, ou oferecê-lo a terceiros como produto ou serviço pago, não é permitido. A redistribuição só pode ser gratuita e para fins não comerciais, sempre com a licença junto.

## Desenvolver

```sh
bun install          # na raiz: instala todos os projetos do workspace, com o SDK ligado ao código
bun run lint         # tsc em todos os projetos
bun run test         # testes de todos os projetos (a API precisa do Neo4j de teste: bun run test:db:up em api/)
```

Cada projeto também roda sozinho na própria pasta (`bun run lint`, `bun test`, `bun run dev`). O `gradle-plugin` usa o próprio wrapper (`./gradlew build`).
