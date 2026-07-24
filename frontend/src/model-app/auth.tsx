import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, isCloudConfigured } from "./supabase";

interface AuthCtx {
  configured: boolean; // are the Supabase env vars present?
  loading: boolean; // still resolving the initial session?
  session: Session | null;
  user: User | null;
  signInWithPassword: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithPassword: (
    email: string,
    password: string
  ) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  signInWithGoogle: () => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const NOT_CONFIGURED = "Cloud sharing is not configured.";

const Ctx = createContext<AuthCtx>({
  configured: false,
  loading: false,
  session: null,
  user: null,
  signInWithPassword: async () => ({ error: NOT_CONFIGURED }),
  signUpWithPassword: async () => ({ error: NOT_CONFIGURED }),
  signInWithGoogle: async () => ({ error: NOT_CONFIGURED }),
  signOut: async () => {},
});

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isCloudConfigured);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    configured: isCloudConfigured,
    loading,
    session,
    user: session?.user ?? null,
    signInWithPassword: async (email, password) => {
      if (!supabase) return { error: NOT_CONFIGURED };
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message };
    },
    signUpWithPassword: async (email, password) => {
      if (!supabase) return { error: NOT_CONFIGURED };
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) return { error: error.message };
      // When email confirmation is enabled, sign-up returns a user but no active
      // session — the user must confirm before they can sign in.
      const needsConfirmation = !data.session;
      return { needsConfirmation };
    },
    signInWithGoogle: async () => {
      if (!supabase) return { error: NOT_CONFIGURED };
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      return { error: error?.message };
    },
    signOut: async () => {
      await supabase?.auth.signOut();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
