# syntax=docker/dockerfile:1

########## Stage 1: production dependencies ##########
# Installed from the committed lockfile with `npm ci`, so every build
# gets exactly the dependency tree that was tested.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

########## Stage 2: runtime image ##########
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# package.json is also read at runtime by src/config.js (default version).
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src

# Run as the unprivileged user baked into the base image (uid 1000) —
# the app never writes to the filesystem, so root is not needed.
USER node

# Default port (PORT can still override it via the environment).
EXPOSE 3000

# No HEALTHCHECK on purpose: liveness/readiness are owned by
# Kubernetes probes (/health and /ready), not by the image.
CMD ["node", "src/server.js"]
