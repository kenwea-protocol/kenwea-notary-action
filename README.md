# Kenwea Notary — GitHub Action

Notarize what an npm package does **when you install it** — a signed, third-party
sandbox record — as a step in your CI, and gate the build on it. Fetches the exact
tarball `npm install` would, runs the install steps npm would run in a container
with **no network, all capabilities dropped, a read-only filesystem and no root**,
traces what each step attempts, and hands back a record signed under a published
Ed25519 key and bound to the sha256 of the bytes it read. The record is **verified
in your runner** before any output is set: the signature against Kenwea's published
key list, and the tarball against the registry's `dist.integrity`.

It is a thin wrapper around the published [`@kenwea/mcp`](https://www.npmjs.com/package/@kenwea/mcp)
CLI (`npx -y @kenwea/mcp@0.3.0 check … --json`), so the Action and the tool can never
drift.

The equivalent that needs no action at all is one `run:` step:

```yaml
- run: npx -y @kenwea/mcp@0.3.0 check express@4.18.2 --fail-on install-scripts,network
```

## Usage

```yaml
- uses: kenwea-protocol/kenwea-notary-action@v2
  with:
    package: express@4.18.2
    fail-on: install-scripts,network   # optional: block on what the signed record says
```

Gate a matrix of dependencies, and read the record in a later step:

```yaml
jobs:
  notarize:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: [express@4.18.2, debug, "@scope/pkg@1.2.3"]
    steps:
      - id: notary
        uses: kenwea-protocol/kenwea-notary-action@v2
        with:
          package: ${{ matrix.package }}
          fail-on: network
      - if: ${{ steps.notary.outputs.install-steps != '' }}
        run: echo "${{ matrix.package }} runs at install: ${{ steps.notary.outputs.install-steps }}"
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `package` | yes | — | npm package (`name`, `name@version`, `@scope/name@version`) or an https URL. |
| `fail-on` | no | `""` | Gates that fail the step, comma separated (see below). Empty = report only. |
| `api-key` | no | `""` | A Kenwea API key, from a secret. Optional; without it the keyless notary is used (20 checks an hour per runner address). Left empty, it does not override a `KENWEA_API_KEY` the job sets itself. |
| `version` | no | `0.3.0` | Version of the `@kenwea/mcp` CLI to run, pinned so a new release never changes your build without a change here. |

## Gates

| Gate | Fails when the signed record says |
| --- | --- |
| `install-scripts` | the package runs anything at install |
| `network` | an install step tried to reach the network, or the steps did not finish, so the record cannot say |
| `manual_review` | the verdict is `manual_review` or `rejected` |
| `rejected` | the verdict is `rejected` |

A gate fails closed: no answer, or an answer that does not verify, never passes it.
For npm packages `rejected` alone is close to a no-op — a package's verdict is
`approved` or `manual_review` — so gate on `install-scripts` or `network`. (In v1,
`fail-on: rejected` was the documented example and never fired for npm.)

## Outputs

All of them come from the signed, verified record, never from the unsigned copy.

| Output | Description |
| --- | --- |
| `verdict` | `approved` \| `manual_review` \| `rejected` \| `notarized` (empty when not checked or not verified). |
| `reason-code` | Why, as a code: `ran_ok`, `ran_tried_network`, `no_install_steps`, `install_step_failed`, `step_timed_out`, … |
| `install-steps` | What runs at install, comma separated; empty when nothing does. |
| `reached` | Addresses and DNS names the install steps tried to reach; empty when none. |
| `sha256` | sha256 of the exact bytes that were checked. |
| `checked` | `true` if a verified record was produced. |
| `signed` | `true` if the record is signed and verified in the runner. |
| `exit-code` | `0` ok, `1` a gate tripped, `2` bad input, `3` no answer, `4` did not verify. |

Each run also writes a **job summary** with the result, the verdict and its reason,
what runs at install, what it reached, the hash and the key it verified under.

## What the verdicts mean

- **`approved`** — every install step ran to completion, the trace was whole, and
  none tried to reach the network. Not a statement that the package is good or safe
  for your use; a script written to notice the tracer can stay quiet.
- **`manual_review`** — anything else: nothing ran (no install step), a step failed
  (often for want of a dependency we deliberately did not install), our limit
  stopped it, or it tried to reach the network. The reason code says which.
- **`rejected`** — a file that ran and exited non-zero, or carries a
  provider-formatted credential.
- **`notarized`** — a media file; not code, so not executed, just a signed record of
  the bytes.

## Migrating from v1

- `fail-on: rejected` → `fail-on: install-scripts` or `fail-on: network`, which
  are what a package record can actually say.
- An unanswered or unverifiable check now fails a gated step instead of passing it.
- `api-key` left empty no longer blanks a `KENWEA_API_KEY` set on the job.
- The CLI version is pinned (`0.3.0`) instead of `latest`.

## The claim is about the hash, not the name

A signed record says *these exact bytes did this*. A version tag can be re-pointed;
rely on `sha256`, not the name. Anyone can check the signature at
<https://www.kenwea.com/verify> or with their own code
(<https://www.kenwea.com/guides/verify-a-signed-package-verdict>) — it needs nothing
from us.

## Scope, honestly

Node and Python execution, npm tarballs and single files, media notarization, 20
checks per hour per address. Dependencies are **not** installed, so this measures a
package's *own* install steps, not its full transitive closure. A quiet install step
says nothing about what the package does the first time you import it.

MIT licensed. Part of [Kenwea](https://www.kenwea.com).
