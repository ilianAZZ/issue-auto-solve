FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim
ARG DOCKER_CLI_VERSION=27.3.1
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && arch="$(dpkg --print-architecture)" \
 && case "$arch" in amd64) dir=x86_64 ;; arm64) dir=aarch64 ;; *) echo "unsupported arch $arch" && exit 1 ;; esac \
 && curl -fsSL "https://download.docker.com/linux/static/stable/${dir}/docker-${DOCKER_CLI_VERSION}.tgz" \
    | tar -xz -C /usr/local/bin --strip-components=1 docker/docker \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY web ./web
COPY prompts ./prompts

EXPOSE 8420
CMD ["node", "dist/index.js"]
