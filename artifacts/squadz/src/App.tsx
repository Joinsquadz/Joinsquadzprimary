import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Landing from "@/pages/Landing";
import Privacy from "@/pages/Privacy";

const queryClient = new QueryClient();

// The web app is an informational marketing site only — the product itself is
// the Squadz mobile app. Every route renders the landing page so old/shared
// links never dead-end, except /privacy which has its own page.
function Router() {
  return (
    <Switch>
      <Route path="/privacy" component={Privacy} />
      <Route path="/" component={Landing} />
      <Route component={Landing} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
