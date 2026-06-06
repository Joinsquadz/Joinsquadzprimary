import { useState, useEffect } from "react";

export type CurrentUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
};

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/user", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { user: CurrentUser | null }) => {
        setUser(d.user ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.firstName ?? user?.email ?? null;

  const firstName = user?.firstName ?? null;

  return { user, loading, displayName, firstName };
}
