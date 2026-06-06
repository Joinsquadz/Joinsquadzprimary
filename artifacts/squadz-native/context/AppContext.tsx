import React, { createContext, useContext, useState } from "react";
import { ME } from "@/data/mock";

export type InviteCtx = {
  code: string;
  title: string;
  emoji: string;
  host: string;
  eventId: string;
};

type AppContextType = {
  isLoggedIn: boolean;
  currentUser: typeof ME;
  inviteCtx: InviteCtx | null;
  login: () => void;
  logout: () => void;
  setInviteCtx: (ctx: InviteCtx | null) => void;
};

const AppContext = createContext<AppContextType>({
  isLoggedIn: false,
  currentUser: ME,
  inviteCtx: null,
  login: () => {},
  logout: () => {},
  setInviteCtx: () => {},
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [inviteCtx, setInviteCtx] = useState<InviteCtx | null>(null);

  const login = () => setIsLoggedIn(true);
  const logout = () => setIsLoggedIn(false);

  return (
    <AppContext.Provider
      value={{ isLoggedIn, currentUser: ME, inviteCtx, login, logout, setInviteCtx }}
    >
      {children}
    </AppContext.Provider>
  );
}

export const useAuth = () => useContext(AppContext);
