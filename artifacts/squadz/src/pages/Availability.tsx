import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Btn } from "@/components/shared";
import { T, font } from "@/lib/data";

const DAY_FULL: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

type PollPayload = {
  poll: { id: string; title: string; days: string[]; slots: string[] };
  heatmap: { cell: string; count: number }[];
  respondentCount: number;
  myCells: string[];
  best: { cell: string; count: number; total: number } | null;
};

function prettyCell(cell: string | null): string {
  if (!cell) return "";
  const [day, slot] = cell.split("-");
  return `${DAY_FULL[day] ?? day} ${slot}`;
}

export default function Availability() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const eventId = params.get("eventId") || undefined;
  const squadIdParam = params.get("squadId") || undefined;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PollPayload | null>(null);
  const [mySet, setMySet] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPoll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let body: Record<string, string> | null = null;
      if (eventId) body = { eventId };
      else if (squadIdParam) body = { squadId: squadIdParam };
      else {
        // No explicit scope — fall back to the user's first squad.
        const sres = await fetch("/api/squads", { credentials: "include" });
        const squads = sres.ok ? ((await sres.json()) as { id: string }[]) : [];
        if (squads.length === 0) {
          setError("Create a squad first to poll availability.");
          return;
        }
        body = { squadId: squads[0].id };
      }
      const res = await fetch("/api/availability/polls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? "Could not load availability.");
        return;
      }
      const payload = (await res.json()) as PollPayload;
      setData(payload);
      setMySet(new Set(payload.myCells));
      setDirty(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [eventId, squadIdParam]);

  useEffect(() => {
    void loadPoll();
  }, [loadPoll]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    data?.heatmap.forEach((c) => m.set(c.cell, c.count));
    return m;
  }, [data]);

  const total = data?.respondentCount ?? 0;

  const toggleCell = (cell: string) => {
    setMySet((prev) => {
      const next = new Set(prev);
      if (next.has(cell)) next.delete(cell);
      else next.add(cell);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/availability/polls/${data.poll.id}/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cells: [...mySet] }),
      });
      if (!res.ok) return;
      const payload = (await res.json()) as PollPayload;
      setData(payload);
      setMySet(new Set(payload.myCells));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const useThisTime = async () => {
    if (!data?.best) return;
    const friendly = prettyCell(data.best.cell);
    if (eventId) {
      try {
        const res = await fetch(`/api/events/${eventId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ date: friendly }),
        });
        if (res.ok) {
          setLocation(`/event?id=${eventId}`);
          return;
        }
      } catch {
        // fall through
      }
      return;
    }
    setLocation("/create-event");
  };

  const cellBg = (cell: string) => {
    const c = counts.get(cell) ?? 0;
    if (total > 0 && c > 0) {
      const intensity = c / total;
      const alpha = intensity >= 1 ? "FF" : intensity >= 0.66 ? "AA" : intensity >= 0.33 ? "66" : "33";
      return T.accent + alpha;
    }
    return T.surfaceUp;
  };

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px 12px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ flex: 1, fontFamily: "'Georgia', serif", fontSize: 18, fontWeight: 700, color: T.white }}>Find the Best Time</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {loading ? (
            <div style={{ color: T.textSub, fontFamily: font, textAlign: "center", paddingTop: 60 }}>Loading…</div>
          ) : error ? (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🗓️</div>
              <div style={{ color: T.textSub, fontFamily: font, marginBottom: 16 }}>{error}</div>
              <div style={{ maxWidth: 200, margin: "0 auto" }}>
                <Btn variant="ghost" onPress={() => void loadPoll()}>Try again</Btn>
              </div>
            </div>
          ) : data ? (
            <>
              <div style={{ fontSize: 14, color: T.textSub, fontFamily: font, lineHeight: 1.5, marginBottom: 16 }}>
                Tap the times you're free. We'll highlight when the most people can make it.
              </div>

              {data.best && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, background: `${T.accent}18`, border: `1px solid ${T.accent}44`, borderRadius: 16, padding: 14, marginBottom: 18 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 11, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✨</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: T.accent, fontFamily: font }}>Best time</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: T.text, fontFamily: font }}>{prettyCell(data.best.cell)}</div>
                    <div style={{ fontSize: 12, color: T.textSub, fontFamily: font }}>{data.best.count} of {data.best.total} free</div>
                  </div>
                </div>
              )}

              {/* Grid */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", marginBottom: 6 }}>
                  <div style={{ width: 38, flexShrink: 0 }} />
                  {data.poll.days.map((d) => (
                    <div key={d} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: 700, color: T.textSub, fontFamily: font }}>{d}</div>
                  ))}
                </div>
                {data.poll.slots.map((slot) => (
                  <div key={slot} style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ width: 38, flexShrink: 0, fontSize: 11, fontWeight: 600, color: T.textSub, fontFamily: font }}>{slot}</div>
                    {data.poll.days.map((day) => {
                      const cell = `${day}-${slot}`;
                      const c = counts.get(cell) ?? 0;
                      const mine = mySet.has(cell);
                      return (
                        <div
                          key={cell}
                          onClick={() => toggleCell(cell)}
                          style={{
                            flex: 1, height: 36, margin: "0 2px", borderRadius: 8,
                            background: cellBg(cell),
                            border: `${mine ? 2 : 1}px solid ${mine ? T.text : T.border}`,
                            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 12, fontWeight: 800, fontFamily: font,
                            color: total > 0 && c / total >= 0.66 ? "#fff" : T.text,
                          }}
                        >
                          {c > 0 ? c : ""}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                {[["None", T.surfaceUp], ["Some", T.accent + "66"], ["Everyone", T.accent]].map(([label, bg]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 8 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 5, background: bg, border: `1px solid ${T.border}` }} />
                    <span style={{ fontSize: 12, color: T.textDim, fontFamily: font }}>{label}</span>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 13, fontWeight: 600, color: T.textSub, fontFamily: font }}>
                {total === 0 ? "Be the first to add your times." : `${total} ${total === 1 ? "person has" : "people have"} responded`}
              </div>
            </>
          ) : null}
        </div>

        {data && !loading && !error && (
          <div style={{ padding: "12px 20px 32px", flexShrink: 0, borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
            {data.best && !dirty && (
              <Btn variant="ghost" onPress={() => void useThisTime()}>
                {eventId ? `Use ${prettyCell(data.best.cell)}` : "Create event at best time"}
              </Btn>
            )}
            <Btn
              onPress={() => void save()}
              style={{ opacity: dirty && !saving ? 1 : 0.6, cursor: dirty && !saving ? "pointer" : "default" }}
            >
              {saving ? "Saving…" : dirty ? "Save my availability" : "Saved"}
            </Btn>
          </div>
        )}
      </div>
    </PhoneShell>
  );
}
