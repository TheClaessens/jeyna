// Studio · Finding: chips row, Steps / Expected / Actual, evidence at natural size, Suggested next step, the duplicates
// of this finding, the source (frontmatter, or the whole file), Copy path and Copy id, j / k / esc. Give feedback on an
// evidence image crops it into a feedback item (D36).
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as m from "../model.js";
import type { StudioFinding, StudioIndex, StudioRun } from "../types.js";
import { CaptureEditor, type Frame } from "./capture.js";
import { Attention, evidenceUrl, filePath } from "./run.js";
import { Arrow, Card, CopyButton, CopyIcon, Glyph, IdIcon, KindChip, Severity, StatusChip } from "./ui.js";

type Search = m.Filters & { view?: "source" };

const Html = ({ html, className }: { html?: string; className?: string }) => (
  <div className={`prose ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html ?? "" }} />
);

export function FindingScreen({ index, run, finding }: { index: StudioIndex; run: StudioRun; finding: StudioFinding }) {
  const search = useSearch({ strict: false }) as Search;
  const navigate = useNavigate();
  const [whole, setWhole] = useState(false);
  const [editor, setEditor] = useState<{ evidence: string; frame: Frame }>();
  // The evidence image itself, same-origin, so the crop canvas is not tainted.
  const giveFeedback = async (evidence: string) => {
    const img = new Image();
    img.src = evidenceUrl(run.id, evidence);
    await img.decode();
    setEditor({ evidence, frame: { src: img, w: img.naturalWidth, h: img.naturalHeight, ms: 0 } });
  };
  const { view, ...filters } = search;

  // Position among the rows the run screen shows with the same filters; a folded duplicate steps from its parent.
  const rows = m.filterRows(m.rows(run), run.session, filters);
  const own = rows.findIndex((r) => r.finding.id === finding.id);
  const parent = own < 0 ? rows.findIndex((r) => r.duplicates.some((d) => d.id === finding.id)) : -1;
  const base = own >= 0 ? own : parent;
  const prev = base > 0 ? rows[base - 1] : undefined;
  const next = base >= 0 ? rows[base + 1] : undefined;
  const go = (id: string) => navigate({ to: "/runs/$runId/findings/$findingId", params: { runId: run.id, findingId: id }, search: (s: Search) => s } as never);
  const back = () => navigate({ to: "/runs/$runId", params: { runId: run.id }, search: () => filters } as never);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
      if (e.key === "j" && next) go(next.finding.id);
      else if (e.key === "k" && prev) go(prev.finding.id);
      else if (e.key === "Escape") back();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fr = finding.front;
  const path = filePath(index, run, finding.path);
  const frontmatter = /^---\n[\s\S]*?\n---/.exec(finding.source)?.[0] ?? "";
  const dupRows = fr ? run.findings.filter(m.parsed).filter((d) => d.front.status === "duplicate" && d.front.of === finding.id).sort(m.bySeverity) : [];
  const attention: StudioRun = { ...run, errors: run.errors.filter((e) => e.startsWith(`${finding.path}: `)) };

  return (
    <div className="center">
      <main className="finding">
        <nav aria-label="Finding navigation" className="fnav">
          <Link to="/runs/$runId" params={{ runId: run.id }} search={() => filters} className="back">
            <Arrow dir="left" />Run <span className="mono">{run.id}</span>
          </Link>
          <div className="steps">
            <span className="pos">{own >= 0 ? `${own + 1} of ${rows.length}` : parent >= 0 ? `duplicate of ${rows[parent].finding.id}` : "outside the current filter"}</span>
            <button type="button" className="btn" aria-disabled={!prev} onClick={() => prev && go(prev.finding.id)}>
              <Arrow dir="left" />{prev ? <span className="mono" style={{ fontSize: 13 }}>{prev.finding.id}</span> : "Previous"}
            </button>
            <button type="button" className="btn" aria-disabled={!next} onClick={() => next && go(next.finding.id)}>
              {next ? <span className="mono" style={{ fontSize: 13 }}>{next.finding.id}</span> : "Next"}<Arrow />
            </button>
          </div>
        </nav>

        <section className="fhead">
          <span className="id">{finding.id}</span>
          <h1>{finding.title ?? finding.id}</h1>
          {fr && (
            <div className="chips">
              <span className={`chip ${fr.severity}`}><Glyph kind="severity" />{fr.severity}</span>
              <KindChip kind={fr.kind} sm={false} />
              <StatusChip front={fr} runId={run.id} sm={false} />
              <span className="vr" aria-hidden="true" />
              <span className="chip meta">scenario <b>{fr.scenario}</b></span>
              <span className="chip meta">viewport <b className="mono">{fr.viewport}</b></span>
              <span className="chip meta">route {index.app ? <a className="mono" href={`${index.app.url.replace(/\/+$/, "")}${fr.route}`}>{fr.route}</a> : <b className="mono">{fr.route}</b>}</span>
              <span className="chip meta">case <b className="mono">{fr.case}</b></span>
              <span className="chip meta">browser <b className="mono">{fr.browser}</b></span>
              <span className="chip meta">build <b className="mono">{fr.build}</b></span>
              {fr.author && <span className="chip meta">author <b className="mono">{fr.author}</b></span>}
              <span className="chip meta">created <b className="mono" title={fr.created}>{m.dateTime(fr.created)}</b></span>
            </div>
          )}
        </section>

        <Attention run={attention} />

        <section className="tools">
          <div className="row">
            <div role="group" aria-label="View" className="seg">
              <button type="button" aria-pressed={view !== "source"} onClick={() => navigate({ to: ".", search: (s: Search) => ({ ...s, view: undefined }), replace: true } as never)}>Rendered</button>
              <button type="button" aria-pressed={view === "source"} onClick={() => navigate({ to: ".", search: (s: Search) => ({ ...s, view: "source" }), replace: true } as never)}>Source</button>
            </div>
            <CopyButton text={path} label="Copy path" icon={<CopyIcon />} />
            <CopyButton text={finding.id} label="Copy id" icon={<IdIcon />} />
            <code>update_status {`{id: "${finding.id}", run: "${run.id}", status: "fixed"}`}</code>
          </div>
          {fr && (
            <div className="legend">
              <span className="label">Status after retest</span>
              <span className="chip open sm">open</span>
              <span className="dup-status">duplicate → <span className="mono">PT-…</span></span>
              <span className="chip fixed outline sm"><Glyph kind="fixed" size={12} />fixed</span>
              <span className="chip wontfix outline sm"><Glyph kind="wontfix" size={12} />wontfix</span>
              <span>set by update_status; only status ever changes in a finding file</span>
            </div>
          )}
        </section>

        {view === "source" || !fr ? (
          <Card className="source" title="Source" sub={<span className="mono">{finding.path} · whole file</span>}>
            <pre>{finding.source}</pre>
          </Card>
        ) : (
          <>
            <section className="twocol">
              <Card title="Steps" className="steps">
                <Html html={finding.sections.Steps} />
              </Card>
              <div className="stack">
                <Card title={<span className="verdict-h pass" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Glyph kind="pass" size={16} /><span>Expected</span></span>}>
                  <Html html={finding.sections.Expected} />
                </Card>
                <Card title={<span className="verdict-h fail" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Glyph kind="fail" size={16} /><span>Actual</span></span>}>
                  <Html html={finding.sections.Actual} />
                </Card>
              </div>
            </section>

            <Card title="Evidence" className="evidence">
              {fr.evidence.length ? (
                fr.evidence.map((e) => (
                  <figure key={e}>
                    <a href={evidenceUrl(run.id, e)} target="_blank" rel="noreferrer"><img src={evidenceUrl(run.id, e)} alt={e} /></a>
                    <figcaption>
                      <span>{e}</span><span className="dot">·</span><span className="vp">{fr.viewport}</span>
                      <button type="button" className="btn sm" onClick={() => giveFeedback(e)}>Give feedback</button>
                    </figcaption>
                  </figure>
                ))
              ) : (
                <p className="muted">None.</p>
              )}
            </Card>

            <Card title="Suggested next step">
              <Html html={finding.sections["Suggested next step"]} className={/None given\./.test(finding.sections["Suggested next step"] ?? "") ? "muted" : ""} />
            </Card>

            {!!dupRows.length && (
              <Card className="duprows" pad={false} title="Duplicates of this finding" sub={`${dupRows.length} · each keeps its own severity in its file`}>
                {dupRows.map((d) => (
                  <div key={d.id} className="row">
                    <Severity severity={d.front.severity} />
                    <KindChip kind={d.front.kind} />
                    <Link to="/runs/$runId/findings/$findingId" params={{ runId: run.id, findingId: d.id }} search={(s) => s} className="id">{d.id}</Link>
                    <div className="ttl">
                      <span className="t">{d.title}</span>
                      <span className="where">{d.front.route} · {d.front.scenario} · {d.front.viewport} · {m.clock(d.front.created)}</span>
                    </div>
                  </div>
                ))}
              </Card>
            )}

            <Card className="source" title="Source" sub={<span className="mono">{finding.path} · {whole ? "whole file" : "frontmatter"}</span>}>
              <pre>{whole ? finding.source : frontmatter}</pre>
              <button type="button" className="more" onClick={() => setWhole(!whole)}>{whole ? "Show the frontmatter only" : "Show the whole file"}</button>
            </Card>
          </>
        )}

        {editor && (
          <CaptureEditor frames={[editor.frame]} origin={{ source: "evidence", run: run.id, evidence: editor.evidence, finding: finding.id }} onClose={() => setEditor(undefined)} />
        )}

        <footer className="foot-keys">
          <span><kbd>j</kbd> / <kbd>k</kbd> next and previous finding</span>
          <span>·</span>
          <span><kbd>esc</kbd> back to the run</span>
        </footer>
      </main>
    </div>
  );
}
