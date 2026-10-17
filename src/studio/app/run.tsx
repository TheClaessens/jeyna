// Studio · Run: runs rail, header, counts as filter chips, scenario × viewport matrix, Since last run, the findings
// table with duplicates folded under the finding they repeat, and the needs-attention lane when there is something to attend to.
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Session } from "../../schema.js";
import * as m from "../model.js";
import type { StudioIndex, StudioRun } from "../types.js";
import { useNow } from "./store.js";
import { Arrow, Card, CopyButton, CopyIcon, DupMark, Glyph, type GlyphKind, KindChip, RunStatusChip, Severity, StatusChip, VerdictChip } from "./ui.js";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
export const evidenceUrl = (runId: string, file: string) => `/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(file)}`;
export const filePath = (index: StudioIndex, run: StudioRun, path: string) => `${index.root}/.jeyna/playtests/${run.id}/${path}`;

export function Rail({ index, current }: { index: StudioIndex; current?: string }) {
  return (
    <nav aria-label="Runs" className="rail">
      <h2>Runs</h2>
      <div className="list">
        {index.runs.map((r) => {
          const c = m.counts(r);
          const s = r.session;
          return (
            <Link key={r.id} to="/runs/$runId" params={{ runId: r.id }} className="run" aria-current={r.id === current ? "page" : undefined}>
              <span className="line">
                <span className="id">{r.id}</span>
                {s ? <RunStatusChip status={s.status} sm /> : <VerdictChip kind="blocked" label="unreadable" sm />}
              </span>
              <small>{s ? `${m.flowName(s)} · ${s.mode}${m.isRetest(s) ? " · retest" : ""}` : r.sessionError ? "session.json does not read" : "no session.json"}</small>
              <small>
                {m.plural(c.cases, "case")} · {m.plural(c.findings, "finding")}
                {c.duplicates ? ` · ${m.plural(c.duplicates, "duplicate")}` : ""}
              </small>
            </Link>
          );
        })}
        {!index.runs.length && <small className="muted" style={{ padding: "0 12px" }}>No runs yet.</small>}
      </div>
    </nav>
  );
}

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
    <Card className="attention" pad={false} title={<><Glyph kind="blocked" size={16} />Needs attention</>} sub={`${m.plural(groups.size, "file")} · the studio shows every file as it is and edits none`}>
      {[...groups].map(([path, msgs]) => {
        const fid = /^findings\/(.+)\.md$/.exec(path)?.[1];
        return (
          <div key={path} className="row">
            <span className="path">
              {fid ? (
                <Link to="/runs/$runId/findings/$findingId" params={{ runId: run.id, findingId: fid }} search={(s) => s}>
                  {path}
                </Link>
              ) : (
                path
              )}
            </span>
            <ul>{msgs.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        );
      })}
    </Card>
  );
}

function Head({ index, run }: { index: StudioIndex; run: StudioRun }) {
  const s = run.session;
  const now = useNow();
  const files = run.findings.length;
  const broken = run.findings.filter((f) => !f.front).length;
  const paths = new Set(run.errors.map((e) => e.slice(0, e.indexOf(": ")))).size;
  return (
    <section className="head">
      <div className="title">
        <h1>{s ? m.flowName(s) : run.id}</h1>
        {s ? <RunStatusChip status={s.status} /> : <VerdictChip kind="blocked" label="unreadable" />}
      </div>
      {s && (
        <div className="metaline">
          <span style={{ color: "var(--navy)" }}>{s.id}</span><span className="dot">·</span>
          <span>{s.mode}{m.isRetest(s) ? " · retest" : ""}</span><span className="dot">·</span>
          <span>build {s.build}</span><span className="dot">·</span>
          <span title={`${s.started}${s.finished ? ` → ${s.finished}` : ""}`}>{m.clock(s.started)} → {s.finished ? m.clock(s.finished) : "…"}</span><span className="dot">·</span>
          <span>{m.duration(s.started, s.finished ?? now)}</span><span className="dot">·</span>
          <span>{m.plural(s.testers.length, "tester")} in {m.plural(new Set(s.testers.map((t) => t.batch)).size || 1, "batch", "batches")}</span>
          {index.app && (<><span className="dot">·</span><a href={index.app.url}>{index.app.url}</a></>)}
        </div>
      )}
      <p className="files">
        {m.plural(files, "finding file")}, {broken ? `${broken} ${broken === 1 ? "does" : "do"} not parse` : "all parse"} ·{" "}
        {paths ? `${m.plural(paths, "file")} need${paths === 1 ? "s" : ""} attention` : "nothing needs attention"}
      </p>
      {s?.summary && <p className="summary">{s.summary}</p>}
    </section>
  );
}

