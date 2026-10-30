// Studio · Feedback (D36): the board of every item in three columns (To do, Claude did it, Closed) as tiles or a list,
// with the prompt to hand Claude; and one item's page, where the developer edits the text while it is open, checks
// Claude's work and marks it done, or lets it go.
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { FeedbackItem, FeedbackStatus } from "../../feedback.js";
import * as m from "../model.js";
import type { StudioIndex } from "../types.js";
import { captureUrl, feedbackApi, Flipbook, prompt } from "./capture.js";
import { evidenceUrl } from "./run.js";
import { CopyButton, Vacant } from "./ui.js";

// To do is what still needs someone: open for Claude, processed for the developer's check (the sidebar's count).
export const todo = (items: FeedbackItem[]) => items.filter((i) => !i.front || i.front.status === "open" || i.front.status === "processed").length;

type Column = "todo" | "processed" | "closed";
// A broken item always shows, in To do, so it gets fixed.
const columnOf = (i: FeedbackItem): Column =>
  !i.front || i.front.status === "open" ? "todo" : i.front.status === "processed" ? "processed" : "closed";
const COLUMNS: { key: Column; title: string; small: string; empty: string; said: string }[] = [
  { key: "todo", title: "To do", small: "newest first", empty: "Nothing to do", said: "Snap or record on Live; what you write lands here for Claude." },
  { key: "processed", title: "Claude did it", small: "check these", empty: "Nothing to check", said: "Items land here once Claude has worked on them. You check each one and mark it done." },
  { key: "closed", title: "Closed", small: "done or won’t fix", empty: "Nothing closed", said: "Items you mark done, or won’t fix, end up here." },
];
const newestFirst = (items: FeedbackItem[]) => [...items].reverse();
const when = (iso: string) => `${m.day(iso)}, ${m.hm(iso)}`;
const statusWord = (s: FeedbackStatus) => (s === "wontfix" ? "won’t fix" : s);

function Kind({ item, cls }: { item: FeedbackItem; cls: string }) {
  const f = item.front!;
  return f.capture === "recording" ? <span className={`${cls} r`}>{f.frames.length} frames</span> : <span className={cls}>snap</span>;
}

