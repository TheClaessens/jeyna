// Small pure helpers shared by the tool modules. No side effects at import, so unit tests can load it.
import { dirname, resolve } from "node:path";

// YAML frontmatter between --- lines, then the body: [_, yaml, body] (flows §5.2 and findings).
export const splitFront = (md: string) => /^---\n([\s\S]*?)\n?---\n([\s\S]*)$/.exec(md);

// Names that occur more than once, each listed once (scenario names must be unique per flow and per run).
export const duplicateNames = (items: { name: string }[]) => {
  const names = items.map((s) => s.name);
  return [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
};

// goto's `path`, relative to the app url including its base path: http://host/app/ + /login is
// http://host/app/login. A full url (with a scheme, or protocol-relative) resolves as before (D30).
export function appUrl(path: string, app: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) return new URL(path, app).href;
  const base = new URL(app);
  const rel = new URL(path.startsWith("/") ? path : `/${path}`, "http://x"); // normalises ./.. without leaving the base
  base.pathname = base.pathname.replace(/\/+$/, "") + rel.pathname;
  base.search = rel.search;
  base.hash = rel.hash;
  return base.href;
}

// A snapshot cut to `max` characters. Redacted first, so a value straddling the cut leaves no prefix (D9, D14, D30).
export function clip(text: string, max: number, redact: (t: string) => string): string {
  const safe = redact(text);
  return safe.length > max ? `${safe.slice(0, max)}\n[truncated at ${max} characters, the page continues]` : safe;
}

// A run's folder from a run id (or that folder's path): a direct child of .jeyna/playtests/, nothing else.
// Every tool that takes a run argument resolves it here (validate, save_flow, update_status).
export function runDirOf(root: string, run: string): string {
  const playtests = resolve(root, ".jeyna", "playtests");
  const dir = resolve(playtests, run);
  if (!run || dirname(dir) !== playtests) throw new Error(`run must be a run id under .jeyna/playtests/, not ${run || "an empty string"}.`);
  return dir;
}
