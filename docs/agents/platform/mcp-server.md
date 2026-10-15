# Minimal TS stdio MCP server (@modelcontextprotocol/sdk)

VERIFIED 2026-10-15 with `@modelcontextprotocol/sdk@1.32.1`, `zod@4.6.7`, node 20.12.2: the code below was bundled with esbuild and driven by an SDK `Client` over stdio from a dir with no node_modules (tools listed, text + image returned, bad input -> isError). Working copy: `scratchpad/exp/src/server.ts`, client: `scratchpad/exp/client.mjs`.

## Install
```bash
npm i -D @modelcontextprotocol/sdk zod     # zod is a required peer: "^3.25 || ^4.0"; SDK uses zod/v4 internally
```
SDK `engines.node >= 18`. Package is ESM with subpath exports; import paths need the `.js` suffix.

## Server
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// stdout IS the JSON-RPC channel. Never console.log. Log to stderr.
const log = (...a: unknown[]) => console.error(new Date().toISOString(), ...a);

const server = new McpServer({ name: "jeyna", version: "0.1.0" });

server.registerTool(
  "get_context",
  { description: "Project root, config status, secret sources.", inputSchema: {} },
  async () => ({ content: [{ type: "text", text: JSON.stringify({ root: "..." }) }] }),
);

server.registerTool(
  "screenshot",
  {
    title: "Screenshot",                       // optional display name
    description: "Screenshot the current page of a case.",
    inputSchema: {                             // a zod RAW SHAPE (object of zod types), not z.object(...)
      case_id: z.string(),
      look: z.boolean().default(false),
      width: z.number().int().default(390),
    },
    annotations: { readOnlyHint: true },       // optional ToolAnnotations
  },
  async ({ case_id, look, width }) => {        // args are parsed + typed from the shape
    const png: Buffer = await takeShot(case_id, width);
    return {
      content: [
        { type: "text", text: `saved .jeyna/playtests/.../shot.png` },
        { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());   // top-level await -> ESM output
log("ready", process.argv.slice(2).join(" "));
```
Signature (1.32.1 `server/mcp.d.ts`):
`registerTool(name, { title?, description?, inputSchema?, outputSchema?, annotations?, _meta? }, cb)`.
`server.tool(...)` overloads are deprecated; use `registerTool`. `inputSchema` may also be a full zod schema (`AnySchema`), but the raw-shape form is the documented one.

Generated JSON Schema from the shape above (observed):
```json
{"type":"object","properties":{"case_id":{"type":"string"},"look":{"default":false,"type":"boolean"},"width":{"default":390,"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991}},"required":["case_id"],"$schema":"http://json-schema.org/draft-07/schema#"}
```
`.default()` fields are not required. `z.string().url()` emits `"format":"uri"`.

## Content types
- text: `{ type: "text", text }`
- image: `{ type: "image", data: <base64 string, no data: prefix>, mimeType: "image/png" }`
- Mix freely in one `content` array.
- Claude Code: PNG/JPEG/GIF/WebP shown to Claude inline (may be downscaled) and the original saved under the session's `tool-results/` dir with the path given to Claude (docs: mcp.md "Images in tool results"). Whether a SUBAGENT actually perceives the image = probe P5 (UNVERIFIED).
- Output limits (Claude Code): warning >10k tokens, cap 25k tokens (`MAX_MCP_OUTPUT_TOKENS`); text results >50,000 chars are saved to a file and replaced by a path unless the tool sets `_meta: {"anthropic/maxResultSizeChars": N}`. Image results always count against the token cap. Keep snapshots compact.

## Errors: isError vs throw
| What happens | What the client gets (VERIFIED) |
|---|---|
| handler returns `{ isError: true, content: [{type:"text", text}] }` | tool result with isError; Claude sees the text and can recover |
| handler `throw new Error("msg")` | SDK catches it and returns `{ content:[{type:"text",text:"msg"}], isError:true }` — same as above (only `McpError` with code UrlElicitationRequired propagates as a protocol error) |
| args fail zod validation | `{ isError:true, content:[{text:"MCP error -32602: Input validation error: Invalid arguments for tool look: Invalid URL at url"}] }` |
| unknown tool name | JSON-RPC error `-32602 Tool X not found` |
| process exits / writes junk to stdout | client: `MCP error -32000: Connection closed`; all tools gone |

Rule: return `isError` results for expected failures (no browser, unknown case id, bad state) with an actionable message; throwing is equivalent but less explicit. Never let an unhandled rejection kill the process: add
```ts
process.on("unhandledRejection", (e) => log("unhandledRejection", e));
```

## Arguments / root resolution
`process.argv.slice(2)` -> e.g. `["--project", "/abs/sample-app"]` (Claude Code substitutes `${CLAUDE_PROJECT_DIR}` in plugin `args`). Use `node:util` `parseArgs` (stdlib) — no dependency:
```ts
import { parseArgs } from "node:util";
const { values } = parseArgs({ options: { project: { type: "string" } }, strict: false });
const root = values.project ?? process.env.CLAUDE_PROJECT_DIR ?? findUp(".jeyna");
```
Guard against an unexpanded literal `"${CLAUDE_PROJECT_DIR}"` arriving (happens when a var isn't substituted). `process.cwd()` is not a documented project root.

## Concurrency
The stdio transport dispatches requests as they arrive; handlers are async, so two subagents calling tools at once run concurrently in one process (P8 checks this end to end). Shared state (session.json writes) must be serialized in-process (promise queue + temp-file rename).

## Local smoke test without Claude Code
```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const c = new Client({ name: "t", version: "0" });
await c.connect(new StdioClientTransport({ command: "node", args: ["plugin/server/jeyna-mcp.mjs", "--project", process.cwd()], stderr: "inherit" }));
console.log((await c.listTools()).tools.map(t => t.name));
console.log(await c.callTool({ name: "get_context", arguments: {} }));
await c.close();
```
Good candidate for a vitest integration test (spawns the real bundle).
