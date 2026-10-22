#!/usr/bin/env bash
# Importa no panorama-graph uma pasta de carga gerada pela skill.
#
# Uso: importar.sh [--dry-run] [pasta]      (padrão: ./carga-grafo)
#
#   componentes/<nome>/   cada pacote vai ao graph-receiver (POST /v1/builds), que o traduz como
#                         traduz o build/architecture do plugin Gradle; opcoes.json vira as opções
#                         do envio e não entra no pacote
#   organizacao/*.yaml    vai ao graph-seed
#
# --dry-run    monta e confere os retratos, sem gravar
#
# Variáveis:
#   RECEIVER_URL    graph-receiver (padrão: http://localhost:3210)
#   GRAPH_API_URL   panorama-graph-api, para o graph-seed (padrão: http://localhost:3200)
#   GRAPH_SEED      comando do graph-seed, que recebe a pasta e as opções
#                   (padrão: a imagem dos adaptadores pelo docker, panorama-graph-adapters:local,
#                   ou ADAPTERS_IMAGE)
#
# Precisa de curl e jq. Saída 0: tudo importado (ou conferido); 1: algum pacote ou retrato recusado.

set -euo pipefail

usage() { sed -n '2,/^$/{s/^# \{0,1\}//;p}' "${BASH_SOURCE[0]}"; }

dry=false
dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry=true ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "erro: opção desconhecida: $1" >&2; usage >&2; exit 1 ;;
    *) dir="$1" ;;
  esac
  shift
done
dir="${dir:-./carga-grafo}"
[[ -d "$dir" ]] || { echo "erro: pasta não existe: $dir" >&2; exit 1; }
dir="$(cd "$dir" && pwd)"

for cmd in curl jq; do
  command -v "$cmd" >/dev/null || { echo "erro: $cmd não encontrado" >&2; exit 1; }
done

RECEIVER_URL="${RECEIVER_URL:-http://localhost:3210}"
GRAPH_API_URL="${GRAPH_API_URL:-http://localhost:3200}"
export GRAPH_API_URL
ADAPTERS_IMAGE="${ADAPTERS_IMAGE:-panorama-graph-adapters:local}"

failed=0

# Um componente: os JSON do pacote, pelo caminho relativo, e as opções de opcoes.json.
publish_component() {
  local pkg="$1" name files options body response status
  name="$(basename "$pkg")"
  echo "== componente $name"
  if [[ ! -f "$pkg/manifest.json" ]]; then
    echo "   erro: $name sem manifest.json" >&2
    failed=1
    return
  fi
  mapfile -t files < <(cd "$pkg" && find . -name '*.json' ! -path ./opcoes.json | sed 's|^\./||' | sort)
  options='{}'
  [[ -f "$pkg/opcoes.json" ]] && options="$(jq -c . "$pkg/opcoes.json")"
  body="$(cd "$pkg" && jq -n --argjson dryRun "$dry" --argjson options "$options" \
    '{format: "panorama-graph-build/1", files: ([inputs | {(input_filename): .}] | add), options: $options, dryRun: $dryRun}' \
    "${files[@]}")"
  response="$(mktemp)"
  status="$(curl -sS -o "$response" -w '%{http_code}' -H 'content-type: application/json' -H 'accept: text/plain' \
    --data-binary "$body" "$RECEIVER_URL/v1/builds" || echo 000)"
  sed 's/^/   /' "$response"
  rm -f "$response"
  if [[ "$status" != 200 ]]; then
    echo "   recusado (HTTP $status)" >&2
    failed=1
  fi
}

if [[ -d "$dir/componentes" ]]; then
  for pkg in "$dir"/componentes/*/; do
    [[ -d "$pkg" ]] && publish_component "${pkg%/}"
  done
fi

if [[ -d "$dir/organizacao" ]] && compgen -G "$dir/organizacao/*.yaml" >/dev/null; then
  echo "== organização"
  args=()
  $dry && args+=(--dry-run)
  if [[ -n "${GRAPH_SEED:-}" ]]; then
    # shellcheck disable=SC2086
    $GRAPH_SEED "$dir/organizacao" "${args[@]}" || failed=1
  else
    command -v docker >/dev/null || { echo "erro: sem docker; informe GRAPH_SEED (ex.: 'bun run --cwd <adapters> graph-seed')" >&2; exit 1; }
    docker run --rm --network host -e GRAPH_API_URL -v "$dir/organizacao:/carga:ro" "$ADAPTERS_IMAGE" \
      graph-seed /carga "${args[@]}" || failed=1
  fi
fi

exit "$failed"
