import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { redactor } from "./accounts.js";
import { appUrl, clip, duplicateNames, runDirOf, splitFront } from "./shared.js";

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

test("clip redacts before it cuts, so no prefix of an account value survives the cut", () => {
  const redact = redactor([{ handle: "a", user: "user_a@example.test", pass: "correct-horse-a" }]);
  const max = 100;
  for (let at = max - 15; at <= max; at++) {
    for (const value of ["user_a@example.test", "correct-horse-a"]) {
      const text = `${"x".repeat(at - 1)} ${value} and more`; // the value starts at index `at`
      const out = clip(text, max, redact);
      expect(out).toMatch(/\[truncated at 100 characters, the page continues\]$/);
      for (let n = 5; n <= value.length; n++) expect(out).not.toContain(value.slice(0, n)); // "user" alone is in the placeholder
    }
  }
  expect(clip("short user_a@example.test", max, redact)).toBe("short {{account.user}}");
});

test("splitFront splits YAML frontmatter from the body", () => {
  expect(splitFront("---\nname: x\n---\n# Body\n")?.slice(1)).toEqual(["name: x", "# Body\n"]);
  expect(splitFront("# no frontmatter")).toBeNull();
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
