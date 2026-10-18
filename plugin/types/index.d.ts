// Jeyna's state contract: the values its hooks module keeps in `$.state` (D35).

/** One run of coloured characters on the band; `dim` draws it in the theme's dim colour. */
export type WatchSpan = { text: string; color?: string; dim?: boolean };

/** Jeyna's Watch: the three-line band above the prompt while a run is live, built from session.json alone. */
export type WatchBand = {
  /** Claw'd as Jaina, three rows of quarter-block cells, one colour per cell. */
  crab: WatchSpan[][];
  /** Line 1, left: flow, run id, status and batch. */
  head: WatchSpan[];
  /** Line 1, right-aligned: cases, findings, elapsed. */
  tally: WatchSpan[];
  /** Line 2: every case id with its verdict word. */
  cases: WatchSpan[];
  /** Line 3: last change and the run path, or the report path once done. */
  foot: WatchSpan[];
};

declare module "claude-code" {
  interface PluginState {
    jeyna: { watch: WatchBand | null };
  }
}
