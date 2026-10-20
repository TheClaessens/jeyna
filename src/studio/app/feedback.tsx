// Studio · Feedback (D36): every item with its status and the prompt to hand Claude, and one item's page, where the
// developer edits the text while it is open, sets its status (done is theirs to give) or deletes it.
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { FeedbackFront, FeedbackItem, FeedbackStatus } from "../../feedback.js";
import * as m from "../model.js";
import type { StudioIndex } from "../types.js";
import { captureUrl, feedbackApi, Flipbook, prompt } from "./capture.js";
import { evidenceUrl } from "./run.js";
import { Arrow, Card, CopyButton, CopyIcon, Glyph, VerdictChip } from "./ui.js";

export const FEEDBACK_VIEWS = ["todo", "open", "processed", "done", "wontfix", "all"] as const;
export type FeedbackView = (typeof FEEDBACK_VIEWS)[number];
const VIEW_LABEL: Record<FeedbackView, string> = { todo: "To do", open: "Open", processed: "Processed", done: "Done", wontfix: "Won't fix", all: "All" };
// To do is what still needs someone: open for Claude, processed for the developer's check. A broken item always shows.
const inView = (i: FeedbackItem, v: FeedbackView) =>
  !i.front || v === "all" || (v === "todo" ? i.front.status === "open" || i.front.status === "processed" : i.front.status === v);
export const todo = (items: FeedbackItem[]) => items.filter((i) => inView(i, "todo")).length;

const title = (i: FeedbackItem) => i.text.split("\n")[0] || i.id;

export function FeedbackStatusChip({ status, sm = true }: { status: FeedbackStatus; sm?: boolean }) {
  if (status === "open") return <span className={`chip open ${sm ? "sm" : ""}`}>open</span>;
  if (status === "processed") return <VerdictChip kind="blocked" label="processed · check it" sm={sm} />;
  return <VerdictChip kind={status === "done" ? "pass" : "wontfix"} label={status === "done" ? "done" : "won't fix"} sm={sm} />;
}

function Where({ front }: { front: FeedbackFront }) {
  if (front.source === "live") return <span>Live</span>;
  return (
    <span>
      {front.finding ? (
        <Link to="/runs/$runId/findings/$findingId" params={{ runId: front.run!, findingId: front.finding }}>{front.finding}</Link>
      ) : (
        <Link to="/runs/$runId" params={{ runId: front.run! }}>{front.run}</Link>
      )}{" "}
      · {front.evidence}
    </span>
  );
}

export function FeedbackListScreen({ index }: { index: StudioIndex }) {
  const { show: view = "todo" } = useSearch({ strict: false }) as { show?: FeedbackView };
  const navigate = useNavigate();
  const items = [...index.feedback].reverse().filter((i) => inView(i, view)); // newest first
  return (
    <div className="center">
      <main className="feedback">
        <section className="head">
          <div className="title"><h1>Feedback</h1></div>
          <p className="summary">Snap or record on <Link to="/live">Live</Link> or on a finding's evidence. Then hand it to Claude:</p>
          <div className="row">
            <code className="prompt">{prompt()}</code>
            <CopyButton text={prompt()} label="Copy prompt" icon={<CopyIcon />} />
            <span className="muted">lists what is to do; <span className="mono">/jeyna:feedback-next</span> takes the oldest open item.</span>
          </div>
        </section>
        <div role="group" aria-label="Status" className="seg">
          {FEEDBACK_VIEWS.map((v) => (
            <button key={v} type="button" aria-pressed={v === view} onClick={() => navigate({ to: "/feedback", search: v === "todo" ? {} : { show: v }, replace: true } as never)}>
              {VIEW_LABEL[v]} <span className="n">{index.feedback.filter((i) => i.front && inView(i, v)).length}</span>
            </button>
          ))}
        </div>
        <Card className="fblist" pad={false}>
          {items.map((i) => (
            <Link key={i.id} to="/feedback/$feedbackId" params={{ feedbackId: i.id }} className="row">
              <span className="thumb">{i.front ? <img src={captureUrl(i.front.frames[0].file)} alt="" /> : <Glyph kind="blocked" size={20} />}</span>
              <span className="id">{i.id}</span>
              <span className="ttl">
                <span className="t">{title(i)}</span>
                <span className="where">
                  {i.front ? (
                    <>{i.front.capture === "recording" ? `recording · ${i.front.frames.length} frames` : "snap"} · {i.front.source === "live" ? "Live" : `${i.front.finding ?? i.front.run} · ${i.front.evidence}`} · {m.dateTime(i.front.created)}</>
                  ) : (
                    <span className="error">does not parse: {i.errors[0]}</span>
                  )}
                </span>
              </span>
              {i.front && <FeedbackStatusChip status={i.front.status} />}
            </Link>
          ))}
          {!items.length && <p className="empty">{index.feedback.length ? "Nothing here with this status." : "No feedback yet."}</p>}
        </Card>
      </main>
    </div>
  );
}

