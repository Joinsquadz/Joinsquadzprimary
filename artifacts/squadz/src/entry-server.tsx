import { renderToString } from "react-dom/server";
import { HelmetProvider } from "react-helmet-async";
import type { HelmetServerState } from "react-helmet-async";
import Landing from "./pages/Landing";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";

export interface RenderResult {
  html: string;
  helmet: HelmetServerState | null;
}

const ROUTES: Record<string, React.ComponentType> = {
  "/": Landing,
  "/privacy": Privacy,
  "/terms": Terms,
};

export function render(url: string): RenderResult {
  const ctx: { helmet?: HelmetServerState } = {};
  const Component = ROUTES[url] ?? NotFound;

  const html = renderToString(
    <HelmetProvider context={ctx}>
      <Component />
    </HelmetProvider>
  );

  return { html, helmet: ctx.helmet ?? null };
}
