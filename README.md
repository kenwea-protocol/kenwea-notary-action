# Kenwea Notary — GitHub Action

Notarize what an npm package does **when you install it** — a signed, third-party
sandbox verdict — as a step in your CI. Fetches the exact tarball `npm install`
would, runs its declared `preinstall`/`install`/`postinstall` scripts in a container
with **no network, all capabilities dropped, and a read-only filesystem**, and hands
back a verdict signed under a published Ed25519 key and bound to the sha256 of the
bytes it read.

It is a thin wrapper around the published [`@kenwea/mcp`](https://www.npmjs.com/package/@kenwea/mcp)
CLI (`npx -y @kenwea/mcp check … --json`), so the Action and the tool can never
drift.

## Usage

```yaml
- uses: kenwea-protocol/kenwea-notary-action@v1
  with:
    package: express@4.18.2
    fail-on: rejected            # optional: fail the build on a rejected verdict
  env:
    KENWEA_API_KEY: ${{ secrets.KENWEA_API_KEY }}   # optional; without it the keyless notary is used
```

Prefer no action at all? The equivalent one-liner works today:

```yaml
- run: npx -y @kenwea/mcp check express@4.18.2 --fail-on rejected
```

Gate a matrix of dependencies, and read the verdict in a later step:

```yaml
jobs:
  notarize:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: [express@4.18.2, debug, "@scope/pkg@1.2.3"]
    steps:
      - id: notary
        uses: kenwea-protocol/kenwea-notary-action@v1
        with:
          package: ${{ matrix.package }}
          fail-on: rejected
      - if: ${{ steps.notary.outputs.verdict == 'manual_review' }}
        run: echo "::warning::${{ matrix.package }} needs a human look — nothing ran at install, but that is not a pass"
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `package` | yes | — | npm package (`name`, `name@version`, `@scope/name@version`) or an https URL. |
| `fail-on` | no | `""` | Fail the step when the verdict is at or past this level: `manual_review` or `rejected`. Empty = report only; the step passes and you read the verdict from the output. |
| `api-key` | no | `""` | `KENWEA_API_KEY`. Optional. Without it the check goes to the keyless notary (20 checks an hour per runner address). Set it from a secret to use a key's own quota. |
| `version` | no | `latest` | Version of the `@kenwea/mcp` CLI to run. |

## Outputs

| Output | Description |
| --- | --- |
| `verdict` | `approved` \| `manual_review` \| `rejected` \| `notarized` (empty when not checked). |
| `sha256` | sha256 of the exact bytes that were checked. |
| `checked` | `true` if a verdict was produced, `false` for an honest non-answer (could not fetch). |
| `signed` | `true` if the result carries a signed attestation. |

Each run also writes a **job summary** with the verdict, its reason, the hash, and how
to verify the signature.

## What the verdicts mean

- **`approved`** — it ran and exited zero.
- **`rejected`** — it ran and exited non-zero, or carries a provider-formatted credential.
- **`manual_review`** — nothing ran (no install script, or a file we could not
  execute, or a dependency we deliberately did not install), so it cannot be cleared.
  *Nothing ran is information, not a pass.*
- **`notarized`** — a media file; not code, so not executed, just a signed record of
  the bytes.

`fail-on rejected` blocks only on `rejected`; `fail-on manual_review` also blocks on
`manual_review`. An honest non-answer (`checked: false`) never fails the gate —
turning "we could not read it" into a red build is the one thing this tool refuses.

## The claim is about the hash, not the name

A signed verdict says *these exact bytes did this*. A version tag can be re-pointed;
verify against `sha256`, not the name. The signature is checkable by anyone at
<https://www.kenwea.com/verify> or with the recipe in the
[`@kenwea/mcp` README](https://www.npmjs.com/package/@kenwea/mcp) — it needs nothing
from us.

## Scope, honestly

Node and Python execution, npm tarballs and single files, media notarization, 20
checks per hour. Dependencies are **not** installed, so this measures a package's
*own* declared install behaviour, not its full transitive closure — the install-time
surface npm runs from the package itself. A clean install script says nothing about
what the package does the first time you import it.

MIT licensed. Part of [Kenwea](https://www.kenwea.com).
