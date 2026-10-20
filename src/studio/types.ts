// What the sidecar serves and pushes: one JSON document for .jeyna/playtests/ and .jeyna/feedback/ (index.json).
// Type-only imports, so the browser bundle pulls in no server code.
import type { FeedbackItem } from "../feedback.js";
import type { Session } from "../schema.js";
import type { Finding, Since } from "../validate.js";

// A finding file as validate.ts read it, plus its body sections rendered to HTML (Steps, Expected, …), keyed by heading.
export type StudioFinding = Finding & { sections: Record<string, string> };

export type StudioRun = {
  id: string;
  session: Session | null;
  // Why session is null: session.json missing, invalid JSON or off the schema. The run still lists, in the needs-attention lane.
  sessionError?: string;
  // validateRun's `path: message` lines. Empty means nothing needs attention.
  errors: string[];
  since: Since | null;
  report: boolean;
  findings: StudioFinding[];
};

export type StudioIndex = {
  schema: 1;
  generated: string;
  // Absolute project root, so the UI can offer the absolute path of a finding file.
  root: string;
  app: { name: string; url: string } | null;
  // Newest first by start time; runs without a readable session.json go last, by folder name.
  runs: StudioRun[];
  // Every .jeyna/feedback/FB-*.md, oldest id first, each with its own errors (D36).
  feedback: FeedbackItem[];
};
