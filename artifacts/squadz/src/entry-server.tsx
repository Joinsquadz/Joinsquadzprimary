import { renderToString } from "react-dom/server";
import { HelmetProvider } from "react-helmet-async";
import type { HelmetServerState } from "react-helmet-async";
import Landing from "./pages/Landing";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";
import OpenInApp from "./pages/OpenInApp";

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
  const pathname = new URL(url, "https://joinsquadz.com").pathname;
  const inviteKind =
    pathname === "/squad/join"
      ? "squad"
      : pathname === "/squad/join-public" || /^\/squad\/[^/]+$/.test(pathname)
        ? "publicSquad"
        : /^\/join\/[^/]+$/.test(pathname)
          ? "plan"
          : /^\/(?:api\/)?add\/friend\/[^/]+$/.test(pathname)
            ? "friend"
            : null;
  const Component = ROUTES[pathname] ?? (inviteKind ? () => <OpenInApp kind={inviteKind} url={url} /> : NotFound);

  const html = renderToString(
    <HelmetProvider context={ctx}>
      <Component />
    </HelmetProvider>
  );

  return { html, helmet: ctx.helmet ?? null };
}
