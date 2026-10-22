---
name: panorama-graph-carga-manual
description: Alimenta o panorama-graph com a arquitetura real de repositórios que ainda não usam os adaptadores (plugin Gradle, graph-publish no CI), sem modificar os projetos. Explora cada repositório, descobre identidade, stack, bibliotecas, endpoints, eventos, clientes HTTP, dados, dono e infraestrutura, gera os arquivos de importação (o pacote build/architecture de cada componente e o YAML do graph-seed para a organização), valida por dry-run e importa com confirmação. Use quando alguém quer ver o grafo funcionando com os próprios projetos antes de adotar os adaptadores.
---

# Carga manual do panorama-graph

Gera, a partir da leitura dos repositórios, os mesmos arquivos que os adaptadores do grafo produzem, e os importa pelos mesmos caminhos (o `graph-receiver` e o `graph-seed`). Serve para experimentar o grafo com dados reais. Quando a organização adotar o plugin ou o CI, o primeiro envio real substitui esta carga, porque os dois usam a mesma fonte e o mesmo escopo.

Não use se o repositório já publica no grafo (plugin aplicado, job `publish_architecture` no pipeline): a carga manual brigaria com a real.

## Regras

1. **Os repositórios são só de leitura.** Nada é escrito, commitado ou instalado neles. A única exceção é o `build/` do Gradle, pelo init script (degraus 2 e 3 abaixo), e só se `build/` estiver ignorado pelo git (`git check-ignore -q build`). Se não estiver, pule esses degraus.
2. **Nada sem evidência.** Cada fato aponta o ponto do código ou do arquivo de onde saiu (`caminho#L42`, `caminho#metodo`). Sem evidência, o fato fica de fora e vai para o `LACUNAS.md`.
3. **Nada inventado.** Não deduza dono pelo nome do repositório, schema por intuição nem tópico por convenção. Placeholder sem valor (`${...}`), caminho montado em execução e tipo genérico sem resolução são lacunas, com o nome da propriedade ou o trecho.
4. **As fontes dos adaptadores reais.** Use a fonte e o escopo que o adaptador daquele assunto usaria (`build-manifest`, `openapi`, `service-catalog`, `directory`...), nunca `manual`, `seed` ou `agente`. As tabelas estão em [referencias/formatos.md](referencias/formatos.md) e [referencias/organizacao.md](referencias/organizacao.md).
5. **As chaves do grafo.** Siga as receitas de chave ([referencias/organizacao.md](referencias/organizacao.md#receitas-de-chave)). Com o grafo no ar, consulte antes se o componente, o serviço, o time ou o banco já existem, e reaproveite a chave (veja a fase 4).
6. **Sem segredos.** A URL do repositório vai sem credencial (`https://user:token@` vira `https://`). Senhas, tokens e strings de conexão completas nunca entram nos arquivos: do banco, só o servidor e o nome.
7. **Nada é enviado sem confirmação.** Mostre o resultado do dry-run e as lacunas, e só importe quando a pessoa disser que pode.

## Entradas

Pergunte só o que não estiver claro:

- os repositórios (caminhos locais) e, se for mais de um, se são do mesmo domínio;
- onde gravar a carga (padrão: `./carga-grafo`, fora dos repositórios);
- a URL do receptor (padrão `http://localhost:3210`) e da API (padrão `http://localhost:3200`).

## Saída

```
carga-grafo/
  componentes/<nome>/       # um pacote por componente, no formato de build/architecture
    manifest.json           # sempre
    application.json        # nome de serviço
    bom.json                # bibliotecas (CycloneDX), quando houver como gerar
    openapi.json            # API HTTP oferecida
    asyncapi.json           # eventos publicados e consumidos
    http-clients.json       # quem o componente chama
    data-access.json        # coleções e tabelas
    pacts/*.json            # contratos que o repositório já tem
    opcoes.json             # opções do envio (kind, service...), fora do pacote
    DESCOBERTA.md           # cada fato com a evidência e o degrau de onde veio
  organizacao/*.yaml        # catálogo, diretório, infraestrutura e configuração, para o graph-seed
  LACUNAS.md                # o que precisa de uma pessoa para confirmar
```

Um arquivo só existe se houver de onde tirá-lo. Arquivo vazio diz ao grafo que o componente não tem aquilo; ausente diz que esta fonte não sabe. Exemplos completos em [exemplos/carga-grafo/](exemplos/carga-grafo/).

## Fases

### 1. Descobrir a identidade

Para cada repositório: caminho e host (`git remote get-url origin`), commit (`git rev-parse HEAD`), se há mudanças não commitadas (`git status --porcelain`: a evidência é do commit, então avise), nome do artefato e versão, e o nome de serviço. O roteiro está em [referencias/descoberta.md](referencias/descoberta.md#identidade).

Descubra também se as APIs, as operações e os tópicos são versionados. Sempre que identificar uma versão, em qualquer padrão, informe-a na carga: o grafo guarda um nó por versão, e é ela que decide em que nó cada consumidor cai. Como declarar está em [referencias/descoberta.md](referencias/descoberta.md#versões-de-apis-e-tópicos).

### 2. Gerar o pacote de cada componente

Decida **arquivo a arquivo**, do degrau mais fiel para o menos fiel:

| Degrau | Quando | Como | O que rende |
|---|---|---|---|
| 1 | O repositório já tem o documento (contract-first: `openapi.yaml`, `asyncapi.yaml`, pacts) | Converta para JSON e copie. Não edite o conteúdo | O que o documento tem |
| 2 | Projeto Gradle | Init script, com testes: `./gradlew --init-script <skill>/modelos/panorama-graph.init.gradle test architectureArtifacts` | Tudo o que o plugin gera |
| 3 | Gradle e o degrau 2 falhou (testes quebram, precisam de banco ou de Kafka) | O mesmo, com `-x test` | `manifest.json`, `bom.json`, `dependency-usage/`, `data-access.json` |
| 4 | O que os degraus anteriores não geraram, ou o projeto não é Gradle | Leia o código, seguindo [referencias/descoberta.md](referencias/descoberta.md), e escreva no formato de [referencias/formatos.md](referencias/formatos.md) | `openapi.json`, `asyncapi.json`, `http-clients.json`, `application.json`, `manifest.json`, `data-access.json` |

- O init script lê o repositório Maven de `PANORAMA_GRAPH_MAVEN_URL` (onde o plugin está publicado). O fim do build diz o que gerou e, do que não gerou, o motivo: é por ele que você sabe o que falta para o degrau 4. Copie `build/architecture/` para `carga-grafo/componentes/<nome>/`.
- Falha do Gradle que não é do plugin (versão do Java incompatível com o wrapper, dependência privada inacessível) não é motivo para mexer no projeto: tente com outro `JAVA_HOME` e, se não der, vá para o degrau 4.
- No degrau 4, todo endpoint, canal e a API levam `x-panorama-graph-source`, e todo cliente HTTP leva `source`. É o que faz a evidência no grafo apontar para o código.
- Bibliotecas fora do Gradle: gere o `bom.json` com a ferramenta CycloneDX da stack **só se a pessoa permitir** rodar ferramentas, sempre com a saída fora do repositório. Sem isso, deixe sem `bom.json` e registre a lacuna.

### 3. Gerar a organização

Catálogo (domínio, sistema, dono), diretório (times e pessoas), infraestrutura (servidores, brokers, bancos por ambiente) e configuração (que banco e que broker cada componente usa), no YAML do `graph-seed`. O que procurar e o formato estão em [referencias/organizacao.md](referencias/organizacao.md). Dono e domínio raramente estão no código: o que não tiver evidência vai para o `LACUNAS.md` como pergunta, com o que você encontrou de pista.

### 4. Reaproveitar o que o grafo já tem

Se o grafo estiver no ar (o MCP `panorama-graph`, ou `POST <api>/v1/queries/<ferramenta>`), antes de fechar as chaves:

- `nodes_find` (`{ "text": "<nome>" }`) para cada componente, serviço, time e banco: se já existir com outra chave, use a existente;
- `api_consumers` (`{ "target": "api:<serviço>/http" }`, ou `api:<serviço>/<versão>/http` numa API versionada): se algum consumidor chama `api:<nome>/http` com outro nome, o nome de serviço está errado de um dos lados. Registre no `LACUNAS.md`, não renomeie o consumidor;
- `nodes_find` (`{ "text": "<serviço>", "types": ["Api", "Topic"] }`): as versões que o grafo já conhece. Se os consumidores chamam uma versão que o provedor que você leu não tem, procure de novo a versão no provedor (no código e na implantação) e, se não achar, registre no `LACUNAS.md`;
- `sources_status`: que fontes e escopos já existem. Se o componente já tem retrato de `build-manifest`, ele já publica pelo CI: pare e avise.

### 5. Validar

```sh
<skill>/scripts/importar.sh --dry-run carga-grafo
```

Monta os retratos no receptor e no `graph-seed` sem gravar, e mostra o resumo e os avisos. Antes, confira cada arquivo dos formatos do produto contra o schema em [schemas/](schemas/). Trate como erro, e corrija ou leve para as lacunas:

- `invalid_build` ou `invalid_snapshot` (formato, propriedade ou valor fora do modelo);
- "canal sem endereço resolvido" (placeholder na AsyncAPI);
- `x-panorama-graph-source inválido`;
- componente com uma chave diferente da que o grafo já tem.

### 6. Importar, com confirmação

Mostre à pessoa: o resumo do dry-run por componente, o `LACUNAS.md` e, de cada componente, o que veio de cada degrau. Só com a confirmação:

```sh
<skill>/scripts/importar.sh carga-grafo
```

Rode de novo: a segunda importação deve vir só com `unchanged`. Depois, abra a ficha de um componente no console (ou `component_get`) e confira dono, sistema, API, consumidores e bancos, cada um com a fonte.

## Relatório final

Diga o que foi importado (componentes, endpoints, tópicos, clientes, bancos, e as versões de cada API e tópico versionado), de que degrau veio cada pacote, as lacunas que ficaram e o que a pessoa precisa decidir. Lembre que a carga é um retrato do commit lido: ela não acompanha o código. Para isso, o caminho é adotar os adaptadores (o guia de adoção do panorama-graph-adapters).
