// Shared pieces: the glyph set (one, nowhere redrawn), the chip in its two sizes, and the top bar.
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import type { Session } from "../../schema.js";
import type { FindingFront } from "../../validate.js";
import { ago } from "../model.js";
import { useNow } from "./store.js";

export type Verdict = Session["verdicts"][number]["result"];
export type GlyphKind = Verdict | "none" | "fixed" | "wontfix" | "running" | "aborted" | "severity";

const ink = "#F3F6F9"; // the ground colour, for marks drawn on a filled glyph
export function Glyph({ kind, size = 14 }: { kind: GlyphKind; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const };
  switch (kind) {
    case "pass":
    case "fixed":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M8 12.5l2.5 2.5L16 9.5" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "fail":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M9 9l6 6M15 9l-6 6" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "blocked":
      return (
        <svg {...p}>
          <path d="M12 3L22 20H2z" fill="currentColor" />
          <path d="M12 10v4M12 17v.5" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "skipped":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 3" />
        </svg>
      );
    case "wontfix":
    case "aborted":
      return (
        <svg {...p} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M7 17L17 7" />
        </svg>
      );
    case "running":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="12" cy="12" r="3.5" fill="currentColor" />
        </svg>
      );
    case "severity":
      return (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect width="10" height="10" rx="1" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
        </svg>
      );
  }
}

export const Arrow = ({ dir = "right", color }: { dir?: "left" | "right"; color?: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {dir === "right" ? (
      <>
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </>
    ) : (
      <>
        <path d="M19 12H5" />
        <path d="M11 18l-6-6 6-6" />
      </>
    )}
  </svg>
);
export const DupMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 4v8h12" />
    <path d="M14 8l4 4-4 4" />
  </svg>
);
export const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
export const IdIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7V4h16v3" />
    <path d="M9 20h6" />
    <path d="M12 4v16" />
  </svg>
);

// Verdict or run-status chip: glyph plus word, always both. `sm` is the 22 px size for rails, matrix notes and sub-rows.
export function VerdictChip({ kind, label, sm }: { kind: GlyphKind; label?: string; sm?: boolean }) {
  const outline = kind === "none";
  return (
    <span className={`chip ${kind} ${sm ? "sm" : ""} ${outline ? "outline" : ""}`}>
      <Glyph kind={kind} size={sm ? 12 : 14} />
      {label ?? (kind === "none" ? "no verdict" : kind)}
    </span>
  );
}

export const RunStatusChip = ({ status, sm }: { status: Session["status"]; sm?: boolean }) => (
  <VerdictChip kind={status === "done" ? "pass" : status} label={status} sm={sm} />
);

// Severity: colour and a square, no fill (the heat ramp). As a chip only in the counts row and the finding header.
export const Severity = ({ severity }: { severity: FindingFront["severity"] }) => (
  <span className={`sev ${severity}`}>
    <Glyph kind="severity" />
    {severity}
  </span>
);

export const KindChip = ({ kind, sm = true }: { kind: string; sm?: boolean }) => <span className={`chip kind ${sm ? "sm" : ""}`}>{kind}</span>;

// Status is the one field that changes in a finding file (D11): open · duplicate → id · fixed · wontfix.
export function StatusChip({ front, runId, sm = true }: { front: FindingFront; runId: string; sm?: boolean }) {
  if (front.status === "duplicate") {
    return (
      <span className="dup-status">
        duplicate →{" "}
        {front.of ? (
          <Link to="/runs/$runId/findings/$findingId" params={{ runId, findingId: front.of }} search={(s) => s}>
            {front.of}
          </Link>
        ) : (
          <span className="mono">?</span>
        )}
      </span>
    );
  }
  if (front.status === "open") return <span className={`chip open ${sm ? "sm" : ""}`}>open</span>;
  return (
    <span className={`chip ${front.status} outline ${sm ? "sm" : ""}`}>
      <Glyph kind={front.status} size={sm ? 12 : 14} />
      {front.status}
    </span>
  );
}

export function Anchor() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Jeyna">
      <circle cx="32" cy="10.5" r="6.5" />
      <path d="M32 7 L35.5 10.5 L32 14 L28.5 10.5 Z" fill="#8FD3FF" stroke="currentColor" strokeWidth="1.5" />
      <path d="M19 23 H45" />
      <circle cx="16.5" cy="23" r="4.5" fill="currentColor" stroke="none" />
      <circle cx="47.5" cy="23" r="4.5" fill="currentColor" stroke="none" />
      <path d="M32 17 V53" />
      <path d="M11 35 C12.5 46.5 21 53 32 53 C43 53 51.5 46.5 53 35" />
      <path d="M11 35 C6.5 33.5 4 29.5 5 25.5" />
      <path d="M11 35 C14 32 15.5 28.5 15 25" />
      <path d="M53 35 C57.5 33.5 60 29.5 59 25.5" />
      <path d="M53 35 C50 32 48.5 28.5 49 25" />
    </svg>
  );
}

export function TopBar({ app, run, findingId, generated, connected }: { app?: string; run?: Session | null; findingId?: string; generated?: string; connected: boolean }) {
  const now = useNow();
  return (
    <header className="top">
      <Link to="/" className="mark">
        <Anchor />
        <span>Jeyna studio</span>
      </Link>
      <nav aria-label="Breadcrumb" className="crumbs">
        {app && (
          <>
            <Link to="/">{app}</Link>
            <span className="sep">/</span>
            <Link to="/">playtests</Link>
          </>
        )}
        {run && (
          <>
            <span className="sep">/</span>
            {findingId ? (
              <Link to="/runs/$runId" params={{ runId: run.id }} search={(s) => s}>
                {run.id}
              </Link>
            ) : (
              <span className="here">{run.id}</span>
            )}
          </>
        )}
        {findingId && (
          <>
            <span className="sep">/</span>
            <span className="here">{findingId}</span>
          </>
        )}
      </nav>
      <div className="right">
        <span className={`watch ${connected ? "" : "off"}`}>
          {connected ? `watching .jeyna/${generated ? ` · last change ${ago(generated, now)}` : ""}` : "studio disconnected · retrying"}
        </span>
        {run && <RunStatusChip status={run.status} sm />}
      </div>
    </header>
  );
}

export function Card({ title, sub, children, className = "", pad = true }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${pad ? "pad" : ""} ${className}`}>
      {title && (
        <div className="cardhead" style={pad ? { padding: 0 } : undefined}>
          <h2>{title}</h2>
          {sub && <span className="sub">{sub}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

// Copies text and says so for a moment. Localhost is a secure context, so the clipboard API is available.
export function CopyButton({ text, label, icon, ariaLabel }: { text: string; label?: string; icon: ReactNode; ariaLabel?: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    });
  };
  return (
    <button type="button" className={`btn ${label ? "" : "icon"}`} onClick={copy} aria-label={ariaLabel} title={text}>
      {icon}
      {label && (done ? "Copied" : label)}
    </button>
  );
}
