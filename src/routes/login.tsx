import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { loginAgency } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Flame, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const fn = useServerFn(loginAgency);
  const [agencyCode, setAgencyCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/app" });
    });
  }, [nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fn({ data: { agencyCode, username, password } });
      await supabase.auth.setSession({ access_token: res.access_token, refresh_token: res.refresh_token });
      toast.success("Signed in");
      nav({ to: "/app" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.invalidCredentials"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-accent/30 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-11 h-11 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-sm">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <div className="font-bold text-lg leading-tight">{t("app.name")}</div>
            <div className="text-xs text-muted-foreground">{t("app.tagline")}</div>
          </div>
        </div>
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">{t("auth.agencyLogin")}</CardTitle>
            <CardDescription>Sign in to your gas agency account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="code">{t("auth.agencyCode")}</Label>
                <Input id="code" autoCapitalize="characters" value={agencyCode} onChange={(e) => setAgencyCode(e.target.value)} required className="h-12 text-base" />
              </div>
              <div>
                <Label htmlFor="username">{t("auth.username")}</Label>
                <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required className="h-12 text-base" />
              </div>
              <div>
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12 text-base" />
              </div>
              <Button type="submit" disabled={loading} className="w-full h-12 text-base font-semibold">
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {t("auth.signIn")}
              </Button>
            </form>
            <div className="mt-6 pt-4 border-t text-center text-sm text-muted-foreground">
              {t("auth.needPlatformAccess")}{" "}
              <Link to="/platform-admin/login" className="text-primary font-medium hover:underline">
                {t("auth.platformLogin")}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
