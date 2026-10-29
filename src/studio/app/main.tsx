// Jeyna studio UI: TanStack Router (the routing half of TanStack Start) over the sidecar's SSE index. Playtests (run,
// finding), Feedback (board, item) and Live, beside one sidebar.
import { createRootRoute, createRoute, createRouter, Navigate, Outlet, RouterProvider, useLocation, useParams } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { FeedbackListScreen, FeedbackScreen, todo } from "./feedback.js";
import { FindingScreen } from "./finding.js";
import { LiveScreen } from "./live.js";
import { RunScreen } from "./run.js";
import { useStudio } from "./store.js";
import { type Section, Sidebar, Vacant } from "./ui.js";
import "../overlay/overlay.css";
import "./studio.css";

// Search params are plain strings (?view=list), not JSON. Params whose control is gone (the old run filters, ?show=)
// are dropped by each route's validateSearch, so old links still load.
const parseSearch = (str: string) => Object.fromEntries(new URLSearchParams(str));
const stringifySearch = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

function Root() {
  const { index, connected } = useStudio();
  const { runId } = useParams({ strict: false }) as { runId?: string };
  const path = useLocation({ select: (l) => l.pathname });
  const section: Section = path.startsWith("/live") ? "live" : path.startsWith("/feedback") ? "feedback" : "playtests";
  return (
    <div className="app">
      <Sidebar index={index} connected={connected} section={section} runId={runId} todo={index ? todo(index.feedback) : 0} />
      <main className="main">
        {index ? <Outlet /> : <p className="meta">{connected ? "Reading .jeyna/…" : "Connecting to the studio sidecar…"}</p>}
      </main>
    </div>
  );
}

function Home() {
  const { index } = useStudio();
  if (!index) return null;
  if (!index.runs.length) {
    return (
      <Vacant title="No runs yet">
        <span>Start one with <span className="mono">/jeyna:playtest</span>; it appears here as it is written.</span>
      </Vacant>
    );
  }
  return <Navigate to="/runs/$runId" params={{ runId: index.runs[0].id }} replace />;
}

function RunPage() {
  const { index } = useStudio();
  const { runId } = runRoute.useParams();
  const run = index?.runs.find((r) => r.id === runId);
  if (!index) return null;
  if (!run) return <Vacant title="No such run">No run {runId} under .jeyna/playtests/.</Vacant>;
  return <RunScreen key={run.id} index={index} run={run} />;
}

function FindingPage() {
  const { index } = useStudio();
  const { runId, findingId } = findingRoute.useParams();
  const run = index?.runs.find((r) => r.id === runId);
  const finding = run?.findings.find((f) => f.id === findingId);
  if (!index) return null;
  if (!run || !finding) return <Vacant title="No such finding">No finding {findingId} in run {runId}.</Vacant>;
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
  if (!item) return <Vacant title="No such feedback">No feedback {feedbackId} under .jeyna/feedback/.</Vacant>;
  return <FeedbackScreen key={item.id} index={index} item={item} />;
}

const rootRoute = createRootRoute({ component: Root, notFoundComponent: () => <Vacant title="Nothing here" /> });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
const runRoute = createRoute({ getParentRoute: () => rootRoute, path: "/runs/$runId", validateSearch: () => ({}), component: RunPage });
const findingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId/findings/$findingId",
  validateSearch: (s: Record<string, unknown>): { view?: "source" } => (s.view === "source" ? { view: "source" } : {}),
  component: FindingPage,
});
const liveRoute = createRoute({ getParentRoute: () => rootRoute, path: "/live", component: LivePage });
const feedbackListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/feedback",
  validateSearch: (s: Record<string, unknown>): { view?: "list" } => (s.view === "list" ? { view: "list" } : {}),
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
