# Console: build estático servido na 5180. Construída da raiz do repositório (o SDK vem do código, pelo workspace):
#   docker build -f web/Dockerfile .
FROM oven/bun:1.4.2-alpine AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY api/package.json api/
COPY web/package.json web/
COPY sdks/typescript/package.json sdks/typescript/
RUN bun install --frozen-lockfile --filter panorama-graph-web
COPY sdks/typescript sdks/typescript
COPY web web
# As URLs entram no build (o Vite embute no JS): o navegador chama as portas do host.
ARG VITE_GRAPH_API_URL=http://localhost:3200
ARG VITE_EVIDENCE_URL_TEMPLATE=
ENV VITE_GRAPH_API_URL=$VITE_GRAPH_API_URL
ENV VITE_EVIDENCE_URL_TEMPLATE=$VITE_EVIDENCE_URL_TEMPLATE
WORKDIR /app/web
RUN bun run build

FROM oven/bun:1.4.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/web/dist ./dist
EXPOSE 5180
USER bun
CMD ["bunx", "--bun", "serve@14", "-s", "dist", "-l", "5180", "-n", "--no-clipboard"]
