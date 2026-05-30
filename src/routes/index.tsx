import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });

    // Look up role via claims
    const meta = data.session.user.user_metadata as { kind?: string } | undefined;
    if (meta?.kind === "platform_admin") {
      throw redirect({ to: "/platform-admin" });
    }
    throw redirect({ to: "/app" });
  },
  component: () => null,
});