export function FeedbackScreen({ index, item }: { index: StudioIndex; item: FeedbackItem }) {
  const navigate = useNavigate();
  const fr = item.front;
  const [text, setText] = useState(item.text);
  const [error, setError] = useState("");
  useEffect(() => setText(item.text), [item.text]);

  const act = (f: () => Promise<unknown>) => () => {
    setError("");
    f().catch((e) => setError((e as Error).message));
  };
  const status = (s: FeedbackStatus) => act(() => feedbackApi("PATCH", item.id, { status: s }));
  const remove = act(async () => {
    if (!confirm(`Delete ${item.id} and its capture? This cannot be undone.`)) return;
    await feedbackApi("DELETE", item.id);
    navigate({ to: "/feedback" } as never);
  });

  return (
    <div className="center">
      <main className="finding">
        <nav aria-label="Feedback navigation" className="fnav">
          <Link to="/feedback" className="back"><Arrow dir="left" />Feedback</Link>
        </nav>

        <section className="fhead">
          <span className="id">{item.id}</span>
          <h1>{title(item)}</h1>
          {fr && (
            <div className="chips">
              <FeedbackStatusChip status={fr.status} sm={false} />
              <span className="vr" aria-hidden="true" />
              <span className="chip meta">capture <b>{fr.capture === "recording" ? `recording · ${fr.frames.length} frames` : "snap"}</b></span>
              <span className="chip meta">from <b><Where front={fr} /></b></span>
              <span className="chip meta">created <b className="mono" title={fr.created}>{m.dateTime(fr.created)}</b></span>
              {fr.note && <span className="chip meta">note <b>{fr.note}</b></span>}
            </div>
          )}
        </section>

        {!!item.errors.length && (
          <Card className="attention" pad={false} title={<><Glyph kind="blocked" size={16} />Needs attention</>} sub={`.jeyna/feedback/${item.path}`}>
            <div className="row"><ul>{item.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
          </Card>
        )}

        <section className="tools">
          <div className="row">
            <code className="prompt">{prompt(item.id)}</code>
            <CopyButton text={prompt(item.id)} label="Copy prompt" icon={<CopyIcon />} />
            <span className="vr" aria-hidden="true" />
            {fr?.status === "processed" && <button type="button" className="btn primary" onClick={status("done")}>Checked: done</button>}
            {fr && fr.status !== "open" && <button type="button" className="btn" onClick={status("open")}>Reopen</button>}
            {fr && fr.status !== "wontfix" && fr.status !== "done" && <button type="button" className="btn" onClick={status("wontfix")}>Won't fix</button>}
            <button type="button" className="btn danger" onClick={remove}>Delete</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </section>

        {fr && (
          <Card title="Capture" className="evidence" sub={fr.source === "evidence" && <a href={evidenceUrl(fr.run!, fr.evidence!)} target="_blank" rel="noreferrer">full evidence image</a>}>
            {fr.capture === "recording" ? <Flipbook frames={fr.frames} /> : <img src={captureUrl(fr.frames[0].file)} alt={`Capture of ${item.id}`} />}
          </Card>
        )}

        <Card title="Feedback" sub={fr?.status === "open" ? "editable while open" : "reopen to edit"}>
          {fr?.status === "open" ? (
            <form className="fbtext" onSubmit={(e) => (e.preventDefault(), act(() => feedbackApi("PATCH", item.id, { text }))())}>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label="Feedback text" />
              <div className="row">
                <button type="submit" className="btn primary" disabled={text.trim() === item.text || !text.trim()}>Save text</button>
                {text !== item.text && <button type="button" className="btn" onClick={() => setText(item.text)}>Discard changes</button>}
              </div>
            </form>
          ) : (
            <p className="fbbody">{item.text}</p>
          )}
        </Card>

        <Card className="source" title="Source" sub={<span className="mono">{index.root}/.jeyna/feedback/{item.path}</span>}>
          <pre>{item.source}</pre>
        </Card>
      </main>
    </div>
  );
}
