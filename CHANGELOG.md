# Changelog

## v2.5.2 (2026-10-31)

The Action's description is shorter, so it fits the GitHub Marketplace's 125 character limit. Nothing about what the Action does changes.

## v2.5.1 (2026-10-31)

The Action now runs `@kenwea/mcp` 0.7.3 by default instead of 0.7.2.

When the notary accepts a connection and never answers, the check now gives up within about 15 seconds instead of about two and a half minutes, and the step fails with exit code 3 as before.

When the notary answers but Kenwea's published key list cannot be read, the step now exits 3 ("no answer") instead of 4 ("did not verify"), and the summary says the key list could not be read. Nothing was found wrong with the record in that case; it could not be checked. Both codes fail the step, and a gate still cannot pass on either. A record that does not verify against a key list that was read is still exit 4.

Nothing else changes. To keep 0.7.2, set `version: "0.7.2"`.

## Earlier versions

v1.0.0 to v2.5.0 are described in the commit message of each tag.
