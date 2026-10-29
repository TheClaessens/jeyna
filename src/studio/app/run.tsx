// Studio · Run (Playtests): the eyebrow, the score, the summary, what changed since the run before, the problems
// (findings with their duplicates folded in) and the cases as a contact sheet of their last screenshots.
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as m from "../model.js";
import type { StudioIndex, StudioRun } from "../types.js";
import { useNow } from "./store.js";
import { Crab, Sev, V } from "./ui.js";

export const evidenceUrl = (runId: string, file: string) => `/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(file)}`;
export const filePath = (index: StudioIndex, run: StudioRun, path: string) => `${index.root}/.jeyna/playtests/${run.id}/${path}`;
// A rendered section as one line of plain text (the problem card's Actual).
export const plain = (html = "") => new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

// Validation lines grouped by file, each a link when it is a finding file. Shown only when there is something.
export function Attention({ run }: { run: StudioRun }) {
  if (!run.errors.length) return null;
  const groups = new Map<string, string[]>();
  for (const line of run.errors) {
    const i = line.indexOf(": ");
    const [path, msg] = i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i + 2)];
    groups.set(path, [...(groups.get(path) ?? []), msg]);
  }
  return (
    <section className="attention" aria-label="Needs attention">
      <h2>Needs attention <span>{m.plural(groups.size, "file")} · the studio shows every file as it is and edits none</span></h2>
      {[...groups].map(([path, msgs]) => {
        const fid = /^findings\/(.+)\.md$/.exec(path)?.[1];
        return (
          <div key={path} className="row">
            <span className="path">{fid ? <Link to="/runs/$runId/findings/$findingId" params={{ runId: run.id, findingId: fid }}>{path}</Link> : path}</span>
            <ul>{msgs.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        );
      })}
    </section>
  );
}

// Below 900 px the sidebar's runs list hides; this picker stands in for it.
function Picker({ index, run }: { index: StudioIndex; run: StudioRun }) {
  const navigate = useNavigate();
  return (
    <label className="picker">
      <span className="sr">Run</span>
      <select value={run.id} onChange={(e) => navigate({ to: "/runs/$runId", params: { runId: e.target.value } })}>
        {index.runs.map((r) => (
          <option key={r.id} value={r.id}>
            {r.session ? `${m.day(r.session.started)} · ${m.hm(r.session.started)} · ${m.flowName(r.session)} · ${m.outcome(r.session).text}` : r.id}
          </option>
        ))}
      </select>
    </label>
  );
}

function Eyebrow({ index, run }: { index: StudioIndex; run: StudioRun }) {
  const s = run.session;
  const now = useNow();
  const [open, setOpen] = useState(false);
  const broken = run.findings.filter((f) => !f.front).length;
  return (
    <>
      <div className="eyebrow">
        {s ? (
          <>
            <b>{m.flowName(s)}</b>
            <span title={s.started}>{m.day(s.started)}, {m.hm(s.started)}</span>
            <span>{s.status === "running" ? `running · ${m.duration(s.started, now)}` : m.duration(s.started, s.finished ?? s.started)}</span>
            <span>{m.plural(s.testers.length, "tester")} · {s.mode}</span>
          </>
        ) : (
          <b>{run.sessionError ? "session.json does not read" : "no session.json"}</b>
        )}
        <span className="mono">{run.id}</span>
        <span className="grow" />
        {run.report && <a className="btn ghost" href={`/runs/${encodeURIComponent(run.id)}/report.md`} target="_blank" rel="noreferrer">Report</a>}
        <button type="button" className="btn ghost" aria-expanded={open} onClick={() => setOpen(!open)}>Details</button>
      </div>
      {open && (
        <dl className="kv" style={{ margin: 0 }}>
          {s && <><dt>Build</dt><dd>{s.build}</dd></>}
          {index.app && <><dt>App</dt><dd><a href={index.app.url}>{index.app.url}</a></dd></>}
          {s && <><dt>Started</dt><dd title={s.started}>{m.dateTime(s.started)}{s.finished ? ` → ${m.clock(s.finished)}` : ""}</dd></>}
          {s && <><dt>Testers</dt><dd>{s.testers.map((t) => `${t.id} ${t.model ?? ""}`.trim()).join(" · ") || "none"}</dd></>}
          <dt>Files</dt>
          <dd>
            {m.plural(run.findings.length, "finding file")}, {broken ? `${broken} ${broken === 1 ? "does" : "do"} not parse` : "all parse"} ·{" "}
            {run.errors.length ? `${m.plural(run.errors.length, "line")} need attention` : "nothing needs attention"}
          </dd>
          {run.sessionError && <><dt>session.json</dt><dd>{run.sessionError}</dd></>}
        </dl>
      )}
    </>
  );
}

