# syntax=docker/dockerfile:1

########## Stage 1: production dependencies ##########
# package.json is copied alone (it is also read at runtime by
# src/config.js for the default version). No lockfile exists yet —
# see the README follow-up note about committing package-lock.json.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

########## Stage 2: runtime image ##########
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src

# Run as the unprivileged user baked into the base image — the app
# never writes to the filesystem, so root is not needed.
USER node

# Default port (PORT can still override it via the environment).
EXPOSE 3000

# No HEALTHCHECK on purpose: liveness/readiness are owned by
# Kubernetes probes (/health and /ready), not by the image.
CMD ["node", "src/server.js"]
