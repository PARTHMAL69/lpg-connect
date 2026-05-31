import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "platform_admin" | "agency_admin" | "agency_operator" | "manager" | "cashier";

interface Profile {
  id: string;
  agency_id: string | null;
  username: string | null;
  full_name: string | null;
}
interface Agency {
  id: string;
  name: string;
  code: string;
  language: string;
  status: string;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  agency: Agency | null;
  roles: AppRole[];
  loading: boolean;
  isPlatformAdmin: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [agency, setAgency] = useState<Agency | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUserData = async (uid: string) => {
    const [{ data: prof }, { data: roleRows }] = await Promise.all([
      (supabase.from("agency_users") as any).select("*").eq("user_id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setProfile(prof as Profile | null);
    setRoles((roleRows ?? []).map((r: { role: AppRole }) => r.role));
    if (prof?.agency_id) {
      const { data: ag } = await supabase.from("agencies").select("*").eq("id", prof.agency_id).maybeSingle();
      setAgency(ag as Agency | null);
    } else {
      setAgency(null);
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => { void loadUserData(s.user.id); }, 0);
      } else {
        setProfile(null); setAgency(null); setRoles([]);
      }
    });
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) await loadUserData(s.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    session, user: session?.user ?? null, profile, agency, roles, loading,
    isPlatformAdmin: roles.includes("platform_admin"),
    signOut: async () => { await supabase.auth.signOut(); },
    refresh: async () => { if (session?.user) await loadUserData(session.user.id); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
};
