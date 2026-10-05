# Kargo — Application Side of the Contract

**Where Kargo is configured: the infrastructure repository**
(`local-server`), not this one. The `Project`, `Warehouse`, and
`Stage` objects live in `local-server/kubernetes/kargo/`; promotion
policy is platform configuration.

This document records **what Kargo expects from `hello-devops`** and
which of its writes land in this repository. Nothing here has been
executed (no Kargo object was applied, no promotion was run).

## Status

- Configuration/documentation only: no `Project` / `Warehouse` /
  `Stage`, no registry URL, and no credentials of any kind exist in
  this repository.
- The infrastructure repository carries the placeholders
  `<LOCAL_REGISTRY_URL>`, `<HELLO_DEVOPS_GIT_REPOSITORY_URL>`, and
  `<HELLO_DEVOPS_GIT_REPOSITORY_BRANCH>` (in `warehouse.yaml`,
  `stage-dev.yaml`, `stage-staging.yaml`). They are replaced **there**,
  never here — this repository invents no real registry address and no
  real clone URL.

## The promotion flow (all Kargo objects defined in the infra repo)

```text
CI in this repo            pushes <LOCAL_REGISTRY_URL>/hello-devops:latest
        ▼
Warehouse (infra repo)     watches that tag with Digest selection → Freight
        ▼
Stage "dev"                promotion steps (below) → commits to dev/
        ▼
Stage "staging"            same steps → commits to staging/
        ▼
Argo CD (infra repo)       syncs dev/ and staging/ into K3s
```

## What Kargo writes into this repository

Each Stage runs four steps on its promotion:

1. `git-clone` — checks out this repository
   (`<HELLO_DEVOPS_GIT_REPOSITORY_URL`, branch
   `<HELLO_DEVOPS_GIT_REPOSITORY_BRANCH>`);
2. `kustomize-set-image` — rewrites the image digest in `dev/`
   (stage `dev`) or `staging/` (stage `staging`);
3. `git-commit` — commits that single overlay change;
4. `git-push` — pushes back to the same branch.

So the **only** Kargo-authored changes in this repository are the
`images:` entries inside `dev/kustomization.yaml` and
`staging/kustomization.yaml`. They are machine-written: merge by
keeping Kargo's entry rather than hand-editing it.

## What this repository must guarantee

1. **`dev/` and `staging/` exist at the root** with a
   `kustomization.yaml` containing an `images:` entry whose `name` is
   exactly the repository Kargo matches (`<LOCAL_REGISTRY_URL>/hello-devops`,
   kept in sync with `base/deployment.yaml`).
2. **CI must not retrigger on promotion commits.** The workflow's path
   filter excludes `dev/` and `staging/`, so a Kargo commit cannot
   start a new build (which would produce a new `latest`, new Freight,
   and an infinite loop).
3. **The base image reference is the placeholder form** until both
   repositories replace `<LOCAL_REGISTRY_URL>` together.

## Credentials (later, on the infrastructure side, never committed)

If this repository is made **private**, Kargo needs a git-credential
`Secret` in the `hello-devops` namespace (cluster-side, created
manually following the infrastructure repo's `secrets/` pattern).
Public repositories need none. Either way:

- no token, username, or registry address is stored in this
  repository, and
- CI needs registry credentials only as GitHub secrets
  (see [container-registry.md](container-registry.md)) — Git
  credentials never appear in CI here, because CI never pushes to Git.

## Verifying (reference only — not executed)

```sh
# Kargo objects exist once the infra repo's manifests are applied
kubectl get project,warehouse,stage -n hello-devops

# Promotion (dev → staging) happens in the Kargo UI (NodePort 30090)
# or via the Kargo CLI; see the infrastructure repo's docs/kargo.md.
```

## Explicitly out of scope for this repository

- No Kargo `Project` / `Warehouse` / `Stage` / `PromotionPolicy` YAML.
- No registry URL, no repository URL, no credentials (placeholders live
  in the infrastructure repo; real values are set there at replace
  time).
- No promotion was run, and nothing was applied to the cluster.
