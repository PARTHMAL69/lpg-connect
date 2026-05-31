import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMe, listAgencies, createAgency, setAgencyStatus, resetAgencyAdminPassword } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Building2, LogOut, Plus, Loader2, KeyRound, Power, PowerOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/platform-admin")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/platform-admin/login" });
    if (data.session.user.user_metadata?.kind !== "platform_admin") {
      throw redirect({ to: "/platform-admin/login" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  const meFn = useServerFn(getMe);
  useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const nav = useNavigate();
  async function signOut() {
    await supabase.auth.signOut();
    nav({ to: "/platform-admin/login" });
  }
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="h-16 bg-background border-b sticky top-0 z-30">
        <div className="max-w-7xl mx-auto h-full px-4 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-foreground text-background grid place-items-center"><Shield className="w-5 h-5" /></div>
            <div className="font-bold">Platform Admin</div>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="w-4 h-4 mr-2" />Sign Out</Button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}



export function AgenciesPage() {
  const listFn = useServerFn(listAgencies);
  const setStatusFn = useServerFn(setAgencyStatus);
  const resetPwFn = useServerFn(resetAgencyAdminPassword);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["agencies"], queryFn: () => listFn() });

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: "active" | "disabled" }) => setStatusFn({ data: { agencyId: v.id, status: v.status } }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["agencies"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null);
  const [resetPw, setResetPw] = useState("");

  const resetMut = useMutation({
    mutationFn: () => resetPwFn({ data: { agencyId: resetTarget!.id, newPassword: resetPw } }),
    onSuccess: () => { toast.success("Password reset"); setResetTarget(null); setResetPw(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  const agencies = data?.agencies ?? [];
  const total = agencies.length;
  const active = agencies.filter((a) => a.status === "active").length;
  const disabled = total - active;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agencies</h1>
          <p className="text-sm text-muted-foreground">Manage gas agencies on the platform</p>
        </div>
        <CreateAgencyDialog />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total Agencies" value={total} icon={Building2} />
        <StatCard label="Active" value={active} tone="success" />
        <StatCard label="Disabled" value={disabled} tone="muted" />
      </div>

      <Card>
        <CardHeader><CardTitle>All Agencies</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : agencies.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No agencies yet. Create your first one above.</div>
          ) : (
            <div className="space-y-2">
              {agencies.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-4 rounded-lg border bg-card hover:shadow-sm transition-shadow">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{a.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                      <code className="px-1.5 py-0.5 rounded bg-muted">{a.code}</code>
                      {a.phone && <span>{a.phone}</span>}
                      <span>Created {formatDate(a.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={a.status === "active" ? "default" : "secondary"}>
                      {a.status}
                    </Badge>
                    <Button size="sm" variant="outline" onClick={() => setResetTarget({ id: a.id, name: a.name })}>
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: a.id, status: a.status === "active" ? "disabled" : "active" })}>
                      {a.status === "active" ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password — {resetTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>New password (min 8 characters)</Label>
            <Input type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} minLength={8} className="h-11" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button onClick={() => resetMut.mutate()} disabled={resetPw.length < 8 || resetMut.isPending}>
              {resetMut.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon?: typeof Building2; tone?: "success" | "muted" }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={"text-3xl font-bold mt-1 tabular-nums " + (tone === "success" ? "text-success" : tone === "muted" ? "text-muted-foreground" : "")}>{value}</div>
      </CardContent>
    </Card>
  );
}

function CreateAgencyDialog() {
  const fn = useServerFn(createAgency);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", phone: "", address: "", defaultLanguage: "en" as "en" | "hi" | "mr", adminUsername: "", adminPassword: "" });
  const m = useMutation({
    mutationFn: () => fn({ data: form }),
    onSuccess: () => { toast.success("Agency created"); setOpen(false); qc.invalidateQueries({ queryKey: ["agencies"] }); setForm({ name: "", code: "", phone: "", address: "", defaultLanguage: "en", adminUsername: "", adminPassword: "" }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-11"><Plus className="w-4 h-4 mr-2" />New Agency</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Agency</DialogTitle>
          <CardDescription>This creates the agency, the admin user, and seeds 13 default products.</CardDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Agency Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="h-11" /></div>
            <div><Label>Agency Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required minLength={2} className="h-11" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-11" /></div>
            <div>
              <Label>Default Language</Label>
              <Select value={form.defaultLanguage} onValueChange={(v: "en" | "hi" | "mr") => setForm({ ...form, defaultLanguage: v })}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="hi">हिन्दी (Hindi)</SelectItem>
                  <SelectItem value="mr">मराठी (Marathi)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="h-11" /></div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t">
            <div><Label>Admin Username</Label><Input value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} required minLength={3} className="h-11" /></div>
            <div><Label>Admin Password</Label><Input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} required minLength={8} className="h-11" /></div>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={m.isPending}>
              {m.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Create Agency
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