function Card({ item, row }: { item: FeedbackItem; row?: boolean }) {
  const f = item.front;
  const [error, setError] = useState("");
  const link = (
    <Link to="/feedback/$feedbackId" params={{ feedbackId: item.id }} className={row ? "fb row" : undefined}>
      <span className="shot">
        {f ? <img src={captureUrl(f.frames[0].file)} alt="" loading="lazy" /> : <span aria-hidden="true">⚠</span>}
        {f && !row && <Kind item={item} cls="rec" />}
      </span>
      <span className="body">
        <span className="t">{item.text.split("\n")[0] || item.id}</span>
        <span className="m">
          <span className="mono">{item.id}{f && f.status !== "open" && f.status !== "processed" ? ` · ${statusWord(f.status)}` : ""}</span>
          {f ? (
            <>
              {row && <Kind item={item} cls="kind" />}
              <span>{when(f.created)}</span>
            </>
          ) : (
            <span className="error">does not parse: {item.errors[0]}</span>
          )}
        </span>
      </span>
    </Link>
  );
  if (row) return link;
  return (
    <div className="fb">
      {link}
      {f?.status === "processed" && (
        <div className="act">
          <button type="button" className="btn primary" onClick={() => (setError(""), feedbackApi("PATCH", item.id, { status: "done" }).catch((e) => setError((e as Error).message)))}>
            Checked: done
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

const SHOWN = 6;
function Col({ col, items, list }: { col: (typeof COLUMNS)[number]; items: FeedbackItem[]; list: boolean }) {
  const [all, setAll] = useState(false);
  const shown = list || all || col.key !== "todo" ? items : items.slice(0, SHOWN);
  return (
    <div className="col">
      <header><span className="px">{items.length}</span><h2>{col.title}</h2><small>{col.small}</small></header>
      {!items.length ? (
        <div className="vacant"><b>{col.empty}</b>{col.said}</div>
      ) : list ? (
        <div className="rows">{shown.map((i) => <Card key={i.id} item={i} row />)}</div>
      ) : (
        <div className={`cards ${col.key === "todo" ? "" : "one"}`}>{shown.map((i) => <Card key={i.id} item={i} />)}</div>
      )}
      {shown.length < items.length && (
        <button type="button" className="btn ghost" style={{ alignSelf: "center" }} onClick={() => setAll(true)}>{items.length - shown.length} more</button>
      )}
    </div>
  );
}

export function FeedbackListScreen({ index }: { index: StudioIndex }) {
  const { view } = useSearch({ strict: false }) as { view?: "list" };
  const navigate = useNavigate();
  const list = view === "list";
  const items = newestFirst(index.feedback);
  const setView = (v?: "list") => navigate({ to: "/feedback", search: v ? { view: v } : {}, replace: true } as never);
  return (
    <>
      <section className="top" style={{ gap: 22 }}>
        <h1 className="h1" style={{ fontSize: 44 }}>Feedback</h1>
        <p className="lead">Snap or record on <Link to="/live">Live</Link>, write what should change, then hand the list to Claude.</p>
        <div className="prompt">
          <code>{prompt()}</code>
          <CopyButton text={prompt()} label="Copy prompt" className="primary big" />
          <span className="meta"><span className="mono">/jeyna:feedback-next</span> takes only the oldest</span>
          <span className="grow" />
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={!list} onClick={() => setView()}>▦ Tiles</button>
            <button type="button" aria-pressed={list} onClick={() => setView("list")}>☰ List</button>
          </div>
        </div>
      </section>
      {index.feedback.length ? (
        <section className={`board ${list ? "list" : ""}`}>
          {COLUMNS.map((c) => <Col key={c.key} col={c} items={items.filter((i) => columnOf(i) === c.key)} list={list} />)}
        </section>
      ) : (
        <Vacant title="No feedback yet">
          <span>Open the app on <Link to="/live" className="link">Live</Link> and press ⌥⇧S to snap what should change.</span>
        </Vacant>
      )}
    </>
  );
}

const STEPS = ["To do", "Claude did it", "Done"];
const EXPLAIN: Record<FeedbackStatus, string> = {
  open: "Paste it in Claude Code. Claude moves it to “Claude did it”; you check it and mark it done.",
  processed: "Claude worked on this. Check it in the app, then mark it done; reopen it from ⋯ if it needs another pass.",
  done: "Done. Reopen it if the problem comes back.",
  wontfix: "Won’t fix. Reopen it to hand it to Claude again.",
};

export function FeedbackScreen({ index, item }: { index: StudioIndex; item: FeedbackItem }) {
  const navigate = useNavigate();
  const fr = item.front;
  const [text, setText] = useState(item.text);
  const [error, setError] = useState("");
  const [source, setSource] = useState(false);
  useEffect(() => setText(item.text), [item.text]);

  const col = columnOf(item);
  const peers = newestFirst(index.feedback).filter((i) => columnOf(i) === col);
  const at = peers.findIndex((i) => i.id === item.id);
  const prev = peers[at - 1];
  const next = peers[at + 1];
  const go = (i?: FeedbackItem) => i && navigate({ to: "/feedback/$feedbackId", params: { feedbackId: i.id } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "") || document.querySelector("dialog[open]")) return;
      if (e.key === "j" && next) go(next);
      else if (e.key === "k" && prev) go(prev);
      else if (e.key === "Escape") navigate({ to: "/feedback" });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const act = (f: () => Promise<unknown>) => () => {
    setError("");
    f().catch((e) => setError((e as Error).message));
  };
  const status = (s: FeedbackStatus) => act(() => feedbackApi("PATCH", item.id, { status: s }));
  const remove = act(async () => {
    if (!confirm(`Delete ${item.id} and its capture? This cannot be undone.`)) return;
    await feedbackApi("DELETE", item.id);
    navigate({ to: "/feedback" });
  });
  const step = !fr ? -1 : fr.status === "open" ? 0 : fr.status === "processed" ? 1 : 2;
  const colWord = col === "todo" ? "to do" : col === "processed" ? "to check" : "closed";

  return (
    <>
      <nav className="fnav" aria-label="Feedback navigation">
        <Link to="/feedback" className="back">← Feedback</Link>
        <span className="grow" />
        <span className="meta">{at + 1} of {peers.length} {colWord}</span>
        <button type="button" className="btn" aria-label="Previous (k)" aria-disabled={!prev} onClick={() => go(prev)}>↑</button>
        <button type="button" className="btn" aria-label="Next (j)" aria-disabled={!next} onClick={() => go(next)}>↓</button>
        <details className="menu" onClick={(e) => e.target instanceof HTMLButtonElement && e.currentTarget.removeAttribute("open")}>
          <summary className="btn ghost" aria-label="More: won’t fix, delete, source">⋯</summary>
          <div className="pop">
            {fr && fr.status !== "open" && <button type="button" onClick={status("open")}>Reopen</button>}
            {fr && (fr.status === "open" || fr.status === "processed") && <button type="button" onClick={status("wontfix")}>Won’t fix</button>}
            <button type="button" onClick={() => setSource(!source)}>{source ? "Hide source" : "View source"}</button>
            <button type="button" className="danger" onClick={remove}>Delete</button>
          </div>
        </details>
      </nav>

      {!!item.errors.length && (
        <section className="attention" aria-label="Needs attention">
          <h2>Needs attention <span>.jeyna/feedback/{item.path}</span></h2>
          <ul>{item.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </section>
      )}

      {fr && (
        <section className="item">
          <figure className="stage">
            {fr.capture === "recording" ? <Flipbook frames={fr.frames} alt={item.id} /> : <img src={captureUrl(fr.frames[0].file)} alt={`Capture of ${item.id}`} />}
          </figure>
          <div className="side2">
            <div className="steps3" aria-label={`Status: ${statusWord(fr.status)}`}>
              {STEPS.map((w, n) => (
                <span key={w} style={{ display: "contents" }}>
                  {n > 0 && <span className="bar" />}
                  <span className={n === step ? "on" : ""} aria-current={n === step ? "step" : undefined}>
                    <span className="dot">{n + 1}</span>
                    {n === 2 && fr.status === "wontfix" ? "Won’t fix" : w}
                  </span>
                </span>
              ))}
            </div>
            <div className="mono meta">
              {item.id} · {fr.capture} ·{" "}
              {fr.source === "live" ? (
                <span title={fr.url}>Live</span>
              ) : fr.finding ? (
                <Link to="/runs/$runId/findings/$findingId" params={{ runId: fr.run!, findingId: fr.finding }} className="link">{fr.finding}</Link>
              ) : (
                <a href={evidenceUrl(fr.run!, fr.evidence!)} className="link">{fr.evidence}</a>
              )}{" "}
              · {when(fr.created)}
            </div>
            <form className="fbnote" onSubmit={(e) => (e.preventDefault(), act(() => feedbackApi("PATCH", item.id, { text }))())}>
              <label htmlFor="fbtext">What should change</label>
              <textarea id="fbtext" value={text} readOnly={fr.status !== "open"} onChange={(e) => setText(e.target.value)} />
              <div className="actions">
                {fr.status === "open" && <CopyButton text={prompt(item.id)} label={`Copy ${prompt(item.id)}`} className="primary big" />}
                {fr.status === "processed" && <button type="button" className="btn primary big" onClick={status("done")}>Checked: done</button>}
                {(fr.status === "done" || fr.status === "wontfix") && <button type="button" className="btn primary big" onClick={status("open")}>Reopen</button>}
                {fr.status === "open" && <button type="submit" className="btn big" disabled={text.trim() === item.text.trim() || !text.trim()}>Save text</button>}
              </div>
            </form>
            <p className="meta">{EXPLAIN[fr.status]}</p>
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        </section>
      )}
      {!fr && error && <p className="error" role="alert">{error}</p>}
      {(source || !fr) && <pre className="source">{item.source}</pre>}
    </>
  );
}
