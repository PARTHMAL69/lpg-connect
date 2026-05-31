import { createFileRoute } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useEffect, useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PageHeader, EmptyState } from "@/components/page-header";
import { 
  listAgencyUsers, 
  createAgencyUser, 
  updateAgencyUser, 
  toggleAgencyUserStatus, 
  resetAgencyUserPassword 
} from "@/lib/auth.functions";
import { toast } from "sonner";
import { 
  Users, 
  UserPlus, 
  Shield, 
  UserCheck, 
  UserX, 
  KeyRound, 
  Edit3, 
  Search, 
  Loader2, 
  ArrowRight,
  ShieldCheck,
  UserCog
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/app/users")({
  component: () => (
    <RequireAgencyUser>
      <Page />
    </RequireAgencyUser>
  ),
});

interface AgencyUser {
  id: string;
  user_id: string;
  username: string;
  full_name: string | null;
  is_active: boolean;
  role: "agency_admin" | "agency_operator";
  created_at: string;
}

function Page() {
  const { roles, user: currentUser } = useAuth();
  
  // Verify permissions (only agency_admin role can access this page)
  const isAuthorized = useMemo(() => {
    return roles.includes("agency_admin") || roles.includes("platform_admin" as any);
  }, [roles]);

  if (!isAuthorized) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto space-y-4">
        <div className="h-16 w-16 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center border border-destructive/20 shadow-sm animate-bounce">
          <Shield className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight">Access Restricted</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          You do not have the required permissions to view this panel. Only Distributorship Administrators are authorized to manage system operator credentials.
        </p>
      </div>
    );
  }

  return <UsersManager />;
}

