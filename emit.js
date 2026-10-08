// Kenwea Notary — turn the CLI's --json result into GitHub Action outputs and a job
// summary. Reads the result object on stdin. Never throws: a parse failure just
// yields empty outputs, because a broken summary must not mask the CLI's own exit
// code (which run.sh has already captured and will re-raise).
//
// Outputs come from the SIGNED payload, which the CLI has verified (exit codes 0
// and 1 mean it verified), never from the unsigned copy beside it. On exit code 4
// the record did not verify, so nothing from it is offered as an output.
const fs = require("fs");

const exitCode = Number(process.env.KENWEA_EXIT_CODE || "0");

let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  let j = {};
  try {
    j = JSON.parse(raw);
  } catch {
    j = {};
  }
  const verified = exitCode === 0 || exitCode === 1;
  let facts = {};
  if (verified && j.signedAttestation && typeof j.signedAttestation.payload === "string") {
    try {
      facts = JSON.parse(j.signedAttestation.payload);
    } catch {
      facts = {};
    }
  }
  // Text that came from the record is kept to one line, so it cannot add an output
  // line. (The output file and the summary are not read for workflow commands.)
  const clean = (v) => String(v ?? "").replace(/[\r\n\u0000-\u001f\u007f]+/g, " ");

  const outFile = process.env.GITHUB_OUTPUT;
  const set = (k, v) => {
    if (outFile) fs.appendFileSync(outFile, `${k}=${clean(v)}\n`);
  };

  const observed = facts.observed && typeof facts.observed === "object" ? facts.observed : {};
  const reached = [...(observed.dns || []), ...(observed.network || [])];
  set("verdict", facts.verdict || "");
  set("reason-code", facts.reasonCode || "");
  set("install-steps", Array.isArray(facts.installSteps) ? facts.installSteps.join(",") : "");
  set("reached", reached.join(","));
  set("sha256", facts.contentSha256 || "");
  set("checked", j.checked === false ? "false" : verified ? "true" : "false");
  set("signed", verified && facts.issuer === "kenwea.com" ? "true" : "false");
  set("exit-code", exitCode);

  const sumFile = process.env.GITHUB_STEP_SUMMARY;
  if (sumFile) {
    const meaning = {
      0: "checked and verified; no gate tripped",
      1: "a fail-on gate tripped",
      2: "the input was wrong",
      3: "no answer: not resolvable, not fetchable, refused or unreachable",
      4: "the record did NOT verify, so nothing in it should be relied on",
    };
    const lines = [
      "### Kenwea notary",
      "",
      `**result:** ${meaning[exitCode] || `exit code ${exitCode}`}`,
    ];
    if (verified && j.checked !== false) {
      lines.push(
        "",
        `**verdict:** \`${clean(facts.verdict) || "-"}\` (\`${clean(facts.reasonCode) || "-"}\`)`,
        "",
        j.verdictReason ? clean(j.verdictReason) : "",
        "",
        `- at install: ${Array.isArray(facts.installSteps) ? (facts.installSteps.length ? facts.installSteps.map(clean).join(", ") : "nothing runs") : "-"}`,
        `- reached: ${reached.length ? reached.map(clean).join(", ") : "nothing"}`,
        `- sha256: \`${clean(facts.contentSha256) || "-"}\``,
        `- signed: ed25519, key \`${clean(facts.keyId) || "-"}\`, verified in this runner against https://www.kenwea.com/.well-known/kenwea-attestation-keys.json`,
        "",
        "_The claim is about the sha256, not the URL — that address can serve something else tomorrow._",
      );
    } else if (j.checked === false) {
      lines.push("", `Not checked: ${clean(j.reason) || "no reason given"}`);
    }
    fs.appendFileSync(sumFile, lines.join("\n") + "\n");
  }
});
