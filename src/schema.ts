import { z } from "zod";

// Env variable names only; values never live in the config (D18).
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an environment variable name, not a value");

// Strict objects: a misspelt key is reported, not silently ignored.
export const Config = z.strictObject({
  app: z.strictObject({
    name: z.string().min(1),
    url: z.url(),
    build: z.string().nullish(),
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