type Set = (patch: Partial<m.Filters>) => void;

function Counts({ run, f, set }: { run: StudioRun; f: m.Filters; set: Set }) {
  const c = m.counts(run);
  const chip = (pressed: boolean, cls: string, glyph: ReactNode, label: string, n: number, onClick: () => void) => (
    <button key={label} type="button" className="chipbtn" aria-pressed={pressed} onClick={onClick}>
      <span className={`chip ${cls} ${n ? "" : "zero"}`}>{glyph}{label} <span className="n">{n}</span></span>
    </button>
  );
  return (
    <section aria-label="Counts" className="counts">
      <div className="group">
        <span className="label">Cases</span>
        {chip(!f.verdict, "neutral", null, "All", c.cases, () => set({ verdict: undefined }))}
        {m.RESULTS.map((r) => chip(f.verdict === r, r, <Glyph kind={r} />, cap(r), c[r], () => set({ verdict: f.verdict === r ? undefined : r })))}
      </div>
      <div className="group">
        <span className="label">Findings</span>
        {chip(!f.severity, "neutral", null, "All", c.findings, () => set({ severity: undefined }))}
        {m.SEVERITIES.map((s) => chip(m.list(f.severity).includes(s), s, <Glyph kind="severity" />, cap(s), c[s], () => set({ severity: m.toggled(f.severity, s) })))}
        {chip(m.showDuplicates(f), "duplicate", null, "Duplicates", c.duplicates, () => set({ dups: m.showDuplicates(f) ? "0" : undefined }))}
      </div>
    </section>
  );
}

