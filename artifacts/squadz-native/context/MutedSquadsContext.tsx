import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { API_BASE } from "@/lib/api";

type MutedSquadsContextValue = {
  mutedSquadIds: Set<string>;
  setSquadMuted: (squadId: string, muted: boolean) => void;
  refreshMutedSquads: () => Promise<void>;
};

const MutedSquadsContext = createContext<MutedSquadsContextValue>({
  mutedSquadIds: new Set(),
  setSquadMuted: () => undefined,
  refreshMutedSquads: async () => undefined,
});

export function MutedSquadsProvider({
  children,
  authToken,
}: {
  children: React.ReactNode;
  authToken: string | null;
}) {
  const [mutedSquadIds, setMutedSquadIds] = useState<Set<string>>(new Set());

  const refreshMutedSquads = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/squads/muted`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { squadIds: string[] };
      setMutedSquadIds(new Set(data.squadIds));
    } catch {
      // Network unavailable — keep current state
    }
  }, [authToken]);

  // Load muted squads whenever auth token becomes available
  useEffect(() => {
    if (authToken) {
      void refreshMutedSquads();
    } else {
      setMutedSquadIds(new Set());
    }
  }, [authToken, refreshMutedSquads]);

  const setSquadMuted = useCallback((squadId: string, muted: boolean) => {
    setMutedSquadIds((prev) => {
      const next = new Set(prev);
      if (muted) {
        next.add(squadId);
      } else {
        next.delete(squadId);
      }
      return next;
    });
  }, []);

  return (
    <MutedSquadsContext.Provider value={{ mutedSquadIds, setSquadMuted, refreshMutedSquads }}>
      {children}
    </MutedSquadsContext.Provider>
  );
}

export function useMutedSquads() {
  return useContext(MutedSquadsContext);
}
