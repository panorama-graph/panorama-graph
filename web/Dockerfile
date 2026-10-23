# Console: build estático servido na 5180. Construída da raiz do repositório (o SDK vem do código, pelo workspace):
#   docker build -f web/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.20.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY web/package.json web/
COPY sdks/typescript/package.json sdks/typescript/
RUN pnpm install --frozen-lockfile --filter panorama-graph-web
COPY sdks/typescript sdks/typescript
COPY web web
# As URLs entram no build (o Vite embute no JS): o navegador chama as portas do host.
ARG VITE_GRAPH_API_URL=http://localhost:3200
ARG VITE_EVIDENCE_URL_TEMPLATE=
ENV VITE_GRAPH_API_URL=$VITE_GRAPH_API_URL
ENV VITE_EVIDENCE_URL_TEMPLATE=$VITE_EVIDENCE_URL_TEMPLATE
WORKDIR /app/web
RUN pnpm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g serve@14
COPY --from=build /app/web/dist ./dist
EXPOSE 5180
USER node
CMD ["serve", "-s", "dist", "-l", "5180", "-n", "--no-clipboard"]
