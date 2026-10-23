# Roadmap — Panorama Graph

O que o grafo já faz e o que vem pela frente. Por que ele existe, e o que não deve virar, está no [PROPOSITO.md](api/PROPOSITO.md); o modelo, no [MODELO.md](api/MODELO.md); as regras de proveniência, no [PROVENIENCIA.md](api/PROVENIENCIA.md).

## O que já existe

- **Modelo fechado e versionado** (versão 12): arquitetura (domínios, sistemas, componentes, APIs, endpoints, tópicos, contratos, bancos e coleções, infraestrutura e ambientes, bibliotecas e tecnologias) e estrutura organizacional (níveis, grupos e pessoas), com a proveniência de cada fato.
- **API** com ingestão por retrato (com dry-run), apelidos e união de nós, aposentadoria de escopo, retrato por versão implantada e retenção; consultas pelo MCP e pelo REST (`/v1`), com contrato versionado e OpenAPI.
- **Autenticação:** login pelo SSO da organização (OIDC), tokens de serviço (token de ingestão e JWTs de emissores confiáveis, como o OIDC do CI) e o modo anônimo, para quem não liga o SSO.
- **Console** de leitura: visão geral e vizinhança, componentes, quem usa, organograma, fontes e cargas, divergências e nós referenciados.
- **SDK em TypeScript** (`@panorama-graph/sdk`): tipos e modelo gerados do contrato, receitas de chave e cliente.
- **Adaptadores:** `graph-publish` (a arquitetura do build), `graph-receiver` (recebe os pacotes do plugin Gradle), `graph-deployments` (o que roda em cada ambiente, lido do cluster) e `graph-seed` (carga à mão em YAML).
- **Plugin Gradle** e biblioteca de teste para Spring, que geram a descrição da arquitetura no build.
- **Exemplo de adaptador próprio** (`example-seed`) e a organização de exemplo ACME Bank.
- **Skills de agente:** a ingestão nativa, que conhece o modelo e carrega o que o agente descobre no código e nos acessos que tiver, e a carga manual dos artefatos de build pelo receptor.

## Próximos passos

| Item | O que é |
|---|---|
| SDKs em Java e Python | Em `sdks/java` e `sdks/python`, gerados do mesmo contrato e com as mesmas receitas de chave do SDK em TypeScript |
| Adaptadores de leitura central | `gitlab`, `directory`, `service-catalog`, `k8s-infra`, `k8s-routes` e `service-config`, e um importador do Backstage, cujo vocabulário o modelo já segue |
| Curadoria | Confirmação de fatos inferidos, união de nós e aposentadoria de escopo pelo console |
| Estrutura interna dos componentes | Módulos e pacotes (`Module`, `CONTAINS`), por análise estática ou SCIP |
| Releases | CHANGELOG, imagens publicadas e CI do produto (lint, testes contra o Neo4j de teste) |
| Operação | Backup e restauração dentro dos limites do Neo4j Community, métricas de cargas e consultas, e limites de uso |
| Autorização | Papéis pelos grupos do provedor (quem lê, quem escreve, quem cura) e token por adaptador, que só escreve com a própria `source` e nos próprios escopos. A autenticação já existe: SSO por OIDC, tokens de serviço e o modo anônimo |
| Token nos adaptadores | O `graph-receiver` e os CLIs dos adaptadores mandando o token (`INGEST_TOKEN` ou o OIDC do CI) em `Authorization: Bearer` |
| MCP com login da pessoa | O fluxo de autorização do MCP (OAuth), para um cliente como o Claude Code entrar pelo SSO em vez de usar um token de serviço |
| Consultas separadas do banco | O Cypher das consultas dividido por ferramenta, o que também deixa uma troca de banco possível |

## Perguntas em aberto

1. **Autorização:** que papéis existem e de quais grupos do provedor cada um vem; e se a regra "cada adaptador só escreve a própria `source`" vale também para o OIDC do CI (o projeto do token como a fonte).
