import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Splash from "@/pages/Splash";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Onboarding from "@/pages/Onboarding";
import EventDetail from "@/pages/EventDetail";
import CreateEvent from "@/pages/CreateEvent";
import SquadDetail from "@/pages/SquadDetail";
import DMChat from "@/pages/DMChat";
import EventThread from "@/pages/EventThread";
import EditProfile from "@/pages/EditProfile";
import CreateSquad from "@/pages/CreateSquad";
import InvitePage from "@/pages/InvitePage";
import Availability from "@/pages/Availability";
import { useEffect } from "react";

const queryClient = new QueryClient();

const PROTECTED_PATHS = ["/home", "/event", "/create-event", "/squad", "/dm-chat", "/event-thread", "/edit-profile", "/create-squad", "/availability"];

function AuthGuard() {
  const [location] = useLocation();
  useEffect(() => {
    const isProtected = PROTECTED_PATHS.some(p => location === p || location.startsWith(p + "/"));
    if (!isProtected) return;
    fetch("/api/auth/user", { credentials: "include" })
      .then(r => r.json())
      .then((d: { user: unknown }) => {
        if (!d.user) {
          window.location.href = `/api/login?returnTo=${encodeURIComponent(location)}`;
        }
      })
      .catch(() => {});
  }, [location]);
  return null;
}

function Router() {
  return (
    <>
      <AuthGuard />
      <Switch>
        <Route path="/" component={Splash} />
        <Route path="/home" component={Home} />
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/event" component={EventDetail} />
        <Route path="/create-event" component={CreateEvent} />
        <Route path="/squad" component={SquadDetail} />
        <Route path="/dm-chat" component={DMChat} />
        <Route path="/event-thread" component={EventThread} />
        <Route path="/edit-profile" component={EditProfile} />
        <Route path="/create-squad" component={CreateSquad} />
        <Route path="/availability" component={Availability} />
        <Route path="/invite" component={InvitePage} />
        <Route component={NotFound} />
      </Switch>
    </>
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