function UsersManager() {
  const listFn = useServerFn(listAgencyUsers);
  const createFn = useServerFn(createAgencyUser);
  const updateFn = useServerFn(updateAgencyUser);
  const toggleStatusFn = useServerFn(toggleAgencyUserStatus);
  const resetPasswordFn = useServerFn(resetAgencyUserPassword);
  const { user: authUser } = useAuth();

  const [users, setUsers] = useState<AgencyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  
  // Dialog states
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AgencyUser | null>(null);
  const [pwTarget, setPwTarget] = useState<AgencyUser | null>(null);
  
  // Form input states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"agency_admin" | "agency_operator">("agency_operator");
  const [newPassword, setNewPassword] = useState("");
  
  const [busy, setBusy] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await listFn();
      setUsers((res.users ?? []) as AgencyUser[]);
    } catch (err: any) {
      toast.error(err.message || "Failed to load team members.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createFn({
        data: {
          username: username.toLowerCase().trim(),
          password,
          fullName: fullName.trim(),
          role,
        }
      });
      toast.success(`Operator ${fullName} created successfully.`);
      setAddOpen(false);
      setUsername("");
      setPassword("");
      setFullName("");
      setRole("agency_operator");
      void fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Failed to create user operator.");
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setBusy(true);
    try {
      await updateFn({
        data: {
          userId: editTarget.user_id,
          fullName: fullName.trim(),
          role,
        }
      });
      toast.success("User operator updated successfully.");
      setEditTarget(null);
      setFullName("");
      setRole("agency_operator");
      void fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Failed to update user operator.");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleStatus = async (user: AgencyUser, currentActive: boolean) => {
    if (user.user_id === authUser?.id) {
      toast.error("You cannot disable your own active account.");
      return;
    }
    const targetStatus = !currentActive;
    try {
      await toggleStatusFn({
        data: {
          userId: user.user_id,
          isActive: targetStatus,
        }
      });
      toast.success(`Account for ${user.full_name ?? user.username} has been ${targetStatus ? "activated" : "deactivated"}.`);
      void fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Failed to change account status.");
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwTarget) return;
    setBusy(true);
    try {
      await resetPasswordFn({
        data: {
          userId: pwTarget.user_id,
          newPassword,
        }
      });
      toast.success(`Password for ${pwTarget.full_name ?? pwTarget.username} has been reset successfully.`);
      setPwTarget(null);
      setNewPassword("");
    } catch (err: any) {
      toast.error(err.message || "Failed to reset operator password.");
    } finally {
      setBusy(false);
    }
  };

  // Open edit modal with target values pre-loaded
  const openEdit = (u: AgencyUser) => {
    setEditTarget(u);
    setFullName(u.full_name ?? "");
    setRole(u.role);
  };

  // Open password reset modal with target values loaded
  const openPwReset = (u: AgencyUser) => {
    setPwTarget(u);
    setNewPassword("");
  };

  // Filtered lists
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const searchStr = q.toLowerCase();
      return (
        u.username.toLowerCase().includes(searchStr) ||
        (u.full_name && u.full_name.toLowerCase().includes(searchStr))
      );
    });
  }, [users, q]);

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Agency Staff & Users" 
        subtitle="Manage operators, managers, cashiers, and login access"
        actions={
          <Button onClick={() => setAddOpen(true)} className="h-11 shadow-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground">
            <UserPlus className="h-4.5 w-4.5 mr-1.5" /> New Staff Member
          </Button>
        }
      />

      {/* Filter and Search */}
      <Card className="shadow-soft">
        <CardContent className="p-4 relative">
          <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search team members by name or username..." 
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-11 pl-10 text-sm"
          />
        </CardContent>
      </Card>

      {/* Users Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading staff listing...
        </div>
      ) : filteredUsers.length === 0 ? (
        <EmptyState title="No Staff Found" hint="Try adjusting your search filters or add a new team operator." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((u) => {
            const isSelf = u.user_id === authUser?.id;
            return (
              <Card key={u.id} className={`shadow-soft border transition-all hover:border-primary/30 relative overflow-hidden ${!u.is_active ? "opacity-75 bg-muted/40" : ""}`}>
                <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                  {/* Card Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center border shadow-sm ${
                        u.role === "agency_admin" 
                          ? "bg-amber-500/10 text-amber-600 border-amber-500/20" 
                          : "bg-primary/10 text-primary border-primary/20"
                      }`}>
                        {u.role === "agency_admin" ? <ShieldCheck className="h-5 w-5" /> : <UserCog className="h-5 w-5" />}
                      </div>
                      <div>
                        <div className="font-bold flex items-center gap-1.5">
                          {u.full_name || u.username}
                          {isSelf && (
                            <span className="text-[10px] bg-primary/10 text-primary font-bold uppercase px-1.5 py-0.5 rounded-md border border-primary/20">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground font-semibold">@{u.username}</div>
                      </div>
                    </div>
                    
                    {/* Status Toggle */}
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] uppercase tracking-wider font-extrabold ${u.is_active ? "text-emerald-500" : "text-muted-foreground"}`}>
                        {u.is_active ? "Active" : "Disabled"}
                      </span>
                      <Switch 
                        checked={u.is_active} 
                        disabled={isSelf}
                        onCheckedChange={() => handleToggleStatus(u, u.is_active)} 
                        className="scale-90"
                      />
                    </div>
                  </div>

                  {/* Info Meta */}
                  <div className="text-xs space-y-1.5 pt-2 border-t text-muted-foreground">
                    <div className="flex justify-between">
                      <span className="font-semibold">Access Level:</span>
                      <span className="font-bold text-foreground">
                        {u.role === "agency_admin" ? "Administrator" : "Cashier / Operator"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold">Registered:</span>
                      <span className="font-bold text-foreground">
                        {new Date(u.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
                      </span>
                    </div>
                  </div>

                  {/* Actions footer */}
                  <div className="flex justify-end gap-2 pt-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => openPwReset(u)}
                      className="h-9 font-semibold text-xs border-muted-foreground/20"
                    >
                      <KeyRound className="h-3.5 w-3.5 mr-1" /> Reset Pass
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => openEdit(u)}
                      className="h-9 font-semibold text-xs text-primary hover:text-primary"
                    >
                      <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit Profile
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Operator Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Add New Staff Operator
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                required
                placeholder="e.g. Ramesh Patil"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="username">Username (For Login)</Label>
              <Input
                id="username"
                required
                placeholder="e.g. ramesh_patil"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11"
              />
              <p className="text-[10px] text-muted-foreground font-semibold">
                Note: Used only for local agency login. Special characters allowed: . _ -
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Login Password</Label>
              <Input
                id="password"
                type="password"
                required
                placeholder="Minimum 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role">Access Level / Role</Label>
              <Select value={role} onValueChange={(v: any) => setRole(v)}>
                <SelectTrigger className="h-11 font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agency_operator">Cashier (Daily Operations & Sales Entry)</SelectItem>
                  <SelectItem value="agency_admin">Distributorship Admin (Full Dashboard & Staff CRUD)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2 border-t">
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)} className="h-11 font-semibold">
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="h-11 font-bold bg-primary hover:bg-primary/95">
                {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin mr-2" /> : null}
                Create Operator Credentials
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Operator Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5 text-primary" />
              Edit Operator Details — @{editTarget?.username}
            </DialogTitle>
          </DialogHeader>

          {editTarget && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="editFullName">Full Name</Label>
                <Input
                  id="editFullName"
                  required
                  placeholder="e.g. Ramesh Patil"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="editRole">Access Level / Role</Label>
                <Select 
                  value={role} 
                  disabled={editTarget.user_id === authUser?.id}
                  onValueChange={(v: any) => setRole(v)}
                >
                  <SelectTrigger className="h-11 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agency_operator">Cashier (Daily Operations & Sales Entry)</SelectItem>
                    <SelectItem value="agency_admin">Distributorship Admin (Full Dashboard & Staff CRUD)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter className="pt-2 border-t">
                <Button type="button" variant="ghost" onClick={() => setEditTarget(null)} className="h-11 font-semibold">
                  Cancel
                </Button>
                <Button type="submit" disabled={busy} className="h-11 font-bold bg-primary hover:bg-primary/95">
                  {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin mr-2" /> : null}
                  Update Operator Profile
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!pwTarget} onOpenChange={(open) => !open && setPwTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-500" />
              Reset Operator Password — {pwTarget?.full_name || pwTarget?.username}
            </DialogTitle>
          </DialogHeader>

          {pwTarget && (
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="newPassword">New Login Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  required
                  placeholder="Minimum 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-11"
                />
              </div>

              <DialogFooter className="pt-2 border-t">
                <Button type="button" variant="ghost" onClick={() => setPwTarget(null)} className="h-11 font-semibold">
                  Cancel
                </Button>
                <Button type="submit" disabled={busy} className="h-11 font-bold bg-amber-600 hover:bg-amber-500 text-white">
                  {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin mr-2" /> : null}
                  Reset Operator Password
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
