import { z } from "zod";

// Env variable names only; values never live in the config (D18).
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an environment variable name, not a value");

// Strict objects: a misspelt key is reported, not silently ignored.
export const Config = z.strictObject({
  app: z.strictObject({
    name: z.string().min(1),
    url: z.url(),
    build: z.string().nullish(),
    reset: z.string().min(1).nullish().describe("Shell command that resets the app's state; run before every run"),
  }),
  viewports: z.array(z.string().regex(/^\d+x\d+$/, "must look like 1440x900")).min(1),
  browser: z.strictObject({ headed: z.boolean().default(false) }).default({ headed: false }),
  tester: z
    .strictObject({ model: z.string().default("sonnet"), effort: z.string().default("medium") })
    .default({ model: "sonnet", effort: "medium" }),
  accounts: z.array(z.strictObject({ handle: z.string().min(1), user_env: envName, pass_env: envName })).default([]),
});

export type Config = z.infer<typeof Config>;

export const Scenario = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  pass: z.string().min(1),
  account: z.enum(["none", "consumes"]).optional(),
});
export type Scenario = z.infer<typeof Scenario>;

export type Case = { id: string; scenario: string; viewport: string };

// What a tester sends to record_finding (§5.2). Scenario, viewport and the rest are added by the server (D4).
export const FindingInput = z.strictObject({
  title: z.string().min(8).max(140).describe("One line, no severity words"),
  kind: z.enum(["bug", "ux", "a11y", "question"]),
  severity: z.enum(["critical", "major", "minor", "note"]),
  route: z.string().min(1).describe("e.g. /login"),
  steps: z.array(z.string().min(1)).min(1).max(12),
  expected: z.string().min(1),
  actual: z.string().min(1),
  evidence: z.array(z.string()).default([]).describe("File names returned by screenshot, e.g. t1-390x844-2-login.png"),
  next: z.string().min(1).optional().describe("Suggested next step"),
});
export type FindingInput = z.infer<typeof FindingInput>;

// session.json as written by session_start and its successors (D11). Not strict: a later server may add
// fields, and the studio must still read older files. The studio validates on read (architecture, "one schema").
export const Verdict = z.object({
  case: z.string(),
  result: z.enum(["pass", "fail", "blocked", "skipped"]),
  note: z.string().optional(),
  findings: z.array(z.string()),
});
export type Verdict = z.infer<typeof Verdict>;

export const SessionFile = z.object({
  schema: z.literal(1),
  id: z.string(),
  flow: z.string(),
  app: z.string(),
  build: z.string(),
  status: z.enum(["running", "done", "aborted"]),
  started: z.string(),
  finished: z.string().optional(),
  mode: z.enum(["guided", "exploratory"]),
  entry: z.string().optional(),
  scenarios: z.array(Scenario),
  testers: z.array(
    z.object({ id: z.string(), scenario: z.string(), account: z.string().optional(), batch: z.number(), model: z.string(), cases: z.array(z.string()) }),
  ),
  cases: z.array(z.object({ id: z.string(), scenario: z.string(), viewport: z.string() })),
  verdicts: z.array(Verdict),
  summary: z.string().optional(),
});
export type Session = z.infer<typeof SessionFile>;
