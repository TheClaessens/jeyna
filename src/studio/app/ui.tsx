// The shell and the shared marks: the sidebar (mark, project, sections, runs with their pips), the severity diamond,
// the verdict dot, the crab, and the copy button.
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import type { FindingFront } from "../../validate.js";
import * as m from "../model.js";
import type { StudioIndex, StudioRun } from "../types.js";

export type Section = "playtests" | "live" | "feedback";

// Severity: a diamond in its colour and the word.
export const Sev = ({ severity }: { severity: FindingFront["severity"] }) => <span className={`sev ${severity}`}>{severity}</span>;

// A verdict: a dot in its colour and the word; outline and "no verdict" when the case has none.
export const V = ({ result, children }: { result?: string; children?: ReactNode }) => (
  <span className={`v ${result ?? "none"}`}>{children ?? (result ?? "no verdict")}</span>
);

// The crab keeps its own navy tile in both themes. Empty and idle moments only.
export const Crab = ({ className }: { className?: string }) => <img src="/crab.svg" alt="" className={className} />;

export const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const Cross = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
);

export function Pips({ session }: { session: StudioRun["session"] }) {
  const p = m.pips(session);
  if ("bar" in p) {
    return (
      <span className="pipbar" title={p.title} aria-hidden="true">
        {(Object.keys(p.bar) as m.Mark[]).map((k) => (p.bar[k] ? <i key={k} className={k} style={{ flex: p.bar[k] }} /> : null))}
      </span>
    );
  }
  return (
    <span className={`pips ${p.dense ? "dense" : ""}`} aria-hidden="true">
      {p.marks.map((k, i) => <i key={i} className={`pip ${k}`} />)}
    </span>
  );
}

const ICONS: Record<Section, ReactNode> = {
  playtests: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  ),
  feedback: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" strokeLinejoin="round" /></svg>
  ),
  live: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>
  ),
};

export function Sidebar({ index, connected, section, runId, todo }: { index: StudioIndex | null; connected: boolean; section: Section; runId?: string; todo: number }) {
  const runs = index?.runs ?? [];
  const idle = section === "live" && !!index && !index.window.open && !runs.some((r) => r.session?.status === "running");
  const here = (s: Section) => (section === s ? ("page" as const) : undefined);
  return (
    <aside className="side">
      <Link to="/" className="mark" aria-label="Jeyna, home">
        <img src="/anchor.svg" alt="" />
        <b>Jeyna</b>
      </Link>
      <span className="proj">
        <span className={`diamond ${connected ? "" : "off"}`} aria-hidden="true" />
        <span className="name">{index?.app?.name ?? "this project"}</span>
        <span className="grow" />
        <span className="mono">{connected ? "watching" : "reconnecting"}</span>
      </span>
      <nav className="navs" aria-label="Sections">
        <Link to="/" aria-current={here("playtests")}>{ICONS.playtests}Playtests</Link>
        <Link to="/feedback" aria-current={here("feedback")}>
          {ICONS.feedback}Feedback{todo ? <span className="n" aria-label={`${todo} to do`}>{todo}</span> : null}
        </Link>
        <Link to="/live" aria-current={here("live")}>{ICONS.live}Live</Link>
      </nav>
      <h2 id="runs-h">Runs</h2>
      <nav className="runs" aria-labelledby="runs-h">
        {runs.map((r) => {
          const s = r.session;
          return (
            <Link key={r.id} to="/runs/$runId" params={{ runId: r.id }} aria-current={r.id === runId ? "page" : undefined} title={r.id}>
              <span className="when">{s ? `${m.day(s.started)} · ${m.hm(s.started)}` : r.id}</span>
              <span className="flow">{s ? `${m.flowName(s)} · ${m.outcome(s).text}` : r.sessionError ? "session.json does not read" : "no session.json"}</span>
              <Pips session={s} />
            </Link>
          );
        })}
        {index && !runs.length && <span className="meta" style={{ padding: "0 10px" }}>No runs yet.</span>}
      </nav>
      {idle && (
        <div className="foot">
          <Crab />
          All quiet on deck.
        </div>
      )}
    </aside>
  );
}

// Copies text and says so for a moment. Localhost is a secure context, so the clipboard API is available.
export function CopyButton({ text, label, className = "", ariaLabel }: { text: string; label: string; className?: string; ariaLabel?: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    });
  };
  return (
    <button type="button" className={`btn ${className}`} onClick={copy} title={text} aria-label={ariaLabel}>
      {done ? "Copied" : label}
    </button>
  );
}

// An empty page: the crab, a display-font line and what to do next.
export const Vacant = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="vacant page">
    <Crab />
    <b>{title}</b>
    {children}
  </div>
);
