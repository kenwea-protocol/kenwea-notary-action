// Kenwea Notary — the pull request comment (2026-10-29).
//
// On a pull request the lockfile is checked twice: as the base branch has it and
// as the pull request has it. This compares the two check-tree --json results and
// writes, or updates, one comment on the pull request saying which packages that
// run something at install changed, and what their records show differently: a
// new version, a level that went up, a host first reached, a decoy credential
// opened or sent, a new install step.
//
// Usage: node prdiff.js <head.json> <base.json>
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH, GITHUB_API_URL;
// KENWEA_PR_DRY=1 prints the comment instead of posting it.
//
// Never throws and never changes the step's exit code: a comment that could not
// be written is a warning, the gate is run.sh's business.
const fs = require("fs");

const MARKER = "<!-- kenwea-notary-pr -->";
const ORDER = { nothing_runs: 0, quiet: 1, network: 2, reads_credentials: 3, contains_credential: 3, sends_credentials: 4 };

function readJSON(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);

// One record, as much of it as the comparison needs.
function summary(row) {
  const f = row.facts && typeof row.facts === "object" ? row.facts : null;
  const coveredBy = row.status === "covered" ? String(row.coveredBy || "") : "";
  if (!f) return { version: String(row.version || ""), status: String(row.status || ""), known: false, coveredBy };
  const hostsOf = (o) => {
    const out = new Set();
    if (!o || typeof o !== "object") return out;
    for (const h of [...list(o.dns), ...list(o.network)]) out.add(h);
    for (const r of list(o.requests)) {
      const m = /(?:to |https?:\/\/)([A-Za-z0-9.\-[\]:]+?)(?::\d+)?(?:[/\s(]|$)/.exec(r);
      if (m) out.add(m[1]);
    }
    return out;
  };
  const read = new Set();
  const sent = new Set();
  for (const o of [f.observed, f.load && f.load.observed]) {
    if (!o || typeof o !== "object") continue;
    for (const c of list(o.credentialsRead)) read.add(c);
    for (const c of list(o.credentialsSent)) sent.add(c);
  }
  const own = list(f.installSteps);
  const deps = list(f.dependencies && f.dependencies.installSteps);
  // A dependency step without its version: a dependency that moved on is not a new step.
  const steps = new Set([...own, ...deps.map((s) => s.replace(/^((?:@[^/@\s]+\/)?[^@\s]+)@\S+/, "$1"))]);
  return {
    version: String(row.version || ""), status: String(row.status || ""), known: true, level: String(f.level || "unfinished"),
    installHosts: hostsOf(f.observed), loadHosts: hostsOf(f.load && f.load.observed), read, sent, steps,
    // The exact install code: no step of its own and these dependency steps at these versions.
    installCode: own.length ? "" : [...deps].sort().join("\n"),
  };
}

function byName(result) {
  const out = new Map();
  for (const row of (result && Array.isArray(result.results) ? result.results : [])) {
    if (row && typeof row.name === "string") out.set(row.name, summary(row));
  }
  return out;
}

const minus = (a, b) => [...a].filter((x) => !b.has(x)).sort();

// What changed for one package between base and head, or null when nothing a
// reviewer should see did.
function change(name, base, head) {
  if (!head) return { name, kind: "removed", base };
  const inside = head.coveredBy ? [`run inside ${code(head.coveredBy)}'s record`] : null;
  if (!base) return { name, kind: "added", head, notes: head.known ? describe(null, head) : inside || ["no record yet"] };
  if (base.version === head.version) return null;
  if (!head.known) return { name, kind: "changed", base, head, notes: inside || ["no record of this version yet"] };
  if (!base.known) return { name, kind: "changed", base, head, notes: ["no record of the base version to compare with"] };
  const notes = describe(base, head);
  return { name, kind: "changed", base, head, notes };
}

function describe(base, head) {
  const notes = [];
  const empty = { installHosts: new Set(), loadHosts: new Set(), read: new Set(), sent: new Set(), steps: new Set(), installCode: "" };
  const b = base || empty;
  const sent = minus(head.sent, b.sent);
  const read = minus(head.read, b.read);
  const atInstall = minus(head.installHosts, b.installHosts);
  const onLoad = minus(head.loadHosts, b.loadHosts);
  const steps = minus(head.steps, b.steps);
  // The same install code ran in both (no step of its own, the same dependency
  // steps at the same versions): a host only one run reached at install is a
  // difference between runs, not a change (swagger-ui-express 5.0.0 and 5.0.1,
  // @scarf/scarf 1.4.0, 2026-10-29). Said, but not counted.
  const sameCode = Boolean(base && head.installCode && head.installCode === b.installCode);
  const hosts = sameCode ? onLoad : [...new Set([...atInstall, ...onLoad])].sort();
  if (sent.length) notes.push(`tries to send ${sent.map(code).join(", ")} (our decoys)`);
  if (read.length) notes.push(`opens ${read.map(code).join(", ")} (our decoys)`);
  if (hosts.length) notes.push(`reaches ${hosts.map(code).join(", ")}`);
  if (steps.length) notes.push(`runs ${steps.map(code).join(", ")} at install`);
  const counted = notes.length > 0;
  if (base && counted && (ORDER[head.level] ?? -1) > (ORDER[b.level] ?? 99)) notes.unshift(`level up from ${code(b.level)}`);
  if (sameCode && atInstall.length) notes.push(`(reached ${atInstall.map(code).join(", ")} at install in one run only; the same install code ran in both, so this varies between runs)`);
  return notes;
}

// Everything from a record goes inside a code span: it cannot ping anyone
// (@scope/name), open a link or break the table.
function code(s) {
  const t = String(s ?? "").replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").replace(/`/g, "'").replace(/\|/g, "/").slice(0, 200);
  return "`" + t + "`";
}

function rowFor(c) {
  const lvl = (s) => (s && s.known ? `${code(s.version)} ${code(s.level)}` : s ? `${code(s.version)} -` : "-");
  if (c.kind === "removed") return `| ${code(c.name)} | ${lvl(c.base)} | removed | |`;
  return `| ${code(c.name)} | ${c.kind === "added" ? "not in base" : lvl(c.base)} | ${lvl(c.head)} | ${c.notes.length ? c.notes.join("; ") : "no difference in the records"} |`;
}

function render(head, base) {
  const h = byName(head);
  const b = byName(base);
  const changes = [];
  for (const name of new Set([...h.keys(), ...b.keys()])) {
    const c = change(name, b.get(name), h.get(name));
    if (c) changes.push(c);
  }
  // What a reviewer should read first: added or changed with something to say.
  const weight = (c) => (c.kind === "removed" ? 2 : c.notes && c.notes.length && !/^(no record|run inside|\(reached)/.test(c.notes[0]) ? 0 : 1);
  changes.sort((x, y) => weight(x) - weight(y) || x.name.localeCompare(y.name));
  const lines = [MARKER, "### Kenwea notary: packages that run something at install", ""];
  if (!changes.length) {
    lines.push("None of the packages that run something at install changed in this pull request.");
  } else {
    const flagged = changes.filter((c) => weight(c) === 0).length;
    lines.push(
      `${changes.length} changed in this pull request${flagged ? `; ${flagged} with something new in the notary's record, listed first` : ""}.`,
      "",
      "| package | base | this pull request | what the head record shows that the base record does not |",
      "| --- | --- | --- | --- |",
      ...changes.slice(0, 60).map(rowFor),
    );
    if (changes.length > 60) lines.push("", `And ${changes.length - 60} more; the job summary has the whole tree.`);
  }
  lines.push(
    "",
    "_Each record is signed and was verified in this runner against https://www.kenwea.com/.well-known/kenwea-attestation-keys.json. A difference between two records is a lead, not a verdict: two runs can differ for the sandbox's reasons too._",
  );
  return lines.join("\n");
}

async function post(body) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  const event = readJSON(process.env.GITHUB_EVENT_PATH || "");
  const pr = event && event.pull_request && event.pull_request.number;
  if (!token || !repo || !pr) {
    console.log("::warning::kenwea-notary: pr-comment needs a pull_request event and a token; no comment written");
    return;
  }
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "kenwea-notary-action" };
  const base = `${api}/repos/${repo}/issues/${pr}/comments`;
  let existing = null;
  for (let page = 1; page <= 10 && !existing; page++) {
    const r = await fetch(`${base}?per_page=100&page=${page}`, { headers });
    if (!r.ok) throw new Error(`listing comments: HTTP ${r.status}`);
    const items = await r.json();
    existing = items.find((c) => typeof c.body === "string" && c.body.startsWith(MARKER)) || null;
    if (items.length < 100) break;
  }
  // Nothing to say and nothing said before: stay quiet.
  if (!existing && body.includes("None of the packages that run something at install changed")) return;
  const url = existing ? `${api}/repos/${repo}/issues/comments/${existing.id}` : base;
  const r = await fetch(url, { method: existing ? "PATCH" : "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
  if (!r.ok) throw new Error(`${existing ? "updating" : "writing"} the comment: HTTP ${r.status}${r.status === 403 ? " (give the job permissions: pull-requests: write)" : ""}`);
}

if (require.main === module) {
  const head = readJSON(process.argv[2] || "");
  const base = readJSON(process.argv[3] || "");
  if (!head || !Array.isArray(head.results)) {
    console.log("::warning::kenwea-notary: no tree result for this pull request; no comment written");
  } else {
    const body = render(head, base);
    if (process.env.KENWEA_PR_DRY === "1") {
      console.log(body);
    } else {
      post(body).catch((e) => console.log(`::warning::kenwea-notary: the pull request comment was not written: ${String(e && e.message ? e.message : e)}`));
    }
  }
}

module.exports = { render, change, summary, code, MARKER };
