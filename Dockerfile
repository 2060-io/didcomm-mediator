FROM node:22-bullseye AS base

# Set working directory
WORKDIR /www
ENV RUN_MODE="docker"

# Update and enable Corepack (npm rotated registry keys, bundled corepack may have stale keys)
RUN npm install -g corepack@latest
RUN corepack enable

# Copy dependency manifest files
COPY package.json package.json
COPY pnpm-lock.yaml pnpm-lock.yaml

# Install dependencies using pnpm
RUN pnpm install --frozen-lockfile

# Copy application source and configuration files
COPY ./src ./src
COPY tsconfig.json tsconfig.json
COPY jest.config.cjs jest.config.cjs

# Build the application
RUN pnpm build

# Start the application
CMD ["pnpm", "start"]
