# agent-skills — Guia para agentes

Este arquivo diz **como trabalhar** no projeto. **O que cada skill faz** está no [README.md](README.md).

## Regras

- **A skill segue o produto, e não o contrário.** O formato dos arquivos é o dos schemas em `../adapters/schemas/` (ligados em cada skill por link simbólico, nunca copiados) e as regras de tradução são as do `graph-publish`. Mudou um formato, um tradutor, uma receita de chave ou a versão do plugin? Atualize as referências da skill, os exemplos e o init script na mesma entrega.
- **Mesmas fontes e escopos dos adaptadores reais.** A carga gerada pela skill nunca usa fonte `manual`, `seed` ou `agente`: ela precisa ser substituída, sem limpeza, pelo primeiro envio do adaptador do mesmo assunto.
- **Repositórios só de leitura.** Nenhuma instrução manda escrever, commitar ou instalar algo no projeto explorado. A exceção é o `build/` do Gradle, ignorado pelo git, pelo init script.
- **Exemplos neutros.** Nada da organização de exemplo (ACME Bank) nas skills: os exemplos usam `example.com` e uma loja fictícia.
- **O que não se descobre vira lacuna.** Instrução nova de descoberta diz onde procurar, o que extrair e o que fazer quando não resolve. Nunca diga ao agente para deduzir ou completar.

## Estrutura de uma skill

| Caminho | Papel |
|---|---|
| `SKILL.md` | Frontmatter (`name` igual à pasta, `description` do que faz e de quando usar) e o roteiro: regras, entradas, saída e fases |
| `referencias/` | O que o agente lê quando precisa: onde procurar cada fato (`descoberta.md`), os formatos (`formatos.md`), a organização e as chaves (`organizacao.md`) |
| `schemas` | Link para `../../../adapters/schemas` |
| `modelos/` | Arquivos que o agente usa como estão (o init script do Gradle) |
| `scripts/` | O que o agente roda (`importar.sh`) |
| `exemplos/` | Uma carga completa, neutra, que passa no dry-run |

## Testes

- `./install.sh --project <pasta temporária> --claude --agents`: a cópia tem `SKILL.md`, as referências e os schemas como arquivos (não como links).
- `importar.sh --dry-run` sobre `exemplos/carga-grafo` contra uma instância no ar (`docker compose up -d` na raiz do panorama-graph): sai `0`, sem aviso.
- O init script num projeto Gradle sem o plugin, com e sem `-x test`, e o build do projeto sem nenhuma mudança fora de `build/`.
- Mudança nas instruções de descoberta: rode a skill num serviço que já publica pelo plugin, forçando a leitura do código, e compare com o `build/architecture` do plugin (o gabarito): o que acertou, o que perdeu e o que inventou.
