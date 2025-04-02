FROM node:22-bullseye as base

# Set working directory
WORKDIR /www
ENV RUN_MODE="docker"

# Enable Corepack 
RUN corepack enable

# Copy dependency manifest files
COPY package.json package.json
COPY pnpm-lock.yaml pnpm-lock.yaml

# Install dependencies using pnpm
RUN pnpm install 

# Copy application source and configuration files
COPY ./src ./src
COPY tsconfig.json tsconfig.json
COPY jest.config.js jest.config.js

# Build the application
RUN pnpm build

# Start the application
CMD ["pnpm", "start"]
