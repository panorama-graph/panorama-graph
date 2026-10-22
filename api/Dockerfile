# Roda do código-fonte (Bun executa TypeScript). Construída da raiz do repositório:
#   docker build -f api/Dockerfile .
FROM oven/bun:1.4.2-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget

# Os manifestos de todo o workspace, para o lockfile valer; só as dependências da API são instaladas.
COPY package.json bun.lock bunfig.toml ./
COPY api/package.json api/
COPY web/package.json web/
COPY adapters/package.json adapters/
COPY example-seed/package.json example-seed/
COPY sdks/typescript/package.json sdks/typescript/
RUN bun install --frozen-lockfile --production --filter panorama-graph-api

COPY api/tsconfig.json api/
COPY api/src api/src

WORKDIR /app/api
EXPOSE 3200
USER bun
CMD ["bun", "src/main.ts"]
