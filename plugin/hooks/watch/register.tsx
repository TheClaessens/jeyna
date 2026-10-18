// Jeyna's Watch (D34): a three-line band above the prompt while a playtest run is live, read from
// .jeyna/playtests/*/session.json alone, never from the agents or the MCP server. A once-a-second tick
// re-reads a session.json whose mtime moved and keeps the elapsed time moving; the band is $.state.
import { atom, read, update } from "claude-code";
import type { Register } from "claude-code";

import { DIM, watch, type WatchRun, type WatchSession } from "./band.js";

const shown = atom({ plugin: "jeyna", key: "watch" } as const, null);

export const register: Register = (on) => {
  // ponytail: a full stat of every run folder per second; an index file if a project keeps hundreds of runs.
  const runs = new Map<string, WatchRun>();

  on("session.start", async ($, e, next) => {
    const root = await $.session.root();
    const dir = `${root}/.jeyna/playtests`;
    let last: string | undefined;

    $.clock.every(1000, async () => {
      const entries = await $.fs.list(dir).catch(() => []);
      const seen = new Set<string>();
      for (const entry of entries) {
        if (entry.kind !== "dir") continue;
        const path = `${dir}/${entry.name}`;
        const stat = await $.fs.stat(`${path}/session.json`).catch(() => undefined);
        if (!stat) continue;
        seen.add(path);
        const known = runs.get(path);
        if (known && known.mtimeMs === stat.mtimeMs) continue;
        try {
          const session = JSON.parse(await $.fs.read(`${path}/session.json`)) as WatchSession;
          if (!session?.status || !Array.isArray(session.cases) || !Array.isArray(session.verdicts)) throw new Error("not a session");
          runs.set(path, { path, mtimeMs: stat.mtimeMs, session });
        } catch {
          // Half-written or not ours: keep the last text that parsed and let the staff tip say so.
          if (known) runs.set(path, { ...known, mtimeMs: stat.mtimeMs, invalid: true });
        }
      }
      for (const path of runs.keys()) if (!seen.has(path)) runs.delete(path);

      const model = watch([...runs.values()], await $.clock.now(), root);
      const text = JSON.stringify(model);
      if (text === last) return;
      last = text;
      await update($, shown, () => model);
    });

    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const b = await read($, shown);
    if (!b || e.props.hasSurvey) return next(e);

    const { Box, Text } = $.ui.resolve(e);
    const spans = (row: typeof b.head) =>
      row.map((c, i) => (
        <Text key={`${i}`} color={c.dim ? DIM : c.color} dimColor={c.dim}>
          {c.text}
        </Text>
      ));
    const art = (row: typeof b.head) => <Text>{row.map((c, i) => <Text key={`${i}`} color={c.color}>{c.text}</Text>)}</Text>;

    return (
      <Box flexDirection="row" gap={1} width={e.props.bodyColumns}>
        <Box flexDirection="column" width={10} flexShrink={0}>
          {b.crab.map((row, i) => (
            <Box key={`${i}`}>{art(row)}</Box>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="row" justifyContent="space-between" gap={2}>
            <Text wrap="truncate-end">{spans(b.head)}</Text>
            <Text wrap="truncate-end">{spans(b.tally)}</Text>
          </Box>
          <Text wrap="truncate-end">{spans(b.cases)}</Text>
          <Text wrap="truncate-end">{spans(b.foot)}</Text>
        </Box>
      </Box>
    );
  });
};
