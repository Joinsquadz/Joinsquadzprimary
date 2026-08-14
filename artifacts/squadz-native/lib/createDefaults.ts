/**
 * Whether the create form may infer a squad when none was supplied by the
 * route. An empty prefillSquad is intentional: it means the caller explicitly
 * requested a standalone plan.
 */
export function shouldAutoSelectDefaultSquad({
  prefillSquad,
  from,
  squadCount,
}: {
  prefillSquad?: string;
  from?: string;
  squadCount: number;
}): boolean {
  if (squadCount === 0) return false;
  if (from === "home") return false;
  return prefillSquad === undefined;
}