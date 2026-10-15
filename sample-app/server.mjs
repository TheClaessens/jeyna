// Jeyna sample app (D16): zero dependencies, in-memory state. `node sample-app/server.mjs`, then http://localhost:4173.
// Seeded bugs are listed in SEEDED-BUGS.md. Slice 1 has the login page only.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4173);

// Same values as .env.example. Restarting the server resets everything.
const accounts = new Map([
  ["user_a@example.test", "correct-horse-a"],
  ["user_b@example.test", "correct-horse-b"],
]);

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Todo sample</title>
<style>
  html, body { margin: 0; overflow-x: hidden; font: 16px system-ui, sans-serif; background: #f4f4f6; }
  main { padding: 48px 16px; }
  h1 { margin: 0 0 24px; font-size: 28px; }
  form { display: flex; flex-direction: column; gap: 12px; max-width: 360px; }
  input { padding: 10px; font-size: 16px; border: 1px solid #999; border-radius: 6px; }
  /* Seeded bug 2: the actions row is wider than a phone, so Sign in sits past the right edge at 390 px. */
  .actions { display: flex; align-items: center; gap: 24px; width: 560px; }
  .actions a { flex: 0 0 auto; }
  .actions button { margin-left: auto; padding: 10px 24px; font-size: 16px; background: #2457d6; color: #fff; border: 0; border-radius: 6px; }
  .error { color: #b00020; }
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

createServer((req, res) => {
  const send = (status, html) => res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(html);
  if (req.method === "GET" && (req.url === "/" || req.url === "/login")) return send(200, login());
  if (req.method === "POST" && req.url === "/login") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const f = new URLSearchParams(body);
      if (accounts.get(f.get("email") ?? "") === f.get("password")) {
        return send(200, page("Todos", "<h1>Your todos</h1><p>The todo list arrives in slice 2.</p>"));
      }
      send(401, login("Wrong email or password."));
    });
    return;
  }
  send(404, page("Not found", "<h1>Not found</h1>"));
}).listen(PORT, () => console.log(`Todo sample on http://localhost:${PORT}`));
