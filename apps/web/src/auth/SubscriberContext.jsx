import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "sportsmvp_subscriber_session";

const SubscriberContext = createContext(null);

function readStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function SubscriberProvider({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const existing = readStoredSession();
    if (existing) setSession(existing);
    setReady(true);
  }, []);

  const login = ({ email }) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const next = {
      email: normalizedEmail,
      plan: "premium",
      status: "active",
      startedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  };

  const value = useMemo(
    () => ({
      ready,
      session,
      isAuthenticated: !!session,
      isActiveSubscriber: session?.status === "active",
      login,
      logout,
    }),
    [ready, session]
  );

  return <SubscriberContext.Provider value={value}>{children}</SubscriberContext.Provider>;
}

export function useSubscriber() {
  const ctx = useContext(SubscriberContext);
  if (!ctx) throw new Error("useSubscriber must be used inside SubscriberProvider");
  return ctx;
}
