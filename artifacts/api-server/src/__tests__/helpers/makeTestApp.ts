import express, {
  type Request,
  type Response,
  type NextFunction,
  type Router,
} from "express";

export type TestUser = { id: string; email?: string };

// Shared helper that builds an express app the safe way for API access-control
// tests: JSON body parsing + a fake `isAuthenticated`/`req.user` middleware,
// then mounts the given router under `/api`. Centralizing this prevents the
// per-file `makeApp`/`TestUser` boilerplate (and the drift that let cold-import
// flakiness spread). The router is passed in and imported statically at the call
// site below its `vi.mock(...)` calls, keeping the heavy dependency-graph
// transform out of the timed test window (see
// .agents/memory/api-server-test-cold-import.md).
export function makeTestApp(router: Router, user?: TestUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.isAuthenticated = function (this: Request) {
      return user != null;
    } as Request["isAuthenticated"];
    if (user) req.user = user as Express.User;
    next();
  });
  app.use("/api", router);
  return app;
}
