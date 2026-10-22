# Proveniência e ciclo de vida dos fatos

É o que separa o grafo de um cadastro: cada fato diz de onde veio, quando foi visto e quem o afirma. Sem estas regras, cada adaptador reinventaria a sua versão e o grafo apodreceria. Elas são contrato: a API as aplica, e nenhum adaptador ou consumidor pode contorná-las.

1. **Proveniência obrigatória.** Todo fato gravado leva:
   - `source`: o adaptador que o afirmou (ex.: `pact-broker`, `gitlab`, `agente-inferencia`);
   - `evidence`: onde foi visto (`repo@sha:caminho:linha`, URL do contrato Pact, rota do Ingress);
   - `state`: `observed` (fonte determinística), `inferred` (adaptador agêntico) ou `confirmed` (uma pessoa confirmou);
   - `observedAt` e o identificador da carga.

   Fato sem proveniência é recusado.
2. **Uma afirmação por fonte.** A mesma relação afirmada por duas fontes são duas afirmações (relações paralelas com `source` diferente). A relação existe enquanto houver ao menos uma afirmação vigente. As consultas agregam.
3. **Carga por retrato.** O adaptador declara o escopo (ex.: fonte `pact-broker`, participante `loan-simulation-api`) e envia tudo o que viu nele. A API compara com o retrato anterior da mesma fonte e escopo e marca como `stale` o que sumiu. Sem isso, dependência removida nunca sai do grafo. Fato `stale` continua consultável, com a data em que foi visto pela última vez. O nó segue as afirmações: fica `stale` quando nenhuma fonte o afirma e nenhuma relação current chega nele.
4. **Identidade e apelidos.** A API define o formato das chaves ([MODELO.md](MODELO.md#receitas-de-chave)). Um nó aceita apelidos: o `product-catalog-api` continua como `product-catalog` no Pact Broker antigo e no nome do banco, e os dois precisam cair no mesmo componente. Unir dois nós que se descobrem iguais é uma operação explícita e auditada.
5. **Conflitos visíveis.** Quando fontes discordam, a consulta devolve as afirmações com a fonte de cada uma. Um fato `inferred` nunca derruba um `observed`.
6. **Confirmação é humana.** Só uma pessoa passa um fato para `confirmed`. Um fato `inferred` é contexto e não deve sustentar uma afirmação de obrigação.
7. **Permissão por adaptador.** Cada adaptador escreve só com a sua `source`. O adaptador agêntico só grava `inferred`. A exceção é a aposentadoria de um escopo que deixou de existir: ela encerra as afirmações de todas as fontes do escopo, sem criar nenhuma, e registra quem aposentou e por quê.
8. **Modelo validado.** A API conhece os tipos de nó e de relação e quais pares cada relação liga, e recusa o que estiver fora. Tipo novo é mudança versionada do modelo ([MODELO.md](MODELO.md#quando-algo-não-cabe-no-modelo)), não algo que um adaptador inventa.
