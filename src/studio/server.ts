// Jeyna studio sidecar: watches .jeyna/playtests/, reads every run with the server's own validate.ts, keeps a
// derived .jeyna/index.json, serves evidence as files and pushes the index over SSE to the UI in plugin/studio/.
// Read-only: it never writes under playtests/ and never drops a file it cannot parse (the UI shows those as needs attention).
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
import { Config } from "../schema.js";
import { findProjectRoot, runDirOf, splitFront } from "../shared.js";
import { type Finding, previousRun, readFindings, readSession, since, validateRun } from "../validate.js";
import type { StudioFinding, StudioIndex, StudioRun } from "./types.js";

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
  return { schema: 1, generated: new Date().toISOString(), root, app: readApp(), runs };
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
function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    index = scan();
    payload = JSON.stringify(index);
    writeIndex();
    for (const res of clients) res.write(`event: index\ndata: ${payload}\n\n`);
    log(`rescanned: ${index.runs.length} runs, ${clients.size} clients`);
  }, 150);
}

let watcher: FSWatcher | undefined;
function startWatch() {
  if (existsSync(playtests)) {
    watcher?.close();
    watcher = watch(playtests, { recursive: true }, changed);
    log("watching", playtests);
  } else {
    // No run yet: watch .jeyna/ until playtests/ appears, then switch to the recursive watch.
    watcher = watch(jeyna, () => {
      if (existsSync(playtests)) {
        startWatch();
        changed();
      }
    });
    log("waiting for", playtests);
  }
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

function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
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
  console.log(`Jeyna studio: http://localhost:${port}/  (watching ${playtests})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    watcher?.close();
    for (const res of clients) res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
