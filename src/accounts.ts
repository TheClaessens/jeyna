import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import type { Config } from "./schema.js";

export type Account = { handle: string; user?: string; pass?: string };

// Values are read when needed, from the server's env first, then .jeyna/.env (D18). Never returned.
export function accountValues(root: string, config: Config): Account[] {
  const file = join(root, ".jeyna", ".env");
  const dotenv = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const get = (n: string) => process.env[n] || dotenv[n] || undefined;
  return config.accounts.map((a) => ({ handle: a.handle, user: get(a.user_env), pass: get(a.pass_env) }));
}

// `{{account.user}}` / `{{account.pass}}` in a fill value become the account's values (F5.4).
export function substitute(value: string, account: Account | undefined, caseId: string): string {
  if (!/\{\{account\.(user|pass)\}\}/.test(value)) return value;
  if (!account) throw new Error(`Case ${caseId} has no account (its scenario is \`Account: none\`), so {{account.*}} cannot be filled.`);
  if (!account.user || !account.pass) throw new Error(`account ${account.handle} not configured`);
  return value.replaceAll("{{account.user}}", account.user).replaceAll("{{account.pass}}", account.pass);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every configured value, also URL- and form-encoded, back to its placeholder, ignoring case (D9).
export function redactor(accounts: Account[]): (text: string) => string {
  const pairs = accounts.flatMap((a) => [
    [a.pass, "{{account.pass}}"],
    [a.user, "{{account.user}}"],
  ]);
  const forms = new Map<string, string>();
  for (const [v, ph] of pairs) {
    if (!v) continue;
    for (const f of [v, encodeURIComponent(v), new URLSearchParams({ v }).toString().slice(2)]) forms.set(f.toLowerCase(), ph!);
  }
  if (!forms.size) return (t) => t;
  // Longest first, so a password that contains the username is replaced whole.
  const re = new RegExp([...forms.keys()].sort((x, y) => y.length - x.length).map(escape).join("|"), "gi");
  return (t) => t.replace(re, (m) => forms.get(m.toLowerCase())!);
}

// Redacts every string in an outgoing MCP message except image data: the single exit point.
export function redactDeep<T>(msg: T, redact: (t: string) => string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redact(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      if ((v as { type?: unknown }).type === "image") return v;
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(msg) as T;
}
