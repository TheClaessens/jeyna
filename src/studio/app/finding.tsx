// Studio · Finding: the case file. Expected and Actual are the hero, then the steps to reproduce, beside or above the
// screenshot on its stage; the other findings of the same problem; the hand-off to Claude with the details behind it.
// j / k step through the problems in the run screen's order, Esc goes back. Give feedback on a screenshot opens it
// full size to select a region and write what should change (D36, D37).
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as m from "../model.js";
import type { StudioFinding, StudioIndex, StudioRun } from "../types.js";
import { EvidenceLightbox, SavedToast } from "./capture.js";
import { Attention, evidenceUrl, filePath } from "./run.js";
import { Check, CopyButton, Cross, Sev } from "./ui.js";

const Html = ({ html, className = "" }: { html?: string; className?: string }) => (
  <div className={`prose ${className}`} dangerouslySetInnerHTML={{ __html: html ?? "" }} />
);
const none = (html?: string) => !html || /^<p>None given\.?<\/p>$/.test(html.trim());

export function FindingScreen({ index, run, finding }: { index: StudioIndex; run: StudioRun; finding: StudioFinding }) {
  const { view } = useSearch({ strict: false }) as { view?: "source" };
  const navigate = useNavigate();
  // Fixed when opened, so the item names this finding even if the page behind changes.
  const [lightbox, setLightbox] = useState<{ run: string; evidence: string; finding: string }>();
  const [saved, setSaved] = useState<string>();

  const problems = m.problems(run);
  const at = m.problemOf(problems, finding.id);
  const prev = at > 0 ? problems[at - 1].lead : undefined;
  const next = at >= 0 ? problems[at + 1]?.lead : undefined;
  const go = (id: string) => navigate({ to: "/runs/$runId/findings/$findingId", params: { runId: run.id, findingId: id } });
  const back = () => navigate({ to: "/runs/$runId", params: { runId: run.id } });
  const setView = (v?: "source") => navigate({ to: ".", search: v ? { view: v } : {}, replace: true } as never);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "") || document.querySelector("dialog[open]")) return;
      if (e.key === "j" && next) go(next.id);
      else if (e.key === "k" && prev) go(prev.id);
      else if (e.key === "Escape") back();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fr = finding.front;
  const s = run.session;
  const attention: StudioRun = { ...run, errors: run.errors.filter((e) => e.startsWith(`${finding.path}: `)) };
  const others = at >= 0 ? problems[at].members.filter((f) => f.id !== finding.id) : [];
  const vp = fr && m.viewport(fr.viewport);

  const nav = (
    <nav className="fnav" aria-label="Finding navigation">
      <Link to="/runs/$runId" params={{ runId: run.id }} className="back">← {s ? `${m.flowName(s)} · ${m.day(s.started)}, ${m.hm(s.started)}` : run.id}</Link>
      <span className="grow" />
      <span className="meta">{at >= 0 ? `problem ${at + 1} of ${problems.length}` : "not in a problem"}</span>
      <button type="button" className="btn" aria-label="Previous problem (k)" aria-disabled={!prev} onClick={() => prev && go(prev.id)}>↑</button>
      <button type="button" className="btn" aria-label="Next problem (j)" aria-disabled={!next} onClick={() => next && go(next.id)}>
        {next && <span className="mono">{next.id}</span>} ↓
      </button>
    </nav>
  );

  const head = (
    <section className="fhead">
      {fr && vp && (
        <div className="row">
          <Sev severity={fr.severity} />
          <span className="tag">{fr.kind}</span>
          <span className="mono">{finding.id}</span>
          <span>{fr.scenario} · {vp.label.toLowerCase()} {vp.size} · <span className="mono">{fr.route}</span></span>
          {fr.status !== "open" && (
            <span>
              {fr.status}
              {fr.status === "duplicate" && fr.of && <> of <Link to="/runs/$runId/findings/$findingId" params={{ runId: run.id, findingId: fr.of }} className="mono link">{fr.of}</Link></>}
            </span>
          )}
        </div>
      )}
      <h1 className="h1">{finding.title ?? finding.id}</h1>
    </section>
  );

  if (view === "source" || !fr || !vp) {
    return (
      <>
        {nav}
        {head}
        <Attention run={attention} />
        <pre className="source">{finding.source}</pre>
        {fr && <p><button type="button" className="textbtn" onClick={() => setView()}>View rendered</button></p>}
      </>
    );
  }

  const ea = (
    <div className={`ea ${vp.tall ? "" : "cols"}`}>
      <div className="box expected"><h3><Check />Expected</h3><Html html={finding.sections.Expected} /></div>
      <div className="box actual"><h3><Cross />Actual</h3><Html html={finding.sections.Actual} /></div>
    </div>
  );
  const steps = (
    <div className={`steps ${vp.tall ? "" : "across"}`}>
      <h3>Steps to reproduce</h3>
      <Html html={finding.sections.Steps} />
    </div>
  );
  const stage = (
    <figure className={`stage ${vp.tall ? "" : "wide"}`}>
      {fr.evidence.length ? (
        fr.evidence.map((e) => (
          <div key={e} className="shot">
            <a href={evidenceUrl(run.id, e)} target="_blank" rel="noreferrer" style={{ width: vp.tall ? 340 : "100%", maxWidth: "100%" }}>
              <img src={evidenceUrl(run.id, e)} alt={e} style={{ width: "100%" }} />
            </a>
            <figcaption className="cap"><span>{e}</span><span>{vp.size}</span></figcaption>
            <button type="button" className="btn" style={vp.tall ? { alignSelf: "stretch", justifyContent: "center" } : undefined} onClick={() => setLightbox({ run: run.id, evidence: e, finding: finding.id })}>
              Give feedback on this screenshot
            </button>
          </div>
        ))
      ) : (
        <figcaption className="cap"><span>No screenshot.</span></figcaption>
      )}
    </figure>
  );
  const seen = !!others.length && (
    <div className="seen">
      <h3>{fr.status === "duplicate" ? "Same problem" : "Also seen in"}</h3>
      {others.map((d) => (
        <Link key={d.id} to="/runs/$runId/findings/$findingId" params={{ runId: run.id, findingId: d.id }}>
          <span className="mono">{d.id}</span>
          <span>{d.front.scenario}</span>
          <span className="grow" />
          <span className="meta">{m.viewport(d.front.viewport).label.toLowerCase()}</span>
        </Link>
      ))}
    </div>
  );
  const hand = (
    <div className="hand">
      {!none(finding.sections["Suggested next step"]) && (
        <div className="next"><h3>Suggested next step</h3><Html html={finding.sections["Suggested next step"]} /></div>
      )}
      <CopyButton text={filePath(index, run, finding.path)} label="Copy for Claude" className="primary" />
      <span className="meta">pastes <span className="mono">.jeyna/playtests/…/{finding.id}.md</span>; Claude fixes, a retest closes it</span>
      <span className="grow" />
      <details className="more">
        <summary>Details</summary>
        <dl className="kv">
          <dt>Case</dt><dd>{fr.case}</dd>
          <dt>Browser</dt><dd>{fr.browser}</dd>
          <dt>Build</dt><dd>{fr.build}</dd>
          {fr.author && <><dt>Tester</dt><dd>{fr.author}</dd></>}
          <dt>Created</dt><dd title={fr.created}>{m.dateTime(fr.created)}</dd>
          <dt>Status</dt><dd>{fr.status}{fr.of ? ` of ${fr.of}` : ""} · changes through update_status</dd>
          {index.app && <><dt>Route</dt><dd><a href={`${index.app.url.replace(/\/+$/, "")}${fr.route}`}>{fr.route}</a></dd></>}
        </dl>
        <code className="upd">update_status {`{id: "${finding.id}", run: "${run.id}", status: "fixed"}`}</code>
        <p style={{ marginTop: 10 }}><button type="button" className="textbtn" onClick={() => setView("source")}>View source</button></p>
      </details>
    </div>
  );

  return (
    <>
      {nav}
      {head}
      <Attention run={attention} />
      {vp.tall ? (
        <section className="case">
          {stage}
          <div className="repro">{ea}{steps}{seen}{hand}</div>
        </section>
      ) : (
        <>
          <section className="repro">{ea}{steps}</section>
          {stage}
          <section className="lower">{seen || <span />}{hand}</section>
        </>
      )}
      <footer className="meta keysfoot">
        <span><kbd>j</kbd> <kbd>k</kbd> next, previous problem</span>
        <span><kbd>esc</kbd> back to the run</span>
      </footer>
      {lightbox && <EvidenceLightbox {...lightbox} onClose={() => setLightbox(undefined)} onSaved={setSaved} />}
      {saved && <SavedToast id={saved} onDone={() => setSaved(undefined)} />}
    </>
  );
}
