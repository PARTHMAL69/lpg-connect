import { useAuth } from "@/lib/auth-context";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
export function RequireAgencyUser({ children }: { children: ReactNode }) {
  const { loading, user, profile, isPlatformAdmin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!user) { navigate({ to: "/login" }); return; }
    if (isPlatformAdmin && !profile?.agency_id) { navigate({ to: "/platform-admin" }); return; }
    if (!profile?.agency_id) { navigate({ to: "/login" }); return; }
  }, [loading, user, profile, isPlatformAdmin, navigate]);

  if (loading || !user || !profile?.agency_id) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }
  return <>{children}</>;
}

export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { loading, user, isPlatformAdmin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!user) { navigate({ to: "/platform-admin/login" }); return; }
    if (!isPlatformAdmin) { navigate({ to: "/platform-admin/login" }); return; }
  }, [loading, user, isPlatformAdmin, navigate]);

  if (loading || !user || !isPlatformAdmin) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }
  return <>{children}</>;
}
