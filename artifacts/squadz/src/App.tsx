import { Suspense, lazy } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { HelmetProvider } from "react-helmet-async";
import Landing from "@/pages/Landing";

const Privacy = lazy(() => import("@/pages/Privacy"));
const Terms = lazy(() => import("@/pages/Terms"));
const Support = lazy(() => import("@/pages/Support"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const OpenInApp = lazy(() => import("@/pages/OpenInApp"));

function RouteLoadingFallback() {
  return (
    <div
      role="status"
      aria-label="Loading SquadZ"
      style={{
        boxSizing: "border-box",
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background:
          "radial-gradient(circle at 50% 35%, rgba(255, 92, 58, 0.16), transparent 34%), #0a0a0f",
        color: "#f0eff8",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          aria-hidden="true"
          style={{
            width: 52,
            height: 52,
            display: "grid",
            placeItems: "center",
            margin: "0 auto 14px",
            borderRadius: 15,
            background: "linear-gradient(135deg, #ff5c3a, #ffb547)",
            color: "#0a0a0f",
            fontFamily: "Georgia, serif",
            fontSize: 36,
            fontWeight: 700,
          }}
        >
          Z
        </div>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 25, fontWeight: 700 }}>
          SquadZ
        </div>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/support" component={Support} />
        {/* App deep-link web fallbacks — the app shares joinsquadz.com/...
            links; anyone without the app installed lands here, never a 404. */}
        <Route path="/squad/join">{() => <OpenInApp kind="squad" />}</Route>
        <Route path="/squad/join-public">{() => <OpenInApp kind="publicSquad" />}</Route>
        <Route path="/squad/:id">{() => <OpenInApp kind="publicSquad" />}</Route>
        <Route path="/join/:code">{() => <OpenInApp kind="plan" />}</Route>
        <Route path="/add/friend/:code">{() => <OpenInApp kind="friend" />}</Route>
        <Route path="/api/add/friend/:code">{() => <OpenInApp kind="friend" />}</Route>
        <Route path="/availability">{() => <OpenInApp kind="poll" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <HelmetProvider>
      <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
        <Router />
      </WouterRouter>
    </HelmetProvider>
  );
}

export default App;
