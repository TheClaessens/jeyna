// Jeyna studio sidecar: watches .jeyna/, reads every run with the server's own validate.ts and every feedback item
// with feedback.ts, keeps a derived .jeyna/index.json, serves evidence and captures as files and pushes the index over
// SSE to the UI in plugin/studio/. It never writes under playtests/ and never drops a file it cannot parse (the UI shows
// those as needs attention). It writes only feedback items, under .jeyna/feedback/, on the UI's request (D36).
// Usage: node jeyna-studio.mjs [--project <root>] [--port 4710]
import { createReadStream, existsSync, readdirSync, readFileSync, renameSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Root } from "mdast";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Config } from "../schema.js";
import { createFeedback, deleteFeedback, FEEDBACK_STATUSES, feedbackFile, NewFeedback, readFeedback, updateFeedback } from "../feedback.js";
import { findProjectRoot, runDirOf, splitFront } from "../shared.js";
import { type Finding, previousRun, readFindings, readSession, since, validateRun } from "../validate.js";
import type { StudioFinding, StudioIndex, StudioRun } from "./types.js";
import { liveWindow } from "./window.js";

const log = (...a: unknown[]) => console.error(new Date().toISOString(), ...a);

const { values } = parseArgs({ options: { project: { type: "string" }, port: { type: "string" } }, strict: false });
const root = findProjectRoot(values.project, process.env.CLAUDE_PROJECT_DIR);
const jeyna = join(root, ".jeyna");
const playtests = join(jeyna, "playtests");
const indexFile = join(jeyna, "index.json");
const assets = dirname(fileURLToPath(import.meta.url));

// --- Markdown bodies → one HTML string per `## section`, through remark (the viewer's only markdown parser, concept §Constraints).
const markdown = unified().use(remarkParse);
const html = unified().use(remarkRehype).use(rehypeStringify);

// Image and link targets written relative to findings/ (../evidence/x.png) become studio URLs.
function rewriteUrls(node: { type: string; url?: string; children?: unknown[] }, runId: string) {
  if ((node.type === "image" || node.type === "link") && node.url?.startsWith("../evidence/")) {
    node.url = `/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(node.url.slice("../evidence/".length))}`;
  }
  for (const c of node.children ?? []) rewriteUrls(c as typeof node, runId);
}

function sections(body: string, runId: string): Record<string, string> {
  const tree = markdown.parse(body) as Root;
  rewriteUrls(tree as never, runId);
  const out: Record<string, string> = {};
  let name = "";
  let nodes: Root["children"] = [];
  const flush = () => {
    if (name) out[name] = html.stringify(html.runSync({ type: "root", children: nodes }) as never);
  };
  for (const node of tree.children) {
    if (node.type === "heading" && node.depth === 2) {
      flush();
      name = node.children.map((c) => ("value" in c ? c.value : "")).join("");
      nodes = [];
    } else if (node.type === "heading" && node.depth === 1) {
      continue; // the title, shown by the UI from Finding.title
    } else {
      nodes.push(node);
    }
  }
  flush();
  return out;
}

const toStudioFinding = (runId: string) => (f: Finding): StudioFinding => ({
  ...f,
  sections: f.front ? sections(splitFront(f.source)?.[2] ?? "", runId) : {},
});

// --- The index: every run folder, read with the same code as `validate` (F8.1).
function scanRun(dir: string): StudioRun {
  const id = basename(dir);
  let session = null;
  let sessionError: string | undefined;
  try {
    session = readSession(dir);
  } catch (e) {
    sessionError = (e as Error).message;
  }
  // With no readable session the case check cannot run; the files still list, so nothing is dropped.
  const findings = readFindings(dir, session ?? { cases: [] } as never).map(toStudioFinding(id));
  return {
    id,
    session,
    ...(sessionError && { sessionError }),
    errors: validateRun(dir),
    since: session ? since(session, previousRun(dir, session)) ?? null : null,
    report: existsSync(join(dir, "report.md")),
    findings,
  };
}

