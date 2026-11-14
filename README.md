# hello-devops

A small, intentionally minimal REST API written in Node.js + Express
that persists data in **PostgreSQL**, **MongoDB** and **Redis**. It is
the application half of a two-repository GitOps setup: everything about
*how the application is built and what it needs* lives here, while
deployment and promotion tooling lives in a separate infrastructure
repository (wired up in later milestones).

**Status:** application, database integrations, container image,
Kustomize manifests, CI and GitOps documentation are in place. The
infrastructure side (registry, Argo CD, Kargo) is not wired up yet —
see [Later Milestones](#later-milestones-m2).

## End-to-End Architecture

```text
┌── hello-devops (THIS repository) ───────────────────────────────────────────── ┐
│ src/ Express API + test/           Dockerfile (node:24-alpine, non-root)       │
│ base/ shared manifests             dev/ + staging/ Kustomize overlays          │
│ .github/workflows/ci.yml           docs/ registry + Argo CD + Kargo notes      │
└──────────────┬─────────────────────────────────────────────────────────────────┘
               │  git push / pull request
               ▼
┌── GitHub Actions CI ───────────────────────────────────────────────────────────┐
│ test:  npm ci → npm run check → npm test           (PRs + pushes to master)    │
│ integration: npm run test:integration vs real PostgreSQL/MongoDB/Redis         │
│ image: docker build → push <LOCAL_REGISTRY_URL>/hello-devops:latest            │
│        (push to master only, path-filtered — Kargo commits in                  │
│         dev/ staging/ never retrigger it; skipped until the                    │
│         LOCAL_REGISTRY_URL repository variable exists)                         │
└──────────────┬─────────────────────────────────────────────────────────────────┘
               │  push :latest
               ▼
┌── Local container registry (infrastructure-owned; never started here) ──────── ┐
└──────────────┬─────────────────────────────────────────────────────────────────┘
               │  new digest discovered
               ▼
┌── local-server (INFRASTRUCTURE repository — configuration only) ────────────── ┐
│ Kargo     Warehouse → Freight → Stage dev → Stage staging                      │
│           promotion = git-clone → kustomize-set-image → commit → push          │
│           └── writes the promoted digest into THIS repo's dev/ and staging/    │
│ Argo CD   Applications hello-devops-dev / -staging (auto-sync, prune,          │
│           selfHeal), source paths dev/ and staging/ at the repo root           │
│           └── renders those overlays and applies them to the cluster           │
└──────────────┬─────────────────────────────────────────────────────────────────┘
               ▼
┌── K3s cluster ──────────────────────────────────────────────────────────────── ┐
│ namespace hello-devops-dev          namespace hello-devops-staging             │
│   Deployment + Service (ClusterIP)   Deployment + Service                      │
│   liveness  → /health  (process)     readiness → /ready (all 3 databases)      │
│                     │                        │                                 │
│                     └────────────┬───────────┘                                 │
│                                  ▼                                             │
│ namespace databases:   postgres.databases:5432 (db lab, trust)                 │
│                        mongodb.databases:27017   redis.databases:6379          │
└─────────────────────────────────────────────────────────────────────────────── ┘
```

Ownership in one line each: **this repo** = how the application is built
and what it needs (code, image, manifests, CI); **`local-server`** =
what runs on the platform and how it is promoted (Kargo, Argo CD,
databases, registry); **GitHub** = running the CI. The only coupling is
the path contract (`dev/`, `staging/`), the image name
(`<LOCAL_REGISTRY_URL>/hello-devops`), and the `latest` tag.

## Architecture Overview

```text
HTTP client
    │
    ▼
Express routes (src/routes/)      ← validation, HTTP status codes
    │
    ▼
Service layer (src/services/)     ← SQL / documents / cache operations
    │
    ├── PostgreSQL   → relational data (users)
    ├── MongoDB      → document data (documents)
    └── Redis        → key-value cache (/cache)
```

- `src/config.js` reads **all** configuration from environment
  variables; the code contains no hostnames or credentials.
- `src/app.js` is a factory (`createApp`) that receives its services
  by injection — tests substitute in-memory fakes, so `npm test` needs
  no running database.
- `src/server.js` is the only entry point: config → services → listen
  → graceful shutdown on SIGTERM/SIGINT.

## Endpoints

| Method | Path | Data store | Description |
|--------|------|------------|-------------|
| GET | `/` | — | Service information (name, version, endpoint list) |
| GET | `/health` | — | **Liveness** — always `200` while the process runs |
| GET | `/ready` | all three | **Readiness** — `200` only when PostgreSQL, MongoDB *and* Redis answer; otherwise `503` with per-dependency status |
| GET | `/version` | — | Application version and Node runtime version |
| POST | `/users` | PostgreSQL | Create a user `{name, email}` → `201` |
| GET | `/users/:id` | PostgreSQL | Fetch a user by id → `200` / `404` |
| POST | `/documents` | MongoDB | Create a document `{title, type?, body?}` → `201` |
| GET | `/documents/:id` | MongoDB | Fetch a document by id → `200` / `404` |
| GET | `/cache/:key` | Redis | Read a cached value → `200` / `404` (miss) |
| POST | `/cache/:key` | Redis | Write `{value, ttl?}` (ttl: 1 s – 1 year) → `200` |

Error contract: `400` invalid input, `401` missing/wrong API key (only
when `API_KEY` is set), `404` not found, `409` duplicate email, `413`
body over 100 kB, `415` unsupported charset,
`503 {"error":"service_unavailable","service":…}` when a database is
unreachable or does not answer within a few seconds, `500` for bugs
(logged with a stack trace — never reported as a `503`).

### Authentication

Set `API_KEY` (at least 16 characters, e.g. `openssl rand -hex 32`) to
require `Authorization: Bearer <API_KEY>` on `/users`, `/documents` and
`/cache`. `/`, `/health`, `/ready` and `/version` stay open for probes.
Without `API_KEY` the data endpoints are **open to anyone who can reach
the service** (the server logs a warning at startup) — set it in every
environment that is not fully trusted.

```sh
curl -H "Authorization: Bearer $API_KEY" http://localhost:3000/users/1
```

Cache keys are stored in Redis under the `hello-devops:cache:` prefix,
so the API can never read or overwrite other applications' keys.

## Database Responsibilities

| Database | Responsibility | Demonstrated by |
|----------|----------------|-----------------|
| **PostgreSQL** | Relational (SQL) data with a real schema: a `users` table with a `SERIAL` primary key, `UNIQUE` email and `TIMESTAMPTZ` creation time. Parameterised queries only (no string interpolation). | `POST /users`, `GET /users/:id` — including `409` on duplicate email (unique constraint) |
| **MongoDB** | Document-oriented (JSON/BSON) data with flexible schemas: `documents` with `type`, `title`, `body`, `createdAt`, addressed by ObjectId. | `POST /documents`, `GET /documents/:id` — e.g. profile/activity documents |
| **Redis** | Cache / key-value store for frequently requested values, with optional TTL expiry. | `GET /cache/:key` (hit/miss), `POST /cache/:key` (write with optional TTL) |

The schema (`CREATE TABLE IF NOT EXISTS users …`) is ensured lazily by
the application on first use — no migrations framework is used, by
design; the databases themselves are **not** provisioned by this
repository.

## Configuration

All configuration is environment variables (never hardcoded). See
[.env.example](.env.example) — copy it to `.env` (gitignored) for local
development.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port to listen on |
| `VERSION` | *(package.json)* | Version reported by `/version` (optional override) |
| `PGHOST` | `localhost` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGDATABASE` | `lab` | PostgreSQL database name |
| `PGUSER` | `postgres` | PostgreSQL user |
| `PGPASSWORD` | *(empty)* | PostgreSQL password — only needed if the server does not use `trust` auth |
| `API_KEY` | *(unset)* | Shared secret for the data endpoints (min. 16 chars); unset = no authentication |
| `MONGODB_URI` | `mongodb://localhost:27017/hello-devops` | Full MongoDB connection URI (host, port, database) |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |

## Local Development

Requirements: Node.js 22.12+ (developed against Node 24 LTS — see
[.nvmrc](.nvmrc)) and Docker for the local databases.

```sh
cp .env.example .env      # optional; loaded by npm start / npm run dev
npm ci                    # install exactly the locked dependencies
npm test                  # unit tests — no database needed
npm run db:up             # PostgreSQL, MongoDB, Redis via compose.yaml (127.0.0.1 only)
npm run test:integration  # the app against the real databases
npm start                 # run the API on port 3000
npm run dev               # run with automatic restart on file changes
npm run db:down           # stop the databases
```

The API starts and serves `/`, `/health` and `/version` even when no
database is running — `/ready` then answers `503` and the database
routes answer `503`, which is exactly the behaviour Kubernetes relies
on for its probes.

```sh
curl http://localhost:3000/health
curl http://localhost:3000/ready
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com"}'
```

## Container Image

The [Dockerfile](Dockerfile) is a two-stage build on `node:24-alpine`:

1. **deps** — `npm ci --omit=dev` installs exactly the locked production
   dependencies;
2. **runtime** — copies `package.json`, `src/` and the installed
   `node_modules`, then runs as the unprivileged `node` user and
   exposes port `3000`.

Design notes:

- **No `HEALTHCHECK`** on purpose — liveness/readiness are owned by
  Kubernetes probes (`/health`, `/ready`), so the image must not
  duplicate that logic.
- **No credentials in the image** — all configuration arrives at
  runtime through environment variables (`PORT`, `PGHOST`, …).

Build and run locally (when Docker is available):

```sh
docker build -t hello-devops:local .
docker run --rm -p 3000:3000 hello-devops:local
curl http://localhost:3000/health
```

## Kubernetes Manifests (Kustomize)

Manifests live at the **repository root** because that is the path
contract the infrastructure repository's Argo CD `Application`s point at
(`path: dev` / `path: staging`) and Kargo writes into:

```text
base/                     # shared manifests
├── configmap.yaml        # env-var configuration (hostnames, ports, db name)
├── deployment.yaml       # image <LOCAL_REGISTRY_URL>/hello-devops:latest, probes
├── service.yaml          # ClusterIP :80 → container :3000
├── kustomization.yaml    # resources: configmap, deployment, service
└── secret.example.yaml   # DOCUMENTATION ONLY — not in kustomization.yaml
dev/
└── kustomization.yaml    # namespace: hello-devops-dev, images[] ← Kargo writes here
staging/
└── kustomization.yaml    # namespace: hello-devops-staging, images[] ← Kargo writes here
```

Render locally (read-only check — nothing is ever applied from this
repository by these steps):

```sh
kubectl kustomize dev       # or: kustomize build dev
kubectl kustomize staging
```

Key properties:

- **Configuration is environment variables only.** Non-sensitive values
  (hostnames, ports, database name) live in the `ConfigMap`; the
  password and the `API_KEY` belong in a `Secret` that is *never
  committed* — `base/secret.example.yaml` documents the shape and is
  deliberately excluded from `kustomization.yaml`. The Deployment
  mounts both keys as `optional: true`, so pods start before the Secret
  exists (the lab's PostgreSQL uses `trust` auth) — but without
  `API_KEY` the data endpoints are unauthenticated.
- **No databases are created here.** The `ConfigMap` only points at the
  services the infrastructure repository runs in the shared
  `databases` namespace (`postgres.databases.svc.cluster.local`, …).
- **No Argo CD or Kargo configuration in this repository.** Which repo
  and path deploys where, and how images are promoted, is decided
  entirely by the infrastructure repository.
- **Probes match the application:** liveness → `/health` (process
  only), readiness → `/ready` (all three databases reachable).
- **Image repository is a cross-repo contract:** it must stay exactly
  `<LOCAL_REGISTRY_URL>/hello-devops` (tag arbitrary) so Kargo's
  `kustomize-set-image` can match and rewrite it in `dev/` and
  `staging/`. Placeholders are replaced in both repositories together,
  later (see the infrastructure repo's `docs/gitops.md`).

## Continuous Integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on **pull
requests** and on **pushes to `master`** (path-filtered):

| Job | When | What |
|-----|------|------|
| `test` | always (on triggered runs) | `npm ci` → `npm run check` (static module import) → `npm test` |
| `integration` | always (on triggered runs) | PostgreSQL, MongoDB and Redis service containers → `npm run test:integration` |
| `image` | only `push` to `master` after both test jobs pass, and only once `LOCAL_REGISTRY_URL` is set as a repository variable | `docker build` → optional registry login → `docker push …/hello-devops:latest` |

Properties worth knowing:

- **No deployment happens in CI.** Deployment and promotion belong to
  Argo CD and Kargo, which are configured in the infrastructure
  repository — this workflow neither has cluster access nor needs it.
- **No AWS / ECR / LocalStack / Docker Hub / cloud registry** is
  referenced. The registry URL is a repository *variable*
  (`vars.LOCAL_REGISTRY_URL`) and its credentials a *secret*
  (`secrets.LOCAL_REGISTRY_PASSWORD`) — nothing host-specific is
  committed. Until the variable is set, the `image` job is skipped and
  CI still validates the code.
- **Path filtering prevents build loops:** the workflow only triggers
  on `src/**`, `test/**`, `scripts/**`, `package.json`,
  `package-lock.json`, `Dockerfile`,
  `.dockerignore`, and the workflow file itself. Kargo's promotion
  commits touch `dev/` / `staging/` only, so they never retrigger CI.
- **Reproducible installs:** `npm ci` from the committed
  `package-lock.json`, with the npm cache enabled.

Registry details (placeholder `<LOCAL_REGISTRY_URL>`, GitHub variables
and secrets, reachability caveat) are documented in
[docs/container-registry.md](docs/container-registry.md).

`npm run check` (see [scripts/check.js](scripts/check.js)) imports every
source module without starting the server — a fast syntax and
dependency check before the slower jobs.

## Testing

Tests use the built-in Node.js test runner (`node:test`) plus
`supertest`, in two layers:

- **Unit tests** (`npm test`, `test/*.test.js`) inject in-memory fakes
  for all three databases — fast, deterministic, no external
  dependency. They cover validation, status codes, authentication,
  security headers and outage handling.
- **Integration tests** (`npm run test:integration`,
  `test/integration/`) run the real services against real PostgreSQL,
  MongoDB and Redis (`npm run db:up` locally, service containers in
  CI): the main create/read flows, duplicate detection, TTL expiry,
  key namespacing, outages answering `503` without hanging, and
  recovery after a database restart.

```sh
npm test
npm run db:up && npm run test:integration
```

## Project Structure

```text
hello-devops/
├── package.json            # dependencies and scripts
├── .env.example            # documented environment variables
├── package-lock.json       # locked dependency tree (npm ci)
├── .nvmrc                  # Node.js version (24)
├── compose.yaml            # local PostgreSQL / MongoDB / Redis (dev only)
├── Dockerfile              # two-stage production image (node:24-alpine)
├── .dockerignore           # keeps the build context lean
├── .github/workflows/ci.yml # CI: test always, push :latest on master
├── base/                   # shared K8s manifests (see above)
├── dev/                    # Kustomize overlay → namespace hello-devops-dev
├── staging/                # Kustomize overlay → namespace hello-devops-staging
├── scripts/
│   └── check.js            # static "every module imports" check
├── docs/                   # registry / Argo CD / Kargo (application side)
├── src/
│   ├── app.js              # Express app factory: core routes, /ready, mounts, 404, errors
│   ├── auth.js             # optional API-key (Bearer) authentication
│   ├── config.js           # environment-variable configuration
│   ├── server.js           # entry point: config → services → listen → graceful shutdown
│   ├── errors.js           # HTTP-aware error types (400/404/409/503), deadlines
│   ├── http.js             # withService(): error type → HTTP response
│   ├── routes/
│   │   ├── users.js        # /users      (PostgreSQL)
│   │   ├── documents.js    # /documents  (MongoDB)
│   │   └── cache.js        # /cache      (Redis)
│   └── services/
│       ├── index.js        # wires the three services from config
│       ├── postgres.js     # pg Pool, users table, lazy schema
│       ├── mongo.js        # MongoClient, documents collection, reconnect after failed start
│       └── redis.js        # node-redis client, fail-fast while offline, key prefix
└── test/
    ├── helpers/fakes.js    # in-memory fakes (+ outage / bug simulators)
    ├── app.test.js         # core endpoints, /ready, body errors, headers
    ├── auth.test.js        # optional API key
    ├── config.test.js      # configuration tests
    ├── errors.test.js      # error helpers and deadlines
    ├── users.test.js       # /users endpoints
    ├── documents.test.js   # /documents endpoints
    ├── cache.test.js       # /cache endpoints
    └── integration/        # real databases: main flows, outages, recovery
```

## Later Milestones (M2)

Deliberately not done in this milestone:

1. **Replace the remaining placeholder `<LOCAL_REGISTRY_URL>` in both
   repositories, together** — in `base/deployment.yaml`,
   `dev/kustomization.yaml`, `staging/kustomization.yaml` here, and in
   `local-server`'s `warehouse.yaml`, `stage-dev.yaml`,
   `stage-staging.yaml`. (The repository URL and branch are already
   resolved everywhere:
   `https://github.com/CharbelKallas/hello-devops.git`, branch
   `master`.)
2. **Configure GitHub Actions** (repository Settings → Secrets and
   variables): `LOCAL_REGISTRY_URL` (+ optional
   `LOCAL_REGISTRY_USERNAME` / `LOCAL_REGISTRY_PASSWORD`) and decide
   the reachability/runner question in
   [docs/container-registry.md](docs/container-registry.md).
3. **Push these changes to `master`** — the branch triggers in `ci.yml`
   now match the default branch, so this starts the first CI run; until
   steps 1–2 are done the `image` job stays skipped by design.
4. **Infrastructure side:** start the local registry, apply the Kargo
   and Argo CD manifests, and create `hello-devops-secret` with an
   `API_KEY` in each namespace (plus `PGPASSWORD` if PostgreSQL ever
   needs one — see `base/secret.example.yaml`).
5. **First promotion:** dev → staging in the Kargo UI; verify sync and
   probes.
6. Optional hardening: linter (e.g. ESLint), a CI job validating the
   Kustomize overlays (`kustomize build dev` / `staging`), image
   digest pinning for the base image.

## Design Principles

- **Small on purpose** — Express is the only framework; no ORM, no
  build step, no logger library.
- **Configuration via environment** — no credentials or hostnames in
  the code; `.env` is gitignored.
- **Testable by construction** — `createApp()` takes injected
  services, so unit tests never need real databases; integration tests
  cover the real ones.
- **Fail visibly** — a down database yields `503` on the affected
  routes and `not_ready` on `/ready` within a few seconds, never a
  hang, and the app recovers by itself when the database returns.