function Score({ run, problems }: { run: StudioRun; problems: m.Problem[] }) {
  const s = run.session;
  if (!s) return null;
  const o = m.outcome(s);
  const seen = problems.reduce((n, p) => n + p.members.length, 0);
  const clean = o.tone === "pass" && !problems.length;
  return (
    <div className={`score ${o.tone}`}>
      <span className="big">{o.count}<small>/{o.of}</small></span>
      <span className="what">
        {o.of === 1 ? "case" : "cases"} {o.verb}
        <span>{problems.length ? `${m.plural(problems.length, "problem")}, seen ${m.plural(seen, "time")}` : clean ? "Clean sailing." : "no problems recorded"}</span>
      </span>
      {clean && <Crab className="crab" />}
    </div>
  );
}

const RANK: Record<string, number> = { fail: 0, blocked: 1, skipped: 1, pass: 2 };
function Since({ run }: { run: StudioRun }) {
  const d = run.since;
  if (!d?.changed.length) return null;
  const worse = d.changed.filter((c) => (RANK[c.now] ?? 1) < (RANK[c.was] ?? 1)).length;
  const better = d.changed.filter((c) => (RANK[c.now] ?? 1) > (RANK[c.was] ?? 1)).length;
  const lead = [worse && `${worse} got worse`, better && `${better} got better`].filter(Boolean).join(" · ") || `${d.changed.length} changed`;
  return (
    <div className={`since ${worse ? "" : "better"}`}>
      <span className={`v ${worse ? "fail" : "pass"}`}>{lead}</span>
      <span>since <Link to="/runs/$runId" params={{ runId: d.run }}>the run before</Link>:</span>
      <span className="lines">
        {d.changed.map((c, i) => (
          <span key={i} className="line">
            <b>{c.scenario}</b>
            <span className="mono meta">{m.viewport(c.viewport).label.toLowerCase()}</span>
            <V result={c.was} />
            <span className="arrow" aria-label="became">→</span>
            <V result={c.now} />
          </span>
        ))}
      </span>
    </div>
  );
}

