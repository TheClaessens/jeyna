import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import { browserName } from "./browser.js";
import { FindingInput } from "./schema.js";
import { current, fail, ok } from "./session.js";

// The finding file: frontmatter (§5.2) and the Steps / Expected / Actual / Evidence / Suggested next step sections.
export function findingMarkdown(front: Record<string, unknown>, f: FindingInput): string {
  return [
    `---\n${stringify(front)}---`,
    `# ${f.title}`,
    `## Steps\n\n${f.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    `## Expected\n\n${f.expected}`,
    `## Actual\n\n${f.actual}`,
    `## Evidence\n\n${f.evidence.map((e) => `![${e}](../evidence/${e})`).join("\n") || "None."}`,
    `## Suggested next step\n\n${f.next ?? "None given."}`,
  ].join("\n\n") + "\n";
}

export function registerFindingTools(server: McpServer) {
  server.registerTool(
    "record_finding",
    {
      description:
        "Record one distinct problem seen in this case as a finding; returns its id (PT-<slug>-<nnn>) to list in scenario_verdict. A bug needs evidence: take a screenshot first and pass its file name. Evidence names must be files screenshot returned in this run.",
      inputSchema: { case: z.string().describe("Case id from session_start, e.g. t1-390x844"), finding: FindingInput },
    },
    async ({ case: caseId, finding }) => {
      try {
        if (!current) throw new Error("No running session. Call session_start first.");
        const run = current;
        const c = run.session.cases.find((c) => c.id === caseId);
        if (!c) throw new Error(`Unknown case "${caseId}". Cases in this run: ${run.session.cases.map((c) => c.id).join(", ")}.`);
        const evidenceDir = join(run.runDir, "evidence");
        const have = () => readdirSync(evidenceDir).filter((f) => f.startsWith(`${caseId}-`));
        if (finding.kind === "bug" && !finding.evidence.length) {
          throw new Error(
            `A bug needs evidence. Call screenshot {case: "${caseId}"} on the page that shows it, then call record_finding again with its file name in evidence. ` +
              `Screenshots of this case so far: ${have().join(", ") || "none"}.`,
          );
        }
        const missing = finding.evidence.filter((e) => basename(e) !== e || !existsSync(join(evidenceDir, e)));
        if (missing.length) {
          throw new Error(`No such evidence: ${missing.join(", ")}. Screenshots of this case: ${have().join(", ") || "none"}.`);
        }
        const browser = await browserName();

        // Id and file in one synchronous step after the last await: no two calls get the same id (D11).
        const slug = run.session.flow.replace(/^exploratory:/, "");
        const id = `PT-${slug}-${String(run.findings.length + 1).padStart(3, "0")}`;
        const front = {
          schema: 1,
          id,
          kind: finding.kind,
          severity: finding.severity,
          status: "open",
          flow: run.session.flow,
          case: caseId,
          scenario: c.scenario,
          route: finding.route,
          viewport: c.viewport,
          browser,
          build: run.session.build,
          author: run.session.testers.find((t) => t.cases.includes(caseId))?.model,
          created: new Date().toISOString(),
          evidence: finding.evidence,
        };
        mkdirSync(join(run.runDir, "findings"), { recursive: true });
        const path = join(run.runDir, "findings", `${id}.md`);
        writeFileSync(path, findingMarkdown(front, finding), { flag: "wx" });
        run.findings.push({ id, case: caseId });
        return ok({ id, path });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
