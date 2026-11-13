import { expect, test } from "vitest";
import { planTesters } from "./session.js";

const sc = (name: string, account?: "none" | "consumes") => ({ name, description: "d", pass: "p", account });

function noAccountHeldTwiceInABatch(testers: { batch: number; account?: string }[]) {
  const seen = new Set<string>();
  for (const t of testers) {
    if (!t.account) continue;
    const key = `${t.batch}/${t.account}`;
    expect(seen.has(key), `account ${t.account} twice in batch ${t.batch}`).toBe(false);
    seen.add(key);
  }
}

test("five scenarios on a pool of two run in three batches, never sharing an account within a batch", () => {
  const testers = planTesters([sc("a"), sc("b"), sc("c"), sc("d"), sc("e")], ["user_a", "user_b"], ["1440x900", "390x844"]);
  noAccountHeldTwiceInABatch(testers);
  expect(testers.map((t) => t.batch)).toEqual([1, 1, 2, 2, 3]);
  expect(testers.every((t) => t.account)).toBe(true);
});

test("one tester per scenario, one case per viewport", () => {
  const [t] = planTesters([sc("Sign in")], ["user_a"], ["1440x900", "390x844"]);
  expect(t).toMatchObject({ id: "t1", scenario: "Sign in", account: "user_a", batch: 1 });
  expect(t.cases).toEqual([
    { id: "t1-1440x900", scenario: "Sign in", viewport: "1440x900" },
    { id: "t1-390x844", scenario: "Sign in", viewport: "390x844" },
  ]);
});

test("Account: none testers take no account and do not wait for one", () => {
  const testers = planTesters([sc("a"), sc("b"), sc("public", "none"), sc("c")], ["user_a"], ["390x844"]);
  noAccountHeldTwiceInABatch(testers);
  const pub = testers.find((t) => t.scenario === "public")!;
  expect(pub.account).toBeUndefined();
  expect(pub.batch).toBe(1);
  expect(testers.filter((t) => t.account).map((t) => t.batch)).toEqual([1, 2, 3]);
});

test("Account: consumes testers run in the last batch", () => {
  const testers = planTesters([sc("lockout", "consumes"), sc("a"), sc("b"), sc("c")], ["user_a", "user_b"], ["390x844"]);
  noAccountHeldTwiceInABatch(testers);
  const last = Math.max(...testers.map((t) => t.batch));
  expect(testers.find((t) => t.scenario === "lockout")!.batch).toBe(last);
});

test("an account a consuming tester may lock is never handed out again", () => {
  const testers = planTesters([sc("x", "consumes"), sc("y", "consumes"), sc("a")], ["user_a", "user_b", "user_c"], ["390x844"]);
  const consumed = testers.filter((t) => t.scenario !== "a").map((t) => t.account);
  expect(new Set(consumed).size).toBe(2);
});

test("more consuming scenarios than accounts, or account-needing scenarios with no pool, are refused", () => {
  expect(() => planTesters([sc("x", "consumes"), sc("y", "consumes")], ["user_a"], ["390x844"])).toThrow(/consumes/);
  expect(() => planTesters([sc("a")], [], ["390x844"])).toThrow(/Account: none/);
});

test("tester.parallel bounds every batch, Account: none testers included, and keeps tester and case ids", () => {
  const testers = planTesters([sc("a", "none"), sc("b", "none"), sc("c", "none"), sc("d")], ["user_a", "user_b"], ["390x844"], 5, 2);
  expect(testers.map((t) => [t.id, t.batch])).toEqual([["t5", 1], ["t6", 1], ["t7", 2], ["t8", 2]]);
  expect(testers[3].cases).toEqual([{ id: "t8-390x844", scenario: "d", viewport: "390x844" }]);
});

test("a consuming tester runs after every other tester of its account, also under a parallel cap", () => {
  const testers = planTesters([sc("x", "consumes"), sc("a"), sc("b"), sc("c")], ["user_a", "user_b"], ["390x844"], 1, 1);
  noAccountHeldTwiceInABatch(testers);
  expect(testers.map((t) => t.batch)).toEqual([4, 1, 2, 3]);
});

test("with created accounts every tester that signs in gets its own (handle new), bounded only by parallel", () => {
  const testers = planTesters([sc("a"), sc("lockout", "consumes"), sc("public", "none"), sc("b")], "new", ["390x844"]);
  expect(testers.map((t) => [t.id, t.account, t.batch])).toEqual([["t1", "new", 1], ["t2", "new", 1], ["t3", undefined, 1], ["t4", "new", 1]]);
  expect(planTesters([sc("a"), sc("b"), sc("c")], "new", ["390x844"], 1, 2).map((t) => t.batch)).toEqual([1, 1, 2]);
});
