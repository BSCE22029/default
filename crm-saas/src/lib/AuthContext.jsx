import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null); // { user_id, org_id, role, full_name, email }
  const [loading, setLoading] = useState(true);

  // Load (or bootstrap) the member profile for the current user.
  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return; }
    let { data } = await supabase
      .from('app_members')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();

    if (!data) {
      // No member row yet — bootstrap (first user => super_admin, else new org).
      const orgName = localStorage.getItem('pending_org_name') || '';
      const fullName = localStorage.getItem('pending_full_name') || '';
      const { error } = await supabase.rpc('app_bootstrap', {
        p_org_name: orgName,
        p_full_name: fullName,
      });
      if (!error) {
        localStorage.removeItem('pending_org_name');
        localStorage.removeItem('pending_full_name');
        const r = await supabase.from('app_members').select('*').eq('user_id', uid).maybeSingle();
        data = r.data;
      }
    }
    setProfile(data || null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session?.user?.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, sess) => {
      setSession(sess);
      await loadProfile(sess?.user?.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const value = {
    session,
    user: session?.user || null,
    profile,
    role: profile?.role || null,
    orgId: profile?.org_id || null,
    loading,
    refreshProfile: () => loadProfile(session?.user?.id),
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signInWithGoogle: () => supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    }),
    changePassword: (newPassword) => supabase.auth.updateUser({ password: newPassword }),
    async signUp(email, password, orgName, fullName) {
      localStorage.setItem('pending_org_name', orgName || '');
      localStorage.setItem('pending_full_name', fullName || '');
      // Create the account server-side (instant, no confirmation email needed)…
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name: fullName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { data: {}, error: { message: data.error || 'Signup failed' } };
      // …then sign in to obtain a session (bootstrap runs from loadProfile).
      return supabase.auth.signInWithPassword({ email, password });
    },
    signOut: () => supabase.auth.signOut(),
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
