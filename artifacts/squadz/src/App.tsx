import { Suspense, lazy } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { HelmetProvider } from "react-helmet-async";
import Landing from "@/pages/Landing";

const Privacy = lazy(() => import("@/pages/Privacy"));
const Terms = lazy(() => import("@/pages/Terms"));
const Support = lazy(() => import("@/pages/Support"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const OpenInApp = lazy(() => import("@/pages/OpenInApp"));

function Router() {
  return (
    <Suspense fallback={null}>
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
        <Route path="/join/:code">{() => <OpenInApp kind="event" />}</Route>
        <Route path="/add/friend/:code">{() => <OpenInApp kind="friend" />}</Route>
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
