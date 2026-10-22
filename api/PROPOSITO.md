# Propósito e inspirações — panorama-graph-api

> Escrito em 29/09/2026. É o documento de foco: diz **por que** o componente existe e **o que ele não deve virar**. O que será feito, e em que ordem, está no [ROADMAP.md](../ROADMAP.md). Leia este documento antes de propor funcionalidade nova; se uma proposta contradiz o que está aqui, revise o propósito com uma pessoa antes de implementar.

## Por que existe

Agentes de IA planejam e constroem software numa organização sem saber o que já existe nela. Sem esse contexto, tratam cada iniciativa como se começasse do zero: assumem GitHub e hospedagem estática numa empresa que usa GitLab e Kubernetes, e deixam em branco o dono e o time. A wiki responde **como se deve fazer**. Falta quem responda **o que existe, quem é dono e como as partes se ligam**.

O `panorama-graph-api` é essa resposta: um grafo da arquitetura e da estrutura organizacional, **consultado por agentes e por pessoas**, em que **cada fato diz de onde veio**. É assim que um agente pode citar, e não supor.

## As perguntas que ele existe para responder

Se uma funcionalidade não ajuda a responder melhor uma pergunta deste tipo, ela provavelmente não pertence aqui.

- Quem chama a API xyz? De quais endpoints o frontend abc depende?
- Quem publica e quem consome o evento X, e qual é o contrato?
- Quem é dono deste componente, em que domínio e sistema ele está?
- Qual é a stack dele? Quais componentes usam a biblioteca Y abaixo da versão Z?
- Que banco ele usa, em que motor, e quem mais acessa esse banco?
- Por onde passa uma requisição para este endereço?
- Quais componentes cuidam de simulação de crédito?

E, para cada resposta: **quem afirmou, com que evidência, quando, e com que confiança**.

## O que nos diferencia

