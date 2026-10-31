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

  if (Array.isArray(j.results)) return emitTree(j, exitCode, set, clean);

  const observed = facts.observed && typeof facts.observed === "object" ? facts.observed : {};
  const reached = [...(observed.dns || []), ...(observed.network || [])];
  set("verdict", facts.verdict || "");
  set("level", facts.level || "");
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
      3: "no answer: not resolvable, not fetchable, refused or unreachable, or Kenwea's published key list could not be read",
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

// A whole tree (check-tree --json): one row per package that runs something at
// install, from the facts the CLI verified.
function emitTree(j, exitCode, set, clean) {
  const order = ["sends_credentials", "reads_credentials", "network", "unfinished", "quiet", "nothing_runs"];
  const rows = j.results;
  const answered = rows.filter((r) => r.facts && typeof r.facts === "object");
  const levels = answered.map((r) => r.facts.level || "unfinished");
  const worst = order.find((l) => levels.includes(l)) || (answered.length ? "quiet" : "");
  const findings = answered.filter((r) => ["network", "reads_credentials", "sends_credentials"].includes(r.facts.level));
  // A covered package is answered by the direct dependency that covers it.
  const pending = rows.filter((r) => r.status !== "answered" && r.status !== "unverified" && r.status !== "covered");
  set("level", worst);
  set("findings", findings.length);
  set("pending", pending.length);
  set("checked", answered.length ? "true" : "false");
  set("signed", exitCode === 0 || exitCode === 1 ? "true" : "false");
  set("exit-code", exitCode);
  const sumFile = process.env.GITHUB_STEP_SUMMARY;
  if (!sumFile) return;
  const lines = ["### Kenwea notary: dependency tree", "",
    `${clean(j.packages)} packages; ${clean(j.packages - j.runSomething)} run nothing of their own at install (the lockfile says so; their names stayed in the runner, except your direct dependencies'). ${clean(j.runSomething)} run something.`,
    j.checkedThrough === "direct_dependencies"
      ? "Checked through your direct dependencies, each with its whole tree, so a step runs under the package that pulled it in."
      : "The lockfile does not say which packages are your own, so each was checked on its own; a step that acts only under its parent can look quiet.",
    "",
    "| package | level | status |", "| --- | --- | --- |"];
  const rank = (r) => order.indexOf(r.facts ? r.facts.level : "unfinished");
  for (const r of [...rows].sort((a, b) => rank(a) - rank(b))) {
    const status = r.status === "covered" ? `covered, run inside \`${clean(r.coveredBy)}\`` : clean(r.status);
    lines.push(`| \`${clean(r.name)}@${clean(r.version)}\` | ${r.facts ? `\`${clean(r.facts.level)}\`` : "-"} | ${status} |`);
  }
  lines.push("", "_Each record is signed and was verified in this runner against https://www.kenwea.com/.well-known/kenwea-attestation-keys.json, including that it is about the bytes your lockfile installs._");
  fs.appendFileSync(sumFile, lines.join("\n") + "\n");
}