function Matrix({ run, session, f }: { run: StudioRun; session: Session; f: m.Filters }) {
  const mx = m.matrix(session);
  return (
    <Card className="matrix" pad={false} title="Scenario matrix" sub={`${m.plural(session.scenarios.length, "scenario")} × ${m.plural(mx.viewports.length, "viewport")} · verdicts judge the Pass: line only`}>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              {mx.viewports.map((vp) => <th key={vp} scope="col" className="vp">{vp}</th>)}
            </tr>
          </thead>
          <tbody>
            {mx.rows.map(({ scenario, cells }) => (
              <tr key={scenario.name}>
                <th scope="row">
                  <span className="name">{scenario.name}</span>
                  <span className="pass-line">Pass: {scenario.pass}</span>
                  {scenario.account && <span className="account">Account: {scenario.account}</span>}
                </th>
                {cells.map((cell, i) => (
                  <td key={i}>
                    {!cell.caseId ? (
                      <span className="muted">–</span>
                    ) : (
                      <div className={`cell ${f.verdict && cell.verdict?.result !== f.verdict ? "dim" : ""}`}>
                        <VerdictChip kind={cell.verdict?.result ?? "none"} />
                        {!!cell.verdict?.findings.length && (
                          <div className="ids">
                            {cell.verdict.findings.map((id) => (
                              <Link key={id} to="/runs/$runId/findings/$findingId" params={{ runId: run.id, findingId: id }} search={(s) => s}>{id}</Link>
                            ))}
                          </div>
                        )}
                        {cell.verdict?.note && <p className="note" title={cell.verdict.note}>{cell.verdict.note}</p>}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Since({ run }: { run: StudioRun }) {
  const d = run.since;
  return (
    <Card className="since" title="Since last run">
      {!d ? (
        <p className="text2">No earlier done run of this flow.</p>
      ) : (
        <>
          <p className="text2">
            Compared with <Link to="/runs/$runId" params={{ runId: d.run }} className="mono" style={{ fontSize: 13 }}>{d.run}</Link>: {m.plural(d.compared, "case")} in both runs, {d.changed.length} changed.
          </p>
          {!!d.changed.length && (
            <div className="scroll">
              <table>
                <thead>
                  <tr><th>Scenario</th><th style={{ width: 140 }}>Viewport</th><th style={{ width: 120 }}>Was</th><th style={{ width: 160 }}>Now</th></tr>
                </thead>
                <tbody>
                  {d.changed.map((c, i) => (
                    <tr key={i}>
                      <td className="scenario">{c.scenario}</td>
                      <td className="vp">{c.viewport}</td>
                      <td><VerdictChip kind={c.was as GlyphKind} sm /></td>
                      <td><span className="now"><Arrow color="#566B82" /><VerdictChip kind={c.now as GlyphKind} sm /></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Findings({ index, run, f, set }: { index: StudioIndex; run: StudioRun; f: m.Filters; set: Set }) {
  const all = m.rows(run);
  const visible = m.filterRows(all, run.session, f);
  const c = m.counts(run);
  const dups = m.showDuplicates(f);
  const countBy = (pick: (r: m.Row) => string) => (v: string) => all.filter((r) => pick(r) === v).length;
  const facet = (label: string, key: keyof m.Filters, values: readonly string[], count: (v: string) => number, cls = "", mono = false) => (
    <div className="group">
      <span className="label">{label}</span>
      {values.map((v) => (
        <button key={v} type="button" className="chipbtn" aria-pressed={m.list(f[key]).includes(v)} onClick={() => set({ [key]: m.toggled(f[key], v) })}>
          <span className={`chip sm outline ${cls || "kind"} ${cls ? v : ""}`} style={mono ? { fontFamily: "var(--mono)" } : cls ? {} : { fontFamily: "var(--sans)" }}>
            {cls && <Glyph kind="severity" />}{v} <span className="n">{count(v)}</span>
          </span>
        </button>
      ))}
    </div>
  );
  const where = (fr: m.Parsed) => `${fr.front.route} · ${fr.front.scenario} · ${fr.front.viewport} · ${m.clock(fr.front.created)}`;
  const thumb = (fr: m.Parsed) =>
    fr.front.evidence[0] ? (
      <a href={evidenceUrl(run.id, fr.front.evidence[0])} target="_blank" rel="noreferrer" aria-label={`Open ${fr.front.evidence[0]}`} className="thumb">
        <img src={evidenceUrl(run.id, fr.front.evidence[0])} alt={fr.front.evidence[0]} style={{ width: m.thumbWidth(fr.front.viewport) }} loading="lazy" />
      </a>
    ) : null;
  const idLink = (fr: m.Parsed, children: ReactNode, className?: string) => (
    <Link to="/runs/$runId/findings/$findingId" params={{ runId: run.id, findingId: fr.id }} search={(s) => s} className={className}>{children}</Link>
  );
  const scenarios = run.session?.scenarios.map((s) => s.name) ?? [...new Set(all.map((r) => r.finding.front.scenario))];
  const viewports = [...new Set((run.session?.cases ?? []).map((c) => c.viewport).concat(all.map((r) => r.finding.front.viewport)))];
  return (
    <Card className="ftable" pad={false} title="Findings" sub={`${(f.verdict || f.severity || f.kind || f.status || f.scenario || f.viewport || f.q) ? `${visible.length} of ${all.length} shown · ` : ""}${m.plural(c.findings, "finding")} · ${c.duplicates} duplicates folded · sorted severity → kind → id`}>
      <div className="filters">
        {facet("Severity", "severity", m.SEVERITIES.filter((s) => c[s]), (v) => c[v as (typeof m.SEVERITIES)[number]], "sev")}
        {facet("Kind", "kind", m.KINDS.filter((k) => all.some((r) => r.finding.front.kind === k)), countBy((r) => r.finding.front.kind))}
        <div className="group">
          <span className="label">Status</span>
          {m.STATUSES.map((s) =>
            s === "duplicate" ? (
              <button key={s} type="button" className="chipbtn" aria-pressed={dups} onClick={() => set({ dups: dups ? "0" : undefined })}>
                <span className="chip sm outline duplicate">duplicate <span className="n">{c.duplicates}</span></span>
              </button>
            ) : (
              <button key={s} type="button" className="chipbtn" aria-pressed={m.list(f.status).includes(s)} onClick={() => set({ status: m.toggled(f.status, s) })}>
                <span className={`chip sm outline ${s === "open" ? "open" : s}`}>{s} <span className="n">{countBy((r) => r.finding.front.status)(s)}</span></span>
              </button>
            ),
          )}
        </div>
        {facet("Scenario", "scenario", scenarios, countBy((r) => r.finding.front.scenario))}
        {facet("Viewport", "viewport", viewports, countBy((r) => r.finding.front.viewport), "", true)}
        <div className="tail">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="q" className="label">Search</label>
            <input id="q" type="search" placeholder="title, id, route" value={f.q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} />
          </div>
          <label className="check" htmlFor="dups">
            <input id="dups" type="checkbox" checked={dups} onChange={(e) => set({ dups: e.target.checked ? undefined : "0" })} />Show duplicates
          </label>
        </div>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 112 }}>Evidence</th><th style={{ width: 96 }}>Severity</th><th style={{ width: 72 }}>Kind</th><th style={{ width: 124 }}>Id</th>
              <th>Title</th><th style={{ width: 184 }}>Status</th><th style={{ width: 36 }}><span className="sr">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={7} className="empty">No finding matches the current filters.</td></tr>
            )}
            {visible.flatMap(({ finding, duplicates }) => [
              <tr key={finding.id}>
                <td>{thumb(finding)}</td>
                <td><Severity severity={finding.front.severity} /></td>
                <td><KindChip kind={finding.front.kind} /></td>
                <td className="id">{idLink(finding, finding.id)}</td>
                <td>
                  <div className="ttl">
                    {idLink(finding, finding.title ?? "(no title)", "t")}
                    <span className="where">{where(finding)}</span>
                    {!!duplicates.length && idLink(finding, `+${m.plural(duplicates.length, "duplicate")}`, "more")}
                  </div>
                </td>
                <td><StatusChip front={finding.front} runId={run.id} /></td>
                <td><CopyButton text={filePath(index, run, finding.path)} icon={<CopyIcon />} ariaLabel={`Copy path of ${finding.id}`} /></td>
              </tr>,
              ...(dups ? duplicates : []).map((d) => (
                <tr key={d.id} className="dup">
                  <td><div className="dupmark"><DupMark />{thumb(d)}</div></td>
                  <td><Severity severity={d.front.severity} /></td>
                  <td><KindChip kind={d.front.kind} /></td>
                  <td className="id">{idLink(d, d.id)}</td>
                  <td>
                    <div className="ttl">
                      {idLink(d, d.title ?? "(no title)", "t")}
                      <span className="where">{where(d)}</span>
                    </div>
                  </td>
                  <td><StatusChip front={d.front} runId={run.id} /></td>
                  <td><CopyButton text={filePath(index, run, d.path)} icon={<CopyIcon />} ariaLabel={`Copy path of ${d.id}`} /></td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <p className="foot">Rendered from .jeyna/playtests/{run.id}/ · nothing here is edited by the studio</p>
    </Card>
  );
}
export function RunScreen({ index, run }: { index: StudioIndex; run: StudioRun }) {
  const f = useSearch({ strict: false }) as m.Filters;
  const navigate = useNavigate();
  const set: Set = (patch) => navigate({ to: "/runs/$runId", params: { runId: run.id }, search: (s: m.Filters) => ({ ...s, ...patch }), replace: true } as never);
  return (
    <div className="body">
      <Rail index={index} current={run.id} />
      <main className="run">
        <Head index={index} run={run} />
        <Attention run={run} />
        <Counts run={run} f={f} set={set} />
        {run.session && <Matrix run={run} session={run.session} f={f} />}
        {run.session && <Since run={run} />}
        <Findings index={index} run={run} f={f} set={set} />
      </main>
    </div>
  );
}