Existem muitas ferramentas que cobrem parte disto (ver [Inspirações](#inspirações)). O motivo de construir é a combinação abaixo, que nenhuma delas oferece. São os pilares: uma mudança que enfraquece um deles precisa de uma justificativa forte.

| Pilar | O que significa | Por que importa |
|---|---|---|
| **Proveniência por fato** | Todo nó e relação tem fonte, evidência, estado e data. Fato sem proveniência é recusado. | O consumidor principal é um agente que precisa citar. Sem proveniência, o grafo é uma opinião. |
| **Várias fontes, divergência visível** | Cada fonte faz a sua afirmação; uma não sobrescreve a outra. Atributo que pode divergir vira relação. | Na organização real, o Pact, o Helm, o catálogo e o APM discordam. A discordância é informação. |
| **Observado, inferido, confirmado** | O determinístico é `observed`; o agêntico só grava `inferred`; só uma pessoa confirma. | A carga agêntica é valiosa, mas não pode virar verdade sozinha (humano no controle). |
| **Lógico separado do físico** | `CONSUMES` é a dependência; `ROUTES` e `REACHES_VIA` são o caminho da rede. | Um gateway no meio não pode esconder quem realmente depende de quem. |
| **Retrato atual que se corrige sozinho** | Carga por retrato de fonte e escopo; o que some vira `stale`. | Grafo que só cresce apodrece, e passa a mentir com confiança. |
| **Feito para agentes** | Consulta por MCP, respostas pequenas e com a proveniência, `graph_query` só de leitura. | Os portais existentes foram feitos para pessoas numa tela. |
| **Base e API, sem carga** | Os adaptadores são outros componentes, cada um na linguagem da sua fonte. | Mantém o núcleo pequeno e confiável, e deixa qualquer fonte entrar sem mexer nele. |

## O que não somos

Cada linha é uma tentação real. Se o desenvolvimento começar a ir nessa direção, pare e reavalie.

| Não somos | Quem já faz | Nossa relação com ele |
|---|---|---|
| Um portal de desenvolvedor (templates de projeto, scorecards, documentação, cadastro à mão) | Backstage, Port, Cortex, OpsLevel, Compass | Fonte possível. Pegamos o vocabulário do Backstage. Temos uma tela, o console ([panorama-graph-web](../web/README.md)), mas ela só mostra o que as consultas devolvem, com a proveniência, para as pessoas verem o grafo e confiarem nele. |
| Busca ou inteligência de código | Sourcegraph, CodeGraph, SCIP | Código fica fora; entram ponteiros `repo@sha:caminho:linha`. O SCIP pode ser fonte para módulos. |
| APM ou mapa de serviços em execução | Dynatrace Smartscape, Datadog, Grafana, Kiali | Fonte possível para `CALLS` observado em execução. |
| CMDB ou ferramenta de arquitetura corporativa | ServiceNow, LeanIX, Ardoq | Fonte possível para capacidades e donos. Não modelamos processo de negócio. |
| Catálogo de dados ou linhagem | DataHub, OpenMetadata, Marquez | O grafo vai até a estrutura dos dados e quem a usa; nunca os dados, nem linhagem de pipeline. |
| Um carregador | — | As cargas são adaptadores à parte. |
| Histórico da arquitetura | — | Retrato atual, com a última data vista. Histórico, se um dia for preciso, é decisão nova. |
| Parte de outro produto | — | Produto à parte. Assistentes, agentes e portais que o consultam são consumidores como outros quaisquer. |

## Inspirações

O que pegamos de cada uma, e o que deixamos de propósito.

| Ferramenta | O que é | O que pegamos | O que deixamos |
|---|---|---|---|
| [Backstage](https://backstage.io/docs/features/software-catalog/system-model) | Catálogo de software open source (CNCF) | O vocabulário: Domain, System, Component, API, Resource, Group, e as relações de prover e consumir API. Facilita a vinda de quem já tem um catálogo. | Relações declaradas à mão num arquivo por repositório, sem proveniência por relação e sem consulta de caminhos. |
| [Cartography](https://github.com/cartography-cncf/cartography) | Grafo de infraestrutura em Neo4j, da Lyft | O padrão mais próximo do nosso: Neo4j mais módulos de carga independentes, cada carga marcando o que viu e limpando o que sumiu. É a origem da nossa carga por retrato. | Foco em nuvem e segurança; a proveniência dele é por carga, não por afirmação. |
| [DataHub](https://datahubproject.io/) | Catálogo de dados com metadados em grafo | Metadados de sistema por afirmação e várias fontes sobre a mesma entidade: a ideia de proveniência por fato. O modelo dos dados (estrutura de tabela, dono e quem acessa). | Centrado em dados, não em serviços. Linhagem de pipeline fica fora. |
| Port | Catálogo com modelo configurável, integrações e servidor MCP | Consulta por agentes via MCP como caminho principal, e não como extra. | Modelo livre demais (cada organização inventa os tipos); relação com um valor só, sem fontes paralelas. É SaaS. |
| Dynatrace Smartscape, Datadog Service Map | Topologia descoberta em execução | Dependência observada em execução como uma fonte entre outras. | Só vê o que tem tráfego: não sabe de contrato, dono nem biblioteca. |
| Kiali (Istio) | Grafo da malha de serviços | O caso que motivou separar lógico de físico: o que a rede mostra não é, sozinho, a dependência. | Rota física como única verdade. |
| Ardoq | Arquitetura corporativa em grafo com metamodelo | Grafo com metamodelo validado, em vez de tabelas. | Manutenção à mão e foco em processo de negócio. |
| [Structurizr](https://structurizr.com/) / modelo C4 | Arquitetura como código | Níveis de abstração claros (sistema, contêiner, componente); o grafo vai até módulo, como o C4 vai até componente. | Documentação desenhada, não descoberta. |
| Sourcegraph, [SCIP](https://github.com/sourcegraph/scip) | Inteligência de código | Artefatos neutros gerados no CI como entrada preferida dos adaptadores (SCIP, e pelo mesmo motivo SBOM CycloneDX, OpenAPI, Pact). | O nível de símbolo. |
| CAST Imaging, vFunction | Arquitetura extraída do código | A prova de que dá para ligar componente, código e tabela a partir do código. | Grafo de símbolos, custo e caixa-preta. |

## Ferramentas de mercado como fontes

Numa organização cliente, as ferramentas acima não competem com o grafo: **são adaptadores**. Cada uma grava com a própria `source`, como `observed`, e onde discordarem, a divergência aparece. É isto que o grafo oferece a quem já tem várias delas: uma visão única, com a origem de cada fato, sem precisar escolher uma ferramenta vencedora.

Candidatos naturais, quando houver cliente: `backstage` (o catálogo, mapeado quase direto pelo vocabulário), `datadog` ou `dynatrace` (chamadas observadas), `leanix` ou `servicenow` (donos e capacidades), `datahub` (estrutura dos bancos).

## Teste de foco

Antes de implementar algo novo, responda. Um "não" pede para reformular ou abandonar a proposta.

1. Ajuda a responder uma das [perguntas](#as-perguntas-que-ele-existe-para-responder), ou uma do mesmo tipo?
2. Todo fato novo tem fonte, evidência, estado e data?
3. Uma fonte continua sem conseguir apagar ou sobrescrever a afirmação de outra?
4. Um fato inferido continua sem conseguir se passar por observado ou confirmado?
5. A lógica de carga ficou fora da API (num adaptador)?
6. O código ficou fora do grafo, só como ponteiro?
7. Continua sem depender de um consumidor específico nem da organização de exemplo?
8. Um agente consegue usar isso pelo MCP, com uma resposta pequena e citável?

## Sinais de desvio

- A API começa a ler GitLab, Pact ou Kubernetes diretamente.
- Um atributo que duas fontes podem afirmar (versão, stack, dono) gravado como propriedade do nó, onde a última carga vence. Propriedade de nó é só para identidade e para o que tem fonte única.
- O console vira portal: template de projeto, nota de maturidade, cadastro à mão, ou uma consulta que só existe na tela.
- Uma tela que colapsa as fontes ou esconde a divergência e o estado (`inferred`, `stale`) para ficar mais limpa.
- Nós de classe, método ou coluna.
- Um tipo de nó ou relação criado por um adaptador, sem mudança versionada do modelo.
- Uma resposta de consulta sem a proveniência, "para ficar mais leve".
