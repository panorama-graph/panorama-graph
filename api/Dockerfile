# Roda do código-fonte (Node com tsx). Construída da raiz do repositório:
#   docker build -f api/Dockerfile .
FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache wget && npm install -g pnpm@11.20.0

# Os manifestos de todo o workspace, para o lockfile valer; só as dependências da API são instaladas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY web/package.json web/
COPY sdks/typescript/package.json sdks/typescript/
RUN pnpm install --frozen-lockfile --prod --filter panorama-graph-api
ENV NODE_ENV=production

COPY api/tsconfig.json api/
COPY api/src api/src

WORKDIR /app/api
EXPOSE 3200
USER node
CMD ["node", "--import", "tsx", "src/main.ts"]
