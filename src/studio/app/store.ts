// The index as the sidecar pushes it over SSE: one event replaces the whole document. EventSource reconnects by itself.
import { useSyncExternalStore } from "react";
import type { StudioIndex } from "../types.js";

export type State = { index: StudioIndex | null; connected: boolean };
let state: State = { index: null, connected: false };
const subs = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const s of subs) s();
};

let source: EventSource | undefined;
function connect() {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  source.addEventListener("index", (e) => set({ index: JSON.parse((e as MessageEvent).data), connected: true }));
  source.onopen = () => set({ connected: true });
  source.onerror = () => set({ connected: false });
}

export function useStudio(): State {
  connect();
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
  );
}

// A clock that ticks once a second, for "last change 4 s ago" and the elapsed time of a running run.
let now = Date.now();
const ticks = new Set<() => void>();
setInterval(() => {
  now = Date.now();
  for (const t of ticks) t();
}, 1000);
export function useNow(): number {
  return useSyncExternalStore(
    (cb) => {
      ticks.add(cb);
      return () => ticks.delete(cb);
    },
    () => now,
  );
}
