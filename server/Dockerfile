# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first so Docker can cache this layer.
COPY package*.json ./
RUN npm ci

# Compile TypeScript → dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies from the shipped node_modules.
RUN npm prune --omit=dev

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# wget is used by the compose healthcheck.
RUN apk add --no-cache wget

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Snapshot directory for the in-memory driver (mounted as a volume in compose).
RUN mkdir -p /app/data

# Run as the unprivileged user that the node image ships with.
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1

CMD ["node", "dist/index.js"]
