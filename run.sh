#!/usr/bin/env bash
# Kenwea Notary — composite-action entrypoint.
#
# Runs the published @kenwea/mcp CLI in --json mode, sets step outputs and a job
# summary from the result, and propagates the CLI's exit code so `fail-on` actually
# gates the build. No logic about verdicts lives here -- the CLI decides and
# verifies, this shell only wires it to GitHub.
set -uo pipefail
# The pull request comment's token is kept out of the CLI's environment.
pr_token="${KENWEA_GITHUB_TOKEN:-}"
unset KENWEA_GITHUB_TOKEN

pkg="${KENWEA_PACKAGE:-}"
lock="${KENWEA_LOCKFILE:-}"
if [ -z "$pkg" ] && [ -z "$lock" ]; then
  echo "::error::kenwea-notary: give 'package' (one package) or 'lockfile' (a whole tree)" >&2
  exit 2
fi
if [ -n "$pkg" ] && [ -n "$lock" ]; then
  echo "::error::kenwea-notary: give 'package' or 'lockfile', not both" >&2
  exit 2
fi
ver="${KENWEA_MCP_VERSION:-0.6.0}"

# v1 passed the api-key input straight into KENWEA_API_KEY, so an empty input
# replaced a key the job had set in its own env with nothing. Only a non-empty
# input is exported now.
if [ -n "${KENWEA_INPUT_API_KEY:-}" ]; then
  export KENWEA_API_KEY="$KENWEA_INPUT_API_KEY"
fi

if [ -n "$lock" ]; then
  # The whole tree: the lockfile is read in the runner and only the packages it
  # marks hasInstallScript are sent. Packages not checked yet are queued, so the
  # step waits for them (wait input, seconds) before a gate can pass.
  args=(check-tree "$lock" --json --wait "${KENWEA_WAIT:-600}")
else
  args=(check "$pkg" --json)
fi
if [ -n "${KENWEA_FAIL_ON:-}" ]; then
  args+=(--fail-on "$KENWEA_FAIL_ON")
fi

# --json puts the result object on stdout and every progress line on stderr, so we
# capture stdout to parse while the log still shows what happened. Capturing the exit
# code separately is why this script does not use `set -e`: a non-zero exit from a
# tripped gate is an expected outcome we still need to report before re-raising.
result="$(npx -y "@kenwea/mcp@${ver}" "${args[@]}")"
code=$?

# npx itself can fail (the package not yet on the registry, a network error)
# with its own exit code 1, which reads exactly like "a gate tripped". With no
# result object there was no answer at all: say so, and exit 3.
case "$result" in
  "{"*) ;;
  *)
    echo "::error::kenwea-notary: the check produced no result (npx exit ${code}); nothing was checked" >&2
    result=""
    code=3
    ;;
esac

# Emit outputs and the summary whether or not the gate failed, so a later step can
# read the verdict even on a blocked build.
printf '%s' "$result" | KENWEA_EXIT_CODE="$code" node "${GITHUB_ACTION_PATH}/emit.js"

# The pull request comment (pr-comment: true, lockfile only): the base branch's
# lockfile is checked too, without gates and without waiting, and prdiff.js
# writes or updates one comment saying what changed. Anything that goes wrong
# here is a warning; it never changes the step's exit code.
if [ "${KENWEA_PR_COMMENT:-false}" = "true" ] && [ -n "$lock" ] && [ -n "$result" ]; then
  case "${GITHUB_EVENT_NAME:-}" in
    pull_request|pull_request_target)
      tmp="${RUNNER_TEMP:-/tmp}/kenwea-notary-pr"
      mkdir -p "$tmp/base"
      printf '%s' "$result" > "$tmp/head.json"
      basefile="$tmp/base/$(basename "$lock")"
      : > "$tmp/base.json"
      if git fetch --no-tags --depth=1 origin "${GITHUB_BASE_REF:-}" >/dev/null 2>&1 && git show "FETCH_HEAD:./$lock" > "$basefile" 2>/dev/null; then
        npx -y "@kenwea/mcp@${ver}" check-tree "$basefile" --json --wait 0 > "$tmp/base.json" 2>/dev/null || true
      else
        echo "kenwea-notary: the base branch has no ${lock}; every package counts as new"
      fi
      # The token reaches only this script, never the npx runs above.
      GITHUB_TOKEN="$pr_token" node "${GITHUB_ACTION_PATH}/prdiff.js" "$tmp/head.json" "$tmp/base.json" || true
      ;;
    *)
      echo "kenwea-notary: pr-comment is set but this is not a pull_request event; no comment"
      ;;
  esac
fi

exit "$code"
