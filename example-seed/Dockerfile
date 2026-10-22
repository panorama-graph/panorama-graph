# Imagem do example-seed: o CLI compilado num binário. Os exports (directory.json, infra.yaml) vêm de fora, num volume.
# Aqui é construída da raiz do repositório, com o SDK do workspace:
#   docker build -f example-seed/Dockerfile -t example-seed .
# Numa cópia fora do repositório, o projeto é comum: copie package.json e bun.lock (o SDK vem do npm),
# rode `bun install --frozen-lockfile --production` e compile src/cli.ts do mesmo jeito.
FROM oven/bun:1.4.2 AS build
WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
COPY api/package.json api/
COPY web/package.json web/
COPY adapters/package.json adapters/
COPY example-seed/package.json example-seed/
COPY sdks/typescript/package.json sdks/typescript/
RUN bun install --frozen-lockfile --production --filter example-seed
COPY sdks/typescript/src sdks/typescript/src
COPY example-seed/tsconfig.json example-seed/
COPY example-seed/src example-seed/src
WORKDIR /src/example-seed
RUN bun build --compile --outfile /out/example-seed src/cli.ts

FROM debian:bookworm-slim
COPY --from=build /out/example-seed /usr/local/bin/
WORKDIR /workspace
ENTRYPOINT ["example-seed"]
CMD ["--help"]