function readApp(): StudioIndex["app"] {
  try {
    const c = Config.parse(parseYaml(readFileSync(join(jeyna, "jeyna.config.yaml"), "utf8")));
    return { name: c.app.name, url: c.app.url };
  } catch {
    return null;
  }
}

function scan(): StudioIndex {
  const runs = existsSync(playtests)
    ? readdirSync(playtests)
        .filter((d) => statSync(join(playtests, d)).isDirectory())
        .map((d) => scanRun(join(playtests, d)))
    : [];
  runs.sort((a, b) => (b.session?.started ?? "").localeCompare(a.session?.started ?? "") || b.id.localeCompare(a.id));
  return { schema: 1, generated: new Date().toISOString(), root, app: readApp(), runs, feedback: readFeedback(root), window: live?.state() ?? CLOSED };
}

// --- The Live window (D37), made on first open for the app.url of that moment.
const CLOSED = { open: false, url: null, openedAt: null, capturing: false, recording: false };
let live: ReturnType<typeof liveWindow> | undefined;
let liveFor = "";
function windowFor(app: string) {
  if (live && liveFor !== app && !live.state().open) live = undefined; // app.url changed while the window was closed
  liveFor = app;
  return (live ??= liveWindow({ root, app, script: readFileSync(join(assets, "overlay.js"), "utf8"), onChange: () => changed() }));
}

let index = scan();
let payload = JSON.stringify(index);

// Derived cache beside playtests/, written like session.json (temp + rename). Gitignored by /jeyna:init.
function writeIndex() {
  try {
    writeFileSync(`${indexFile}.tmp`, payload + "\n");
    renameSync(`${indexFile}.tmp`, indexFile);
  } catch (e) {
    log("index.json not written:", (e as Error).message);
  }
}

// --- Watch. fs.watch is recursive on macOS, Windows and Linux from Node 20 on, so no watcher dependency.
// ponytail: any event rescans every run; per-run rescans if a project ever holds hundreds of them.
const clients = new Set<ServerResponse>();
let timer: NodeJS.Timeout | undefined;
function rescan() {
  clearTimeout(timer);
  index = scan();
  payload = JSON.stringify(index);
  writeIndex();
  for (const res of clients) res.write(`event: index\ndata: ${payload}\n\n`);
  log(`rescanned: ${index.runs.length} runs, ${index.feedback.length} feedback, ${clients.size} clients`);
}
function changed() {
  clearTimeout(timer);
  timer = setTimeout(rescan, 150);
}

// One recursive watch on .jeyna/ covers playtests/ (even before it exists) and feedback/. index.json is ours, and
// chrome-profile/ is the Live window's, which Chrome writes to all the time: both ignored.
let watcher: FSWatcher | undefined;
function startWatch() {
  watcher = watch(jeyna, { recursive: true }, (_, file) => {
    const f = String(file ?? "");
    if (!f.startsWith("index.json") && !f.startsWith("chrome-profile")) changed();
  });
  log("watching", jeyna);
}

// --- HTTP: the API, evidence files, the built UI, and the SPA fallback.
const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
};

function sendFile(res: ServerResponse, path: string) {
  if (!existsSync(path) || !statSync(path).isFile()) return notFound(res);
  res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(path).pipe(res);
}

function notFound(res: ServerResponse) {
  res.writeHead(404, { "content-type": "text/plain" }).end("not found");
}

// --- Feedback writes (D36). The sidecar listens on 127.0.0.1, but any page the developer has open can still send it a
// request: a write must come from the studio's own page (Origin) at a local host name (Host, against DNS rebinding).
function fromStudio(req: IncomingMessage) {
  const host = req.headers.host ?? "";
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && req.headers.origin === `http://${host}`;
}

