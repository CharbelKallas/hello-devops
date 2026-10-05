# Argo CD — Application Side of the Contract

**Where Argo CD itself is configured: the infrastructure repository**
(`local-server`), not this one. The `Application` objects live in
`local-server/kubernetes/argocd/applications/`; Argo CD's installation,
its UI, and its credentials are platform concerns there.

This document records **what Argo CD expects from `hello-devops`** —
i.e. what must stay true in this repository — and how to verify the
result. Nothing here has been executed (`kubectl` was never run).

## Status

- Configuration/documentation only: no Argo CD `Application`, no
  Argo CD Helm values, no cluster credentials, and no Argo CD config of
  any kind exist in this repository.
- The infrastructure repository still carries the placeholders
  `<HELLO_DEVOPS_GIT_REPOSITORY_URL>` and
  `<HELLO_DEVOPS_GIT_REPOSITORY_BRANCH>`; they are replaced there (with
  this repository's clone URL and branch, commonly `main`), never here.

## The two Applications (defined in the infrastructure repo)

| Application | Source path in **this** repo | Destination namespace | Sync |
|---|---|---|---|
| `hello-devops-dev` | `dev` (repository root) | `hello-devops-dev` | automated, prune + selfHeal, `CreateNamespace=true` |
| `hello-devops-staging` | `staging` (repository root) | `hello-devops-staging` | automated, prune + selfHeal, `CreateNamespace=true` |

Both point at this repository through the placeholders
`<HELLO_DEVOPS_GIT_REPOSITORY_URL>` (clone URL) and
`<HELLO_DEVOPS_GIT_REPOSITORY_BRANCH>` (branch, commonly `main`).

## What this repository must guarantee

1. **`dev/` and `staging/` exist at the repository root**, each with a
   `kustomization.yaml` whose `resources` include `../base`. This is
   the entire directory contract — Argo CD renders exactly those paths.
2. **`namespace:` in each overlay matches the Application's
   destination namespace** (`hello-devops-dev` /
   `hello-devops-staging`) — they are kept identical on purpose so the
   manifests are also correct under a plain `kubectl kustomize … | kubectl apply -f -`.
3. **The base image repository stays `<LOCAL_REGISTRY_URL>/hello-devops`**
   (see [container-registry.md](container-registry.md)) so promotions
   render a valid image reference.
4. **Env directories are writable by Kargo, not hand-edited.**
   `dev/` and `staging/` change when Kargo commits a promoted digest
   (and CI deliberately ignores those paths). Merge conflicts in those
   two files should be resolved by keeping Kargo's `images:` entry.

## Interaction with automated sync (prune + selfHeal)

- **selfHeal** reverts *cluster* drift back to what is in Git. It does
  not fight Kargo: Kargo changes *Git*, and Argo CD follows Git.
- **prune** deletes resources that disappear from the rendered
  manifests of *this* Application. Anything applied manually to those
  namespaces **without** Argo CD's tracking label is not managed and
  therefore not pruned — that is why `base/secret.example.yaml` is
  documentation only and the real `hello-devops-secret` is created
  manually (see its header comment).
- A failed readiness state (`/ready` → 503 while a database is down)
  is *not* a sync failure: the pods simply stay `NotReady` until the
  databases answer.

## Verifying (reference only — not executed)

```sh
# Applications exist once the infra repo's manifests are applied
kubectl get applications -n argocd

# Argo CD UI: NodePort 30080 (see the infrastructure repo's docs/argocd.md)
# Then check the sync status of hello-devops-dev / hello-devops-staging.
```

## Explicitly out of scope for this repository

- No `Application` / `ApplicationSet` / `AppProject` YAML.
- No cluster credentials or repository credential `Secret`s (if this
  repository becomes private, the two credential Secrets belong to the
  infrastructure side, created manually — never committed).
- No Argo CD installation or upgrade.
