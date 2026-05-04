FROM node:24-slim AS base
ENV COREPACK_INTEGRITY_KEYS=0
RUN corepack enable && corepack prepare pnpm@9.15.3 --activate

# ---- Builder ----
FROM base AS builder
WORKDIR /www
ENV RUN_MODE="docker"

# Patches dir is read by pnpm at install time (pnpm.patchedDependencies).
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# --ignore-scripts skips the project's postinstall (patch-package), which is
# a devDep and no longer present after prune.
RUN pnpm prune --prod --ignore-scripts

# ---- Runtime ----
FROM node:24-slim AS runtime
WORKDIR /www
ENV RUN_MODE="docker"
ENV NODE_ENV=production

COPY --from=builder /www/node_modules ./node_modules
COPY --from=builder /www/build ./build
COPY --from=builder /www/package.json ./package.json

EXPOSE 4000
CMD ["node", "./build/index.js"]
