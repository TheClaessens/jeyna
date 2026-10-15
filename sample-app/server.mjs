// Jeyna sample app (D16): zero dependencies, in-memory state. `node sample-app/server.mjs`, then http://localhost:4173.
// A todo list behind a login, with password reset. Seeded bugs are listed in SEEDED-BUGS.md.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4173);
const MAX_FAILURES = 3;

// Same values as .env.example. Restarting the server resets everything.
const account = (pass) => ({ passwords: new Set([pass]), failures: 0, todos: [], next: 1 });
const accounts = new Map([
  ["user_a@example.test", account("correct-horse-a")],
  ["user_b@example.test", account("correct-horse-b")],
]);
const sessions = new Map(); // session id -> email

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Todo sample</title>
<style>
  html, body { margin: 0; overflow-x: hidden; font: 16px system-ui, sans-serif; background: #f4f4f6; }
  main { padding: 48px 16px; }
  h1 { margin: 0 0 24px; font-size: 28px; }
  form { display: flex; flex-direction: column; gap: 12px; max-width: 360px; }
  input, select { padding: 10px; font-size: 16px; border: 1px solid #999; border-radius: 6px; }
  /* Seeded bug 2: the actions row is wider than a phone, so Sign in sits past the right edge at 390 px. */
  .actions { display: flex; align-items: center; gap: 24px; width: 560px; }
  .actions a { flex: 0 0 auto; }
  button { padding: 10px 24px; font-size: 16px; background: #2457d6; color: #fff; border: 0; border-radius: 6px; }
  .actions button { margin-left: auto; }
  .error { color: #b00020; }
  ul { list-style: none; padding: 0; max-width: 560px; }
  li { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #ddd; }
  li span { flex: 1; }
  li form { flex-direction: row; }
  li button { padding: 6px 12px; font-size: 14px; }
  .done { text-decoration: line-through; color: #666; }
</style></head>
<body><main>${body}</main></body></html>`;

const login = (error = "") =>
  page(
    "Sign in",
    `<h1>Sign in to your todos</h1>
<form method="post" action="/login">
  ${error ? `<p class="error" role="alert">${error}</p>` : ""}
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username">
  <!-- Seeded bug 3: the password field has no label. -->
  <input name="password" type="password" autocomplete="current-password">
  <div class="actions">
    <a href="/reset">Forgot password?</a>
    <button type="submit">Sign in</button>
  </div>
</form>`,
  );

const reset = (message = "") =>
  page(
    "Reset password",
    `<h1>Reset your password</h1>
${message ? `<p role="status">${message}</p><p><a href="/login">Back to sign in</a></p>` : `<form method="post" action="/reset">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username">
  <label for="password">New password</label>
  <input id="password" name="password" type="password" autocomplete="new-password">
  <button type="submit">Reset password</button>
</form>`}`,
  );

const todos = (user) =>
  page(
    "Todos",
    `<h1>Your todos</h1>
<form method="post" action="/todos">
  <label for="title">New todo</label>
  <input id="title" name="title" required>
  <label for="priority">Priority</label>
  <select id="priority" name="priority">
    <option>Low</option><option selected>Normal</option><option>High</option>
  </select>
  <button type="submit">Add</button>
</form>
<form method="post" action="/logout"><button type="submit">Sign out</button></form>
${user.todos.length ? "" : "<p>Nothing to do yet.</p>"}
<ul>${user.todos
      .map(
        (t) => `<li><span class="${t.done ? "done" : ""}">${esc(t.title)} · ${t.priority} priority${t.done ? " · done" : ""}</span>
  ${t.done ? "" : `<form method="post" action="/todos/${t.id}/complete"><button>Complete ${esc(t.title)}</button></form>`}
  <form method="post" action="/todos/${t.id}/delete"><button>Delete ${esc(t.title)}</button></form></li>`,
      )
      .join("\n")}</ul>`,
  );

const form = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(new URLSearchParams(body)));
  });

createServer(async (req, res) => {
  const send = (status, html, headers = {}) =>
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers }).end(html);
  const redirect = (to, headers = {}) => res.writeHead(303, { location: to, ...headers }).end();
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  const user = accounts.get(sessions.get(sid));
  const path = new URL(req.url, "http://x").pathname;

  if (req.method === "GET" && (path === "/" || path === "/login")) return user ? redirect("/todos") : send(200, login());
  if (req.method === "POST" && path === "/login") {
    const f = await form(req);
    const email = f.get("email") ?? "";
    const a = accounts.get(email);
    // Seeded bug 5: the failure count is never reset, by time or by a password reset, so a lockout never ends.
    if (a && a.failures >= MAX_FAILURES) {
      return send(403, login(`This account is locked after ${MAX_FAILURES} wrong passwords. Reset your password to unlock it.`));
    }
    // Seeded bug 1: every password the account ever had still works (see /reset).
    if (a && a.passwords.has(f.get("password") ?? "")) {
      const id = randomUUID();
      sessions.set(id, email);
      return redirect("/todos", { "set-cookie": `sid=${id}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (a) a.failures++;
    // Seeded bug 6: the error echoes the typed username back into the page.
    return send(401, login(`Wrong password for ${esc(email)}.`));
  }
  if (req.method === "POST" && path === "/logout") {
    sessions.delete(sid);
    return redirect("/login");
  }
  if (req.method === "GET" && path === "/reset")return send(200, reset());
  if (req.method === "POST" && path === "/reset") {
    const f = await form(req);
    const a = accounts.get(f.get("email") ?? "");
    if (a && f.get("password")) a.passwords.add(f.get("password")); // bug 1: should replace, not add
    return send(200, reset("If that account exists, its password is now changed. Sign in with the new password."));
  }

  if (path === "/todos" || path.startsWith("/todos/")) {
    if (!user) return redirect("/login");
    if (req.method === "GET" && path === "/todos") return send(200, todos(user));
    if (req.method === "POST" && path === "/todos") {
      const f = await form(req);
      const title = (f.get("title") ?? "").trim();
      // Seeded bug 4: the chosen priority is dropped; every todo is saved as Normal.
      if (title) user.todos.push({ id: user.next++, title, priority: "Normal", done: false });
      return redirect("/todos");
    }
    const m = /^\/todos\/(\d+)\/(complete|delete)$/.exec(path);
    if (req.method === "POST" && m) {
      const t = user.todos.find((t) => t.id === Number(m[1]));
      if (t && m[2] === "complete") t.done = true;
      if (t && m[2] === "delete") user.todos.splice(user.todos.indexOf(t), 1);
      return redirect("/todos");
    }
  }
  send(404, page("Not found", "<h1>Not found</h1>"));
}).listen(PORT, () => console.log(`Todo sample on http://localhost:${PORT}`));