function Problems({ run, problems }: { run: StudioRun; problems: m.Problem[] }) {
  const list = useRef<HTMLDivElement>(null);
  // j / k move the focus across the cards; Enter opens the focused one (it is a link).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || (e.key !== "j" && e.key !== "k")) return;
      const cards = [...(list.current?.querySelectorAll<HTMLAnchorElement>("a.prob") ?? [])];
      if (!cards.length) return;
      const at = cards.indexOf(document.activeElement as HTMLAnchorElement);
      const to = at < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, at + (e.key === "j" ? 1 : -1)));
      cards[to].focus();
      cards[to].scrollIntoView({ block: "nearest" });
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!problems.length) return null;
  const s = run.session;
  const mx = s && m.matrix(s);
  const statuses = new Map<string, number>();
  for (const p of problems) statuses.set(p.lead.front.status, (statuses.get(p.lead.front.status) ?? 0) + 1);
  const statusLine = statuses.size === 1 ? [...statuses.keys()][0] : [...statuses].map(([k, n]) => `${n} ${k}`).join(" · ");
  return (
    <section aria-labelledby="problems-h">
      <h2 className="h2" id="problems-h"><span className="px">{problems.length}</span>{problems.length === 1 ? "problem" : "problems"}<span className="meta">duplicates folded in · {statusLine}</span></h2>
      <div className="problems" ref={list}>
        {problems.map((p) => {
          const f = p.lead;
          const shot = f.front.evidence[0];
          return (
            <Link key={f.id} to="/runs/$runId/findings/$findingId" params={{ runId: run.id, findingId: f.id }} className={`prob ${p.closed ? "closed" : ""}`}>
              <span className="thumb">{shot ? <img src={evidenceUrl(run.id, shot)} alt="" loading="lazy" /> : <span className="meta">no screenshot</span>}</span>
              <span className="body">
                <span className="row">
                  <Sev severity={p.severity} />
                  <span className="tag">{f.front.kind}</span>
                  <span className="meta mono">{f.id} · {f.front.route}</span>
                  {p.closed && <span className="status">{f.front.status}</span>}
                </span>
                <span className="t">{f.title ?? f.id}</span>
                <span className="actual">{plain(f.sections.Actual)}</span>
              </span>
              <span className="hit">
                {mx && (
                  <span className="mini" style={{ gridTemplateColumns: `repeat(${mx.viewports.length}, 18px)` }} aria-hidden="true">
                    {mx.rows.flatMap((r) => r.cells.map((c, i) => <i key={`${r.scenario.name}-${i}`} className={!c.caseId ? "gap" : p.cases.includes(c.caseId) ? "on" : ""} />))}
                  </span>
                )}
                <span><b className="px">{p.cases.length}</b><br />{p.cases.length === 1 ? "case" : "cases"}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Cases({ run }: { run: StudioRun }) {
  const s = run.session;
  if (!s?.cases.length) return null;
  const mx = m.matrix(s);
  const vps = mx.viewports.map(m.viewport);
  return (
    <section aria-labelledby="cases-h">
      <h2 className="h2" id="cases-h"><span className="px">{s.cases.length}</span>{s.cases.length === 1 ? "case" : "cases"}<span className="meta">last screenshot of each</span></h2>
      <div className="sheet" style={{ gridTemplateColumns: `240px ${vps.map((v) => `minmax(0, ${v.tall ? 1 : 1.8}fr)`).join(" ")}` }}>
        <span className="hd">Scenario</span>
        {vps.map((v, i) => <span key={i} className="hd">{v.label} · {v.size}</span>)}
        {mx.rows.map(({ scenario, cells }) => [
          <div key={scenario.name} className="sc">
            <b>{scenario.name}</b>
            <small>Pass when {scenario.pass}</small>
            {[scenario.account ?? s.testers.find((t) => t.scenario === scenario.name && t.account)?.account].map(
              (a) => a && a !== "none" && <small key={a} className="mono">account {a}</small>,
            )}
          </div>,
          ...cells.map((c, i) => {
            const shot = c.caseId && m.lastEvidence(run.evidence, c.caseId);
            const result = c.verdict?.result;
            return (
              <div key={`${scenario.name}-${i}`} className="cell">
                <span className="lbl">{vps[i].label} · {vps[i].size}</span>
                {c.caseId ? (
                  <>
                    <a className={`frame ${result === "fail" ? "fail" : ""} ${vps[i].tall ? "" : "desk"}`} href={shot ? evidenceUrl(run.id, shot) : undefined} target="_blank" rel="noreferrer" aria-label={shot ? `${c.caseId}: open ${shot}` : undefined}>
                      {shot ? <img src={evidenceUrl(run.id, shot)} alt="" loading="lazy" /> : <span className="none-shot">no screenshot</span>}
                      <V result={result} />
                    </a>
                    {!!c.verdict?.findings.length && (
                      <span className="ids">
                        {c.verdict.findings.map((id) => (
                          <Link key={id} to="/runs/$runId/findings/$findingId" params={{ runId: run.id, findingId: id }} aria-label={id} title={id}>{id.replace(/^.*-/, "")}</Link>
                        ))}
                      </span>
                    )}
                    {c.verdict?.note && <span className="vnote">{c.verdict.note}</span>}
                  </>
                ) : (
                  <span className="meta">not played at this size</span>
                )}
              </div>
            );
          }),
        ])}
      </div>
    </section>
  );
}

export function RunScreen({ index, run }: { index: StudioIndex; run: StudioRun }) {
  const problems = m.problems(run);
  return (
    <>
      <section className="top">
        <Picker index={index} run={run} />
        <Eyebrow index={index} run={run} />
        <Score run={run} problems={problems} />
        {run.session?.summary && <p className="lead">{run.session.summary}</p>}
        <Since run={run} />
        <Attention run={run} />
      </section>
      <Problems run={run} problems={problems} />
      <Cases run={run} />
    </>
  );
}
