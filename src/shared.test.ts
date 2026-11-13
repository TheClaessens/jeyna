import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { redactor } from "./accounts.js";
import { z } from "zod";
import { appUrl, duplicateNames, parseFront, runDirOf, splitFront, truncate, withStatus } from "./shared.js";

test("appUrl keeps the app url's base path, and the path's query and hash", () => {
  expect(appUrl("/login", "http://host:8080/app/")).toBe("http://host:8080/app/login");
  expect(appUrl("/login", "http://host:8080/app")).toBe("http://host:8080/app/login");
  expect(appUrl("login?next=/todos#top", "http://host/app/")).toBe("http://host/app/login?next=/todos#top");
  expect(appUrl("/", "http://host/app/")).toBe("http://host/app/");
  expect(appUrl("/login", "http://host:4173")).toBe("http://host:4173/login");
  expect(appUrl("/login", "http://host:4173/")).toBe("http://host:4173/login");
  // A path cannot climb out of the base path.
  expect(appUrl("/../../etc", "http://host/app/")).toBe("http://host/app/etc");
});

test("appUrl leaves a full url as it is, as goto always has", () => {
  expect(appUrl("https://other.test/x?y=1", "http://host/app/")).toBe("https://other.test/x?y=1");
  expect(appUrl("//cdn.test/x", "http://host/app/")).toBe("http://cdn.test/x");
});

test("truncate redacts before it cuts, so no prefix of an account value survives the cut; the result stays within max", () => {
  const redact = redactor([{ handle: "a", user: "user_a@example.test", pass: "correct-horse-a" }]);
  const max = 100;
  for (let at = max - 50; at <= max; at++) {
    for (const value of ["user_a@example.test", "correct-horse-a"]) {
      const text = `${"x".repeat(at - 1)} ${value} ${"y".repeat(max)}`; // the value starts at index `at`
      for (const out of [truncate(text, max, redact), truncate(text, max, redact, "…")]) {
        expect(out.length).toBeLessThanOrEqual(max);
        for (let n = 5; n <= value.length; n++) expect(out).not.toContain(value.slice(0, n)); // "user" alone is in the placeholder
      }
      expect(truncate(text, max, redact)).toMatch(/\n\[truncated, the page continues\]$/);
    }
  }
  expect(truncate("short user_a@example.test", max, redact)).toBe("short {{account.user}}");
});

test("parseFront gives the checked frontmatter and body, or one error line per reason", () => {
  const Front = z.strictObject({ id: z.string() });
  expect(parseFront("---\nid: x\n---\n# Body\n", Front)).toEqual({ front: { id: "x" }, body: "# Body\n", errors: [] });
  expect(parseFront("# none", Front)).toEqual({ errors: ["no YAML frontmatter between --- lines"] });
  expect(parseFront("---\nid: [x\n---\nbody", Front)).toMatchObject({ body: "body", errors: [expect.stringMatching(/^frontmatter is not valid YAML: /)] });
  expect(parseFront("---\nid: 1\nnope: 2\n---\n", Front).errors).toHaveLength(2);
});

test("withStatus puts of and note right after status, dropping the old ones", () => {
  const front = { id: "PT-x-001", status: "duplicate", of: "PT-x-002", note: "old", created: "t" };
  expect(Object.entries(withStatus(front, "wontfix", { note: "new" }))).toEqual([["id", "PT-x-001"], ["status", "wontfix"], ["note", "new"], ["created", "t"]]);
  expect(withStatus(front, "open", { of: undefined, note: undefined })).toEqual({ id: "PT-x-001", status: "open", created: "t" });
});

test("splitFront splits YAML frontmatter from the body", () => {
  expect(splitFront("---\nname: x\n---\n# Body\n")?.slice(1)).toEqual(["name: x", "# Body\n"]);
  expect(splitFront("# no frontmatter")).toBeNull();
});

test("splitFront reads a file with Windows line endings the same way", () => {
  expect(splitFront("---\r\nname: x\r\n---\r\n# Body\r\n")?.slice(1)).toEqual(["name: x", "# Body\n"]);
});

test("duplicateNames lists each repeated name once", () => {
  expect(duplicateNames([{ name: "a" }, { name: "b" }, { name: "a" }, { name: "a" }])).toEqual(["a"]);
  expect(duplicateNames([{ name: "a" }])).toEqual([]);
});

test("runDirOf accepts a run id or its folder under .jeyna/playtests/, nothing outside", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jeyna-project-")));
  const playtests = join(root, ".jeyna", "playtests");
  mkdirSync(join(playtests, "2026-10-15-login"), { recursive: true });
  expect(runDirOf(root, "2026-10-15-login")).toBe(join(playtests, "2026-10-15-login"));
  expect(runDirOf(root, join(playtests, "2026-10-15-login"))).toBe(join(playtests, "2026-10-15-login"));
  for (const bad of ["..", "../..", "/etc", "2026-10-15-login/findings", ""]) {
    expect(() => runDirOf(root, bad), bad).toThrow(/run must be a run id under \.jeyna\/playtests\//);
  }
});
