#!/bin/sh
# SubagentStop ^jeyna:jeyna-tester$: block a tester once if one of its cases has no verdict (D2, F9.2).
# Its cases come from the marker line `jeyna-tester-cases: <ids>` that opens its prompt, read from
# agent_transcript_path. No running run: no-op. While a run is running, each call is logged to the
# run's hooks.log with the observed agent_type (P6). Reading session.json here is fine: only the
# server writes it, by rename, so a reader never sees half a file (D11).
exec node -e '
const fs = require("fs"), path = require("path"), os = require("os");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const dir = path.join(root, ".jeyna", "playtests");
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return undefined; } };
const runs = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  .map((d) => ({ dir: path.join(dir, d), s: read(path.join(dir, d, "session.json")) }))
  .filter((r) => r.s?.status === "running");
if (!runs.length) process.exit(0);

// The transcript format is internal to Claude Code: the spawn prompt is the first user record whose
// content is a string (or text blocks). Later string records are system reminders, so stop at the first.
let prompt = "";
try {
  const t = String(input.agent_transcript_path ?? "").replace(/^~(?=\/|$)/, os.homedir());
  for (const line of fs.readFileSync(t, "utf8").split("\n")) {
    const r = line.trim() && JSON.parse(line);
    const c = r?.type === "user" ? r.message?.content : undefined;
    if (typeof c === "string") { prompt = c; break; }
    if (Array.isArray(c) && c.some((b) => b.type === "text")) { prompt = c.filter((b) => b.type === "text").map((b) => b.text).join("\n"); break; }
  }
} catch {}
const marker = prompt.match(/^jeyna-tester-cases:(.*)$/m);
const mine = marker ? marker[1].split(/[\s,]+/).filter(Boolean) : [];

const run = runs.find((r) => mine.some((id) => r.s.cases?.some((c) => c.id === id))) ?? runs[0];
const done = new Set((run.s.verdicts ?? []).map((v) => v.case));
const missing = mine.filter((id) => run.s.cases?.some((c) => c.id === id) && !done.has(id));
const decision = !marker ? "allow (no marker)" : !missing.length ? "allow" : input.stop_hook_active ? "allow (stop_hook_active)" : "block";
fs.appendFileSync(path.join(run.dir, "hooks.log"),
  `${new Date().toISOString()} SubagentStop agent_type=${input.agent_type} agent_id=${input.agent_id} cases=${mine.join(",")} missing=${missing.join(",")} ${decision}\n`);
if (decision === "block") console.log(JSON.stringify({ decision: "block",
  reason: `Jeyna: no verdict yet for ${missing.join(", ")}. Call scenario_verdict for each (result pass, fail, blocked or skipped; blocked and skipped need a note), then finish.` }));
'
