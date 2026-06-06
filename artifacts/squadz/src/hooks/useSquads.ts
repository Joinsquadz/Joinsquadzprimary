import { useState, useEffect } from "react";

export type ApiSquad = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  memberIds: string[];
  createdAt: string;
};

export function useSquads() {
  const [squads, setSquads] = useState<ApiSquad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = () => {
    setLoading(true);
    fetch("/api/squads", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch squads");
        return r.json() as Promise<ApiSquad[]>;
      })
      .then((data) => {
        setSquads(data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refetch();
  }, []);

  return { squads, loading, error, refetch };
}
