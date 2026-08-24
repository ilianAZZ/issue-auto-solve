FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY frontend ./frontend
RUN npm run build

FROM node:24-slim
ARG DOCKER_CLI_VERSION=27.3.1
ARG APP_VERSION=dev
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
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
COPY --from=build /app/frontend/dist ./frontend/dist
COPY prompts ./prompts
COPY config ./config

EXPOSE 8420
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8420/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
