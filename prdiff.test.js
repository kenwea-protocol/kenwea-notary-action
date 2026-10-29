// node --test prdiff.test.js
// Rows have the shape check-tree --json returned on 2026-10-29 for two real
// lockfiles (base: puppeteer 25.15.0, swagger-ui-express 5.0.0; head: 25.16.0,
// 5.0.1 and esbuild 0.28.2).
const test = require("node:test");
const assert = require("node:assert/strict");
const { render, MARKER } = require("./prdiff.js");

const row = (name, version, facts, extra = {}) => ({ name, version, status: facts ? "answered" : "covered", facts, ...extra });
const scarf = (level, dns) => ({ level, installSteps: [], observed: { dns, network: [], programs: ["node", "npm"] }, load: { observed: { dns: [] } }, dependencies: { installSteps: ["@scarf/scarf@1.4.0 postinstall"] } });
const base = { results: [
  row("puppeteer", "25.15.0", { level: "quiet", installSteps: ["postinstall"], observed: { dns: [] } }),
  row("swagger-ui-express", "5.0.0", scarf("quiet", [])),
  row("@scarf/scarf", "1.4.0", null, { coveredBy: "swagger-ui-express@5.0.0" }),
] };
const head = { results: [
  row("esbuild", "0.28.2", { level: "quiet", installSteps: ["postinstall"], observed: { dns: [] } }),
  row("puppeteer", "25.16.0", { level: "network", installSteps: ["postinstall"], observed: { dns: ["storage.googleapis.com"], requests: ["TLS to storage.googleapis.com:443 (1599 bytes sent, encrypted)"] } }),
  row("swagger-ui-express", "5.0.1", scarf("network", ["scarf.sh"])),
  row("@scarf/scarf", "1.4.0", null, { coveredBy: "swagger-ui-express@5.0.1" }),
] };

test("a changed version lists what its record shows that the base record does not", () => {
  const body = render(head, base);
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /3 changed in this pull request; 2 with something new/);
  assert.match(body, /\| `puppeteer` \| `25\.15\.0` `quiet` \| `25\.16\.0` `network` \| level up from `quiet`; reaches `storage\.googleapis\.com` \|/);
  assert.match(body, /\| `esbuild` \| not in base \| `0\.28\.2` `quiet` \| runs `postinstall` at install \|/);
});

test("the same install code reaching a host in one run only is said, not counted", () => {
  const body = render(head, base);
  assert.match(body, /`swagger-ui-express` .*\(reached `scarf\.sh` at install in one run only; the same install code ran in both, so this varies between runs\)/);
  assert.doesNotMatch(body, /`swagger-ui-express` .*level up/);
  // Change only the dependency's version and it counts.
  const bumped = JSON.parse(JSON.stringify(head));
  bumped.results[2].facts.dependencies.installSteps = ["@scarf/scarf@1.4.1 postinstall"];
  assert.match(render(bumped, base), /`swagger-ui-express` .*level up from `quiet`; reaches `scarf\.sh`/);
});

test("nothing changed says so; an identical tree has no rows", () => {
  const body = render(head, head);
  assert.match(body, /None of the packages that run something at install changed/);
  assert.doesNotMatch(body, /\| package \|/);
});

test("text from a record cannot ping, link or break the table", () => {
  const evil = { results: [row("@team/x`|[a](http://evil)", "1.0.0", { level: "network", installSteps: [], observed: { dns: ["@everyone|`x`\n- [ ] y"] } })] };
  const body = render(evil, { results: [] });
  const line = body.split("\n").find((l) => l.includes("team"));
  assert.equal((line.match(/\|/g) || []).length, 5, "a row keeps its five column bars");
  assert.ok(!/(^|[^`])@everyone/.test(line.replace(/`[^`]*`/g, "")), "no mention outside a code span");
  assert.ok(!body.includes("\n- [ ] y"), "no new line from a record");
});
