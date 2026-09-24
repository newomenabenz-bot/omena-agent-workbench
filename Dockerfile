# Multi-Stage Production Dockerfile for OMENA Mobile Agent Workbench
# Stage 1: Build & Dependencies
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Stage 2: Minimal Production Runtime
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Install runtime system packages: Chromium, git, curl, bash, dumb-init
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    git \
    bash \
    curl \
    dumb-init \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    WORKSPACE_ROOT=/app/workspace

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY agent_engine.js ./
COPY db.js ./
COPY security.js ./
COPY providers ./providers
COPY public ./public

# Setup persistent mount directories
RUN mkdir -p /app/workspace /app/storage/artifacts /app/storage/memory /app/storage/workbench_uploads

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
