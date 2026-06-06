import { useState, useEffect } from "react";

export type ApiEvent = {
  id: string;
  emoji: string;
  title: string;
  date: string;
  location: string;
  squadId: string;
  squadName: string;
  hostId: string;
  description: string;
  inviteCode: string;
  cancelled: boolean;
  rsvps: Record<string, string>;
  tasks: unknown[];
  costs: unknown[];
  polls: unknown[];
  messages: unknown[];
  createdAt: string;
};

export function useEvents() {
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = () => {
    setLoading(true);
    fetch("/api/events", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch events");
        return r.json() as Promise<ApiEvent[]>;
      })
      .then((data) => {
        setEvents(data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refetch();
  }, []);

  return { events, loading, error, refetch };
}
