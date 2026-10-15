import { expect, test } from "vitest";
import { redactDeep, redactor } from "./accounts.js";

const redact = redactor([{ handle: "user_a", user: "user_a@example.test", pass: "user_a@example.test!pw" }]);

test("redaction catches values as typed, upper-cased, URL- and form-encoded, longest first", () => {
  expect(redact("Wrong password for USER_A@example.test.")).toBe("Wrong password for {{account.user}}.");
  expect(redact("/login?email=user_a%40example.test&x=user_a%40example.test!pw")).toBe(
    "/login?email={{account.user}}&x={{account.pass}}",
  );
  expect(redact("pw: user_a@example.test!pw")).toBe("pw: {{account.pass}}");
});

test("redactDeep reaches nested strings but leaves image data alone", () => {
  const msg = { result: { content: [{ type: "text", text: "user_a@example.test" }, { type: "image", data: "user_a@example.test" }] } };
  expect(redactDeep(msg, redact).result.content).toEqual([
    { type: "text", text: "{{account.user}}" },
    { type: "image", data: "user_a@example.test" },
  ]);
});

// Short, common usernames are replaced only as whole tokens, so ordinary words around them survive (D30).
test("a short username is redacted as a whole token only, never inside a larger word or token", () => {
  const r = redactor([{ handle: "admin", user: "admin", pass: "s3cret-Pw" }]);
  expect(r("Administrator admin signed in; admins see admin.")).toBe("Administrator {{account.user}} signed in; admins see {{account.user}}.");
  expect(r("Hello, ADMIN! (admin) 'admin'")).toBe("Hello, {{account.user}}! ({{account.user}}) '{{account.user}}'");
  expect(r("/users/admin?as=admin&next=/admin/home")).toBe("/users/{{account.user}}?as={{account.user}}&next=/{{account.user}}/home");
  expect(r("admin@example.test badmin admin_x admin-x x.admin admin.example")).toBe("admin@example.test badmin admin_x admin-x x.admin admin.example");
  // Percent-encoded neighbours (quotes, spaces) still bound it: "admin" in a URL.
  expect(r("?q=%22admin%22&u=admin%20x")).toBe("?q=%22{{account.user}}%22&u={{account.user}}%20x");
});

test("a username like test leaves testing, latest and contest alone", () => {
  const r = redactor([{ handle: "t", user: "test", pass: "hunter2hunter2" }]);
  expect(r("testing the latest contest as test")).toBe("testing the latest contest as {{account.user}}");
  expect(r("Test")).toBe("{{account.user}}");
  expect(r("- text: test\n- text:\ttest\n")).toBe("- text: {{account.user}}\n- text:\t{{account.user}}\n");
});

test("an email username matches whatever its case, at a sentence end, and URL-encoded in a query", () => {
  const r = redactor([{ handle: "a", user: "user_a@example.test", pass: "correct-horse-a" }]);
  expect(r("Signed in as User_A@Example.TEST.")).toBe("Signed in as {{account.user}}.");
  expect(r("?email=user_a%40example.test&next=/")).toBe("?email={{account.user}}&next=/");
  expect(r("xuser_a@example.test user_a@example.testing")).toBe("xuser_a@example.test user_a@example.testing");
});

test("a password is redacted wherever it appears, even inside a larger token", () => {
  const r = redactor([{ handle: "a", user: "admin", pass: "correct-horse-a" }]);
  expect(r("pw=correct-horse-a, again xcorrect-horse-ax")).toBe("pw={{account.pass}}, again x{{account.pass}}x");
  // The placeholders a first pass wrote are left alone by a second one.
  expect(r(r("admin correct-horse-a"))).toBe("{{account.user}} {{account.pass}}");
});
