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
