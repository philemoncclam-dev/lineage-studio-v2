// Supabase client. Cloud features (accounts, sharing) activate only when the
// two env vars are present; otherwise the app falls back to localStorage and
// behaves exactly as the original static site.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isCloudConfigured = Boolean(url && anon);

export const supabase: SupabaseClient | null = isCloudConfigured
  ? createClient(url as string, anon as string)
  : null;

// Synchronous "is the user signed in" flag, kept current by the auth listener so
// the api dispatcher (api.ts) can choose cloud vs local without awaiting.
let _signedIn = false;
export const isSignedIn = () => _signedIn;

if (supabase) {
  supabase.auth.getSession().then(({ data }) => {
    _signedIn = !!data.session;
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    _signedIn = !!session;
  });
}
