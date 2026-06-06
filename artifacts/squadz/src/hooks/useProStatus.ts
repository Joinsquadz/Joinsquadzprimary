import { useState, useEffect } from "react";

export function useProStatus() {
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/subscription")
      .then(r => (r.ok ? r.json() : { isPro: false }))
      .then((data: { isPro?: boolean }) => setIsPro(data.isPro ?? false))
      .catch(() => setIsPro(false))
      .finally(() => setLoading(false));
  }, []);

  return { isPro, loading };
}
