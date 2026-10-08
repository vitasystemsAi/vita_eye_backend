# syntax=docker/dockerfile:1
# VITA EYE backend API (also used for the one-shot `migrate` service). Build context: repository root.

FROM node:24-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=5000 \
    EVIDENCE_STORAGE_DIR=/data/evidence
WORKDIR /app
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/package.json
# Migrations and seeders are resolved relative to the repository root (/app/database)
COPY database ./database
RUN mkdir -p /data/evidence && chown node:node /data/evidence
USER node
WORKDIR /app/backend
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BACKEND_PORT||5000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
