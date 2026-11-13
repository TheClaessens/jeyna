import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import type { Config } from "./schema.js";

// An account: its handle, the names of its two variables, and their values when set. Values are never returned.
export type Account = { handle: string; user_env: string; pass_env: string; user?: string; pass?: string };

// The one reader of account variables: the server's env first, then .jeyna/.env (D18).
// `from` says where a variable is set; its `value` never leaves the server.
export function readSecrets(root: string): (name: string) => { from: "env" | ".env" | "missing"; value?: string } {
  const file = join(root, ".jeyna", ".env");
  const dotenv = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return (n) => (process.env[n] ? { from: "env", value: process.env[n] } : dotenv[n] ? { from: ".env", value: dotenv[n] } : { from: "missing" });
}

// Values are read when needed, never kept.
export function accountValues(root: string, config: Config): Account[] {
  const get = readSecrets(root);
  return config.accounts.map((a) => ({ ...a, user: get(a.user_env).value, pass: get(a.pass_env).value }));
}

// `{{account.user}}` / `{{account.pass}}` in a fill value or a selector become the account's values (F5.4).
// Only the placeholders the text uses need their variable set.
export function substitute(text: string, account: Account | undefined, caseId: string): string {
  if (!/\{\{account\.(user|pass)\}\}/.test(text)) return text;
  if (!account) throw new Error(`Case ${caseId} has no account (its scenario is \`Account: none\`), so {{account.*}} cannot be filled.`);
  for (const k of ["user", "pass"] as const) {
    if (text.includes(`{{account.${k}}}`) && !account[k]) {
      throw new Error(
        `{{account.${k}}} cannot be filled: ${account[`${k}_env`]} (account ${account.handle}) is not set. ` +
          "The developer fills it in .jeyna/.env, or exports it in the shell before starting claude; until then this account cannot sign in.",
      );
    }
  }
  return text.replaceAll("{{account.user}}", account.user ?? "").replaceAll("{{account.pass}}", account.pass ?? "");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A username is replaced only as a whole token: not next to a letter, digit or one of _ % + @ - .
// (a "." or "%XX" byte that ends a sentence or encodes a quote still bounds it), so "admin" leaves
// "Administrator" and "admin@example.test" alone (D30).
const TOKEN = "[\\p{L}\\p{N}_%+@.-]";
const BEFORE = `(?<=^|(?!${TOKEN})[\\s\\S]|%[0-9A-Fa-f]{2}|(?<![\\p{L}\\p{N}])\\.)`;
const AFTER = `(?=$|(?!${TOKEN})[\\s\\S]|%[0-9A-Fa-f]{2}|\\.(?![\\p{L}\\p{N}]))`;

// Every configured value, also URL- and form-encoded, back to its placeholder, ignoring case (D9).
// Passwords are replaced wherever they appear, even inside a larger token; usernames as whole tokens (D30).
export function redactor(accounts: Pick<Account, "handle" | "user" | "pass">[]): (text: string) => string {
  const pairs = accounts.flatMap((a) => [
    [a.user, "{{account.user}}"],
    [a.pass, "{{account.pass}}"], // after the user: a value that is both is treated as a password
  ]);
  const forms = new Map<string, string>();
  for (const [v, ph] of pairs) {
    if (!v) continue;
    for (const f of [v, encodeURIComponent(v), new URLSearchParams({ v }).toString().slice(2)]) forms.set(f.toLowerCase(), ph!);
  }
  if (!forms.size) return (t) => t;
  // Longest first, so a password that contains the username is replaced whole.
  const alternatives = [...forms]
    .sort(([x], [y]) => y.length - x.length)
    .map(([f, ph]) => (ph === "{{account.pass}}" ? escape(f) : `${BEFORE}${escape(f)}${AFTER}`));
  const re = new RegExp(alternatives.join("|"), "giu");
  return (t) => t.replace(re, (m) => forms.get(m.toLowerCase()) ?? "{{account.pass}}");
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
