# Container Registry (local, placeholder-based)

**Application-side documentation only.** This document describes how
`hello-devops` *uses* the container registry in CI. The registry
itself is infrastructure: it is **not** created, started, or configured
by this repository (that decision belongs to the infrastructure
repository — see its `docs/gitops.md`).

## Status

- Nothing here has been executed: no registry was started, no image was
  built or pushed, the CI workflow has not run.
- The registry address is referenced everywhere as the placeholder
  **`<LOCAL_REGISTRY_URL>`** (base address including port, no trailing
  slash — example *form*: `localhost:5000`).

## What this repository pushes

| Item | Value | Pushed by |
|---|---|---|
| Image repository | `<LOCAL_REGISTRY_URL>/hello-devops` | `.github/workflows/ci.yml` (`image` job) |
| Tag | `latest` (required) | same |
| Credentials | none in Git — repository *variables* / *secrets* | GitHub Actions settings |

Two hard requirements come from the infrastructure repository's
contract:

1. **The repository name must be exactly `…/hello-devops`** — Kargo's
   `kustomize-set-image` matches on the full repository name when it
   rewrites the digest into `dev/` and `staging/`.
2. **`latest` must be pushed on every release build** — the Kargo
   `Warehouse` uses the `Digest` selection strategy on that tag to
   discover new images. (Individual commits are identified by the
   digest, not by the tag.)

The workflow also pushes only on `push` to `master` (never from pull
requests), so a PR can never publish an image.

## Configuring the registry in GitHub Actions (later)

No address or credential is committed to this repository. Configure the
repository's *Settings → Secrets and variables → Actions*:

| Name | Type | Purpose |
|---|---|---|
| `LOCAL_REGISTRY_URL` | variable | base address, e.g. `192.168.1.10:5000`. **While unset, the `image` job is skipped** and CI only runs tests. |
| `LOCAL_REGISTRY_USERNAME` | variable | optional — only if the registry requires auth |
| `LOCAL_REGISTRY_PASSWORD` | secret | optional — pairs with the username |

Login happens only when `LOCAL_REGISTRY_USERNAME` is set, so an
unauthenticated local `registry:2` needs no secrets at all.

## Reachability caveat (open decision)

The `image` job runs on a **GitHub-hosted runner**, which must be able
to reach `<LOCAL_REGISTRY_URL>` to push. A registry bound to
`localhost` on your Mac is *not* reachable from such a runner. The
options — all deferred to a later milestone, none started here:

- run the workflow with a **self-hosted runner** on the Mac (registry
  reachable as `localhost:5000`),
- expose the registry beyond the Mac, or
- make the registry reachable in some other lab-local way.

Until then, keeping `LOCAL_REGISTRY_URL` unset is the safe state: CI
tests run, no push is attempted.

## Explicitly out of scope

- **No ECR, no AWS, no LocalStack** — the flow is fully local.
- **No Docker Hub (or any cloud/hosted registry)** is required or
  referenced; the local registry is the only target.
- **No registry is installed or started by this repository**, and no
  image has been built or pushed.

## How this connects to the rest (see README for the full diagram)

```text
GitHub Actions (this repo)          pushes <LOCAL_REGISTRY_URL>/hello-devops:latest
        │
        ▼
Local container registry            (infrastructure-owned, not started here)
        │  new digest discovered
        ▼
Kargo (infrastructure repo)         Warehouse → Freight → dev → staging
        │  commits the digest into dev/ and staging/ of THIS repo
        ▼
Argo CD (infrastructure repo)       syncs those paths into K3s
        │
        ▼
hello-devops running in K3s
```
