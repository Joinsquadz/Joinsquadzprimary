/**
 * Pure helpers for the squad-detail live-refresh feature.
 *
 * Extracting these from the React component makes them unit-testable without
 * mounting a component tree or touching any native modules.
 */

export type SquadSnapshot = {
  name?: string | null;
  emoji?: string | null;
  description?: string | null;
  color?: string | null;
  isPublic?: boolean | null;
  membersCanInvite?: boolean | null;
  memberIds?: string[] | null;
};

/**
 * Returns a deterministic string key for the editable fields of a squad.
 * Two responses with identical values produce the same signature; any change
 * to name, emoji, description, color, privacy settings, or member list will
 * produce a different one.
 */
export function squadSignature(s: SquadSnapshot): string {
  return JSON.stringify([
    s.name ?? "",
    s.emoji ?? "",
    s.description ?? "",
    s.color ?? "",
    Boolean(s.isPublic),
    Boolean(s.membersCanInvite),
    [...(s.memberIds ?? [])].sort(),
  ]);
}

export type RunSquadPollOptions = {
  id: string;
  apiBase: string;
  getHeaders: () => Record<string, string>;
  /** Returns the last stored signature, or null on first call. */
  getLastSig: () => string | null;
  /** Persists the new signature for the next comparison. */
  setLastSig: (sig: string) => void;
  /** Returns false once the component has been unmounted / focus lost. */
  isActive: () => boolean;
  refreshSquads: () => Promise<void>;
  /** Called after refreshSquads when a remote change is detected. */
  onChanged: () => void;
};

/**
 * Performs a single poll cycle:
 * 1. Fetches the squad from the server.
 * 2. On the very first call, stores the baseline signature and returns.
 * 3. On subsequent calls, compares signatures:
 *    - Changed  → refreshSquads() + onChanged()
 *    - Unchanged → no-op
 * Swallows network errors so the interval keeps running without crashing.
 */
export async function runSquadPoll(opts: RunSquadPollOptions): Promise<void> {
  try {
    const res = await fetch(`${opts.apiBase}/api/squads/${opts.id}`, {
      headers: opts.getHeaders(),
    });
    if (!opts.isActive() || !res.ok) return;
    const data = (await res.json()) as SquadSnapshot;
    const nextSig = squadSignature(data);
    const lastSig = opts.getLastSig();
    if (lastSig === null) {
      opts.setLastSig(nextSig);
      return;
    }
    if (nextSig !== lastSig) {
      opts.setLastSig(nextSig);
      await opts.refreshSquads();
      if (opts.isActive()) opts.onChanged();
    }
  } catch {
    // Network unavailable — keep current view, try again next tick
  }
}
