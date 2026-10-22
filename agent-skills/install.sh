#!/usr/bin/env bash
# Instala as skills do panorama-graph para agentes de IA.
#
# Uso: ./install.sh [opções] [skill ...]
#   Sem nomes de skill, instala todas as que estão em skills/.
#   Sem --claude nem --agents, pergunta para quais formatos instalar.
#
# Formatos:
#   claude    ~/.claude/skills, lido pelo Claude Code
#   agents    ~/.agents/skills, o diretório genérico de Agent Skills
#             (lido pelo Copilot no VS Code e por outros agentes)
#
# Opções:
#   --claude          instala no formato claude, sem perguntar
#   --agents          instala no formato agents, sem perguntar
#   --project DIR     instala no repositório DIR (DIR/.claude/skills, DIR/.agents/skills)
#                     em vez do diretório pessoal
#   --link            cria links simbólicos para este repositório em vez de copiar
#                     (um git pull aqui já atualiza as skills instaladas)
#                     A cópia segue os links da skill: os schemas dos adaptadores
#                     (../adapters/schemas) vão junto, na versão deste repositório.
#   --uninstall       remove as skills indicadas dos formatos escolhidos
#   --list            lista as skills disponíveis
#   -h, --help        mostra esta ajuda
#
# Com os dois formatos, a skill é instalada em .agents/skills e .claude/skills/<skill>
# vira um link para ela, para existir uma cópia só.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$REPO_DIR/skills"

claude=false
agents=false
project=""
link=false
uninstall=false
skills=()

usage() { sed -n '2,/^$/{s/^# \{0,1\}//;p}' "${BASH_SOURCE[0]}"; }

available() {
  for d in "$SKILLS_DIR"/*/; do
    [[ -f "$d/SKILL.md" ]] && basename "$d"
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --claude) claude=true ;;
    --agents) agents=true ;;
    --project)
      [[ $# -ge 2 ]] || { echo "erro: --project precisa de um diretório" >&2; exit 1; }
      project="$2"; shift ;;
    --link) link=true ;;
    --uninstall) uninstall=true ;;
    --list) available; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "erro: opção desconhecida: $1" >&2; usage >&2; exit 1 ;;
    *) skills+=("$1") ;;
  esac
  shift
done

if [[ ${#skills[@]} -eq 0 ]]; then
  mapfile -t skills < <(available)
fi

for s in "${skills[@]}"; do
  if [[ ! -f "$SKILLS_DIR/$s/SKILL.md" ]]; then
    echo "erro: skill não encontrada: $s (veja ./install.sh --list)" >&2
    exit 1
  fi
done

if [[ -n "$project" ]]; then
  [[ -d "$project" ]] || { echo "erro: diretório não existe: $project" >&2; exit 1; }
  base="$(cd "$project" && pwd)"
else
  base="$HOME"
fi
claude_dest="$base/.claude/skills"
agents_dest="$base/.agents/skills"

# Pergunta os formatos quando nenhum foi passado na linha de comando.
if ! $claude && ! $agents; then
  if [[ ! -t 0 ]]; then
    echo "erro: sem terminal para perguntar; passe --claude e/ou --agents" >&2
    exit 1
  fi
  $uninstall && acao="Remover de" || acao="Instalar para"
  echo "Skills: ${skills[*]}"
  echo "$acao quais formatos?"
  echo "  1) claude  $claude_dest (Claude Code)"
  echo "  2) agents  $agents_dest (Copilot no VS Code e outros agentes)"
  while true; do
    read -r -p "Escolha um ou mais, separados por espaço [1 2]: " resposta
    resposta="${resposta:-1 2}"
    claude=false; agents=false; valida=true
    for r in ${resposta//,/ }; do
      case "$r" in
        1|claude) claude=true ;;
        2|agents) agents=true ;;
        *) valida=false ;;
      esac
    done
    if $valida && { $claude || $agents; }; then break; fi
    echo "Resposta inválida: use 1, 2 ou 1 2."
  done
  echo
fi

# Remove o destino só se for uma instalação de skill (link ou pasta com SKILL.md).
remove() {
  local target="$1"
  if [[ -L "$target" ]]; then
    rm -f "$target"
  elif [[ -f "$target/SKILL.md" ]]; then
    rm -rf "$target"
  elif [[ -e "$target" ]]; then
    echo "erro: $target existe e não parece uma skill; remova-o à mão" >&2
    exit 1
  else
    return 1
  fi
}

# Copia a skill para o destino, ou cria um link para este repositório com --link.
place() {
  local s="$1" target="$2"
  mkdir -p "$(dirname "$target")"
  remove "$target" || true
  if $link; then
    ln -s "$SKILLS_DIR/$s" "$target"
    echo "link:     $target -> $SKILLS_DIR/$s"
  else
    cp -RL "$SKILLS_DIR/$s" "$target"
    echo "copiada:  $target"
  fi
}

for s in "${skills[@]}"; do
  if $uninstall; then
    for target in $($agents && echo "$agents_dest/$s") $($claude && echo "$claude_dest/$s"); do
      remove "$target" && echo "removida: $target" || true
    done
    continue
  fi

  if $agents; then
    place "$s" "$agents_dest/$s"
    if $claude; then
      remove "$claude_dest/$s" || true
      mkdir -p "$claude_dest"
      ln -s "$agents_dest/$s" "$claude_dest/$s"
      echo "link:     $claude_dest/$s -> $agents_dest/$s"
    fi
  else
    place "$s" "$claude_dest/$s"
  fi
done
