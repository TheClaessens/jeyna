// Jeyna studio UI: TanStack Router (the routing half of TanStack Start) over the sidecar's SSE index. Playtests (run,
// finding), Live and Feedback (list, item).
import { createRootRoute, createRoute, createRouter, Navigate, Outlet, RouterProvider, useLocation, useParams } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { FILTER_KEYS, type Filters } from "../model.js";
import { FEEDBACK_VIEWS, FeedbackListScreen, FeedbackScreen, type FeedbackView, todo } from "./feedback.js";
import { FindingScreen } from "./finding.js";
import { LiveScreen } from "./live.js";
import { Rail, RunScreen } from "./run.js";
import { useStudio } from "./store.js";
import { type Section, TopBar } from "./ui.js";
import "../overlay/overlay.css";
import "./studio.css";

// Filters live in the URL as plain strings (?severity=critical,major&dups=0), not JSON.
const pick = (s: Record<string, unknown>): Filters =>
  Object.fromEntries(FILTER_KEYS.flatMap((k) => (typeof s[k] === "string" && s[k] !== "" ? [[k, s[k]]] : []))) as Filters;
const parseSearch = (str: string) => Object.fromEntries(new URLSearchParams(str));
const stringifySearch = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

function Root() {
  const { index, connected } = useStudio();
  const { runId, findingId, feedbackId } = useParams({ strict: false }) as { runId?: string; findingId?: string; feedbackId?: string };
  const path = useLocation({ select: (l) => l.pathname });
  const section: Section = path.startsWith("/live") ? "live" : path.startsWith("/feedback") ? "feedback" : "playtests";
  const run = runId ? index?.runs.find((r) => r.id === runId) : undefined;
  return (
    <div className="app">
      <TopBar app={run?.session?.app ?? index?.app?.name} section={section} run={run ? (run.session ?? { id: run.id, status: "aborted" } as never) : undefined} findingId={findingId} feedbackId={feedbackId} todo={index ? todo(index.feedback) : 0} generated={index?.generated} connected={connected} />
      {index ? <Outlet /> : <p className="empty-state">{connected ? "Reading .jeyna/playtests/…" : "Connecting to the studio sidecar…"}</p>}
    </div>
  );
}

function Home() {
  const { index } = useStudio();
  if (!index) return null;
  if (!index.runs.length) return <p className="empty-state">No runs yet in .jeyna/playtests/. Start one with /jeyna:playtest; it appears here as it is written.</p>;
  return <Navigate to="/runs/$runId" params={{ runId: index.runs[0].id }} replace />;
}

function RunPage() {
  const { index } = useStudio();
  const { runId } = runRoute.useParams();
  const run = index?.runs.find((r) => r.id === runId);
  if (!index) return null;
  if (!run) {
    return (
      <div className="body">
        <Rail index={index} />
        <main className="run"><p className="empty-state">No run {runId} under .jeyna/playtests/.</p></main>
      </div>
    );
  }
  return <RunScreen index={index} run={run} />;
}

function FindingPage() {
  const { index } = useStudio();
  const { runId, findingId } = findingRoute.useParams();
  const run = index?.runs.find((r) => r.id === runId);
  const finding = run?.findings.find((f) => f.id === findingId);
  if (!index) return null;
  if (!run || !finding) return <p className="empty-state">No finding {findingId} in run {runId}.</p>;
  return <FindingScreen index={index} run={run} finding={finding} />;
}

function LivePage() {
  const { index } = useStudio();
  return index && <LiveScreen index={index} />;
}

function FeedbackListPage() {
  const { index } = useStudio();
  return index && <FeedbackListScreen index={index} />;
}

function FeedbackPage() {
  const { index } = useStudio();
  const { feedbackId } = feedbackRoute.useParams();
  const item = index?.feedback.find((i) => i.id === feedbackId);
  if (!index) return null;
  if (!item) return <p className="empty-state">No feedback {feedbackId} under .jeyna/feedback/.</p>;
  return <FeedbackScreen key={item.id} index={index} item={item} />;
}

const rootRoute = createRootRoute({ component: Root, notFoundComponent: () => <p className="empty-state">Nothing here.</p> });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
const runRoute = createRoute({ getParentRoute: () => rootRoute, path: "/runs/$runId", validateSearch: pick, component: RunPage });
const findingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId/findings/$findingId",
  validateSearch: (s: Record<string, unknown>): Filters & { view?: "source" } => ({ ...pick(s), ...(s.view === "source" && { view: "source" as const }) }),
  component: FindingPage,
});
const liveRoute = createRoute({ getParentRoute: () => rootRoute, path: "/live", component: LivePage });
const feedbackListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/feedback",
  validateSearch: (s: Record<string, unknown>): { show?: FeedbackView } => (FEEDBACK_VIEWS.includes(s.show as FeedbackView) ? { show: s.show as FeedbackView } : {}),
  component: FeedbackListPage,
});
const feedbackRoute = createRoute({ getParentRoute: () => rootRoute, path: "/feedback/$feedbackId", component: FeedbackPage });
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, runRoute, findingRoute, liveRoute, feedbackListRoute, feedbackRoute]), parseSearch, stringifySearch });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
