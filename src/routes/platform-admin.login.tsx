import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { loginPlatformAdmin, bootstrapPlatformAdmin, platformAdminExists } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/platform-admin/login")({ component: Page });

function Page() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const existsFn = useServerFn(platformAdminExists);
  const { data: existsData, isLoading: checking } = useQuery({
    queryKey: ["platform-admin-exists"],
    queryFn: () => existsFn(),
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user.user_metadata?.kind === "platform_admin") nav({ to: "/platform-admin" });
    });
  }, [nav]);

  if (checking) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return existsData?.exists ? <LoginForm /> : <BootstrapForm />;
}

function LoginForm() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const fn = useServerFn(loginPlatformAdmin);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fn({ data: { username, password } });
      await supabase.auth.setSession({ access_token: res.access_token, refresh_token: res.refresh_token });
      toast.success("Signed in");
      nav({ to: "/platform-admin" });
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
          <div className="w-11 h-11 rounded-xl bg-foreground text-background grid place-items-center"><Shield className="w-6 h-6" /></div>
          <div className="font-bold text-lg">{t("auth.platformLogin")}</div>
        </div>
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>{t("auth.platformLogin")}</CardTitle>
            <CardDescription>Restricted access — software owner only</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="username">{t("auth.username")}</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required className="h-12" />
              </div>
              <div>
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12" />
              </div>
              <Button type="submit" disabled={loading} className="w-full h-12">
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {t("auth.signIn")}
              </Button>
            </form>
            <div className="mt-6 pt-4 border-t text-center text-sm text-muted-foreground">
              <Link to="/login" className="text-primary hover:underline">← {t("auth.agencyLogin")}</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BootstrapForm() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const fn = useServerFn(bootstrapPlatformAdmin);
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fn({ data: { username, password, fullName } });
      await supabase.auth.setSession({ access_token: res.access_token, refresh_token: res.refresh_token });
      toast.success("Platform admin created");
      nav({ to: "/platform-admin" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-gradient-to-br from-background to-accent/30">
      <div className="w-full max-w-md">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>{t("auth.bootstrap")}</CardTitle>
            <CardDescription>{t("auth.bootstrapDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="fullname">{t("auth.fullName")}</Label>
                <Input id="fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} required className="h-12" />
              </div>
              <div>
                <Label htmlFor="username">{t("auth.username")}</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} className="h-12" />
              </div>
              <div>
                <Label htmlFor="password">{t("auth.password")} (min 8)</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="h-12" />
              </div>
              <Button type="submit" disabled={loading} className="w-full h-12">
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {t("auth.bootstrap")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