// ponytail: the whole body in memory; 40 full-tab PNG frames stay well under the cap.
const MAX_BODY = 200 * 1024 * 1024;
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("request too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const Change = z.strictObject({ status: z.enum(FEEDBACK_STATUSES).optional(), text: z.string().optional() });

const WindowAction = z.strictObject({ action: z.enum(["open", "close", "stop"]) });

// Open (or bring to the front) and close the Live window, and stop its recording, from the studio page only.
async function windowAction(req: IncomingMessage, res: ServerResponse) {
  if (!fromStudio(req)) return json(res, 403, { error: "the window opens from the studio page only" });
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
  try {
    const { action } = WindowAction.parse(await body(req));
    const app = readApp();
    if (!app) throw new Error("No app.url: .jeyna/jeyna.config.yaml is missing or does not parse.");
    if (action === "open") await windowFor(app.url).open();
    else if (action === "stop") live?.stop();
    else await live?.close();
    rescan();
    return json(res, 200, { window: live?.state() ?? CLOSED });
  } catch (e) {
    const msg = e instanceof z.ZodError ? "send { action: open | close | stop }" : (e as Error).message.split("\n")[0];
    log("window action refused:", msg);
    return json(res, 400, { error: msg });
  }
}

const json = (res: ServerResponse, status: number, data: unknown) =>
  res.writeHead(status, { "content-type": TYPES[".json"], "cache-control": "no-cache" }).end(JSON.stringify(data));

async function feedbackWrite(req: IncomingMessage, res: ServerResponse, id: string | undefined) {
  if (!fromStudio(req)) return json(res, 403, { error: "writes come from the studio page only" });
  if (!/^application\/json\b/.test(req.headers["content-type"] ?? "") && req.method !== "DELETE") return json(res, 415, { error: "send JSON" });
  try {
    let out: unknown;
    if (req.method === "POST" && !id) out = createFeedback(root, NewFeedback.parse(await body(req)));
    else if (req.method === "PATCH" && id) out = updateFeedback(root, id, Change.parse(await body(req)));
    else if (req.method === "DELETE" && id) out = (deleteFeedback(root, id), { id, deleted: true });
    else return json(res, 405, { error: "method not allowed" });
    rescan(); // so the page's next index already holds its own write
    return json(res, 200, out);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") : (e as Error).message;
    log("feedback write refused:", msg);
    return json(res, 400, { error: msg });
  }
}

function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const item = /^\/api\/feedback(?:\/([^/]+))?$/.exec(url.pathname);
  if (item) return void feedbackWrite(req, res, item[1] && decodeURIComponent(item[1]));
  if (url.pathname === "/api/window") return void windowAction(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
  if (url.pathname === "/api/index") {
    return res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-cache" }).end(payload);
  }
  if (url.pathname === "/api/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`event: index\ndata: ${payload}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }
  const evidence = /^\/runs\/([^/]+)\/evidence\/([^/]+)$/.exec(url.pathname);
  if (evidence) {
    const [run, file] = [decodeURIComponent(evidence[1]), decodeURIComponent(evidence[2])];
    try {
      if (basename(file) !== file) throw new Error("not a file name");
      return sendFile(res, join(runDirOf(root, run), "evidence", file));
    } catch {
      return notFound(res);
    }
  }
  const capture = /^\/feedback-files\/([^/]+)$/.exec(url.pathname);
  if (capture) {
    try {
      return sendFile(res, feedbackFile(root, decodeURIComponent(capture[1])));
    } catch {
      return notFound(res);
    }
  }
  const asset = basename(url.pathname);
  if (["app.js", "app.css", "anchor.svg"].includes(asset)) return sendFile(res, join(assets, asset));
  return sendFile(res, join(assets, "index.html")); // the UI routes /runs/… itself
}

const port = Number(values.port ?? process.env.JEYNA_STUDIO_PORT ?? 4710);
const server = createServer(handle);
server.listen(port, "127.0.0.1", () => {
  const { port } = server.address() as { port: number };
  writeIndex();
  startWatch();
  console.log(`Jeyna studio: http://localhost:${port}/  (watching ${jeyna})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    watcher?.close();
    for (const res of clients) res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
