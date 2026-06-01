import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Plus, Download, FileText, Search, Archive, RotateCcw, Edit, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fmtCurrency } from "@/lib/format";
import { exportToExcel, exportToPDF } from "@/lib/exports";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/app/customers")({ component: () => <RequireAgencyUser><Page/></RequireAgencyUser> });

interface C { 
  id: string; 
  name: string; 
  mobile: string | null; 
  village: string | null; 
  consumer_number: string | null; 
  outstanding: number;
  is_deleted: boolean;
  hasMismatch?: boolean;
  liveOutstanding?: number;
  dbOutstanding?: number;
}

function Page() {
  const { t } = useTranslation();
  const { agency, session } = useAuth();
  const [rows, setRows] = useState<C[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editCustomer, setEditCustomer] = useState<C | null>(null);
  const [hasAnyMismatch, setHasAnyMismatch] = useState(false);

  const load = async () => {
    if (!agency) return;
    let query = (supabase.from("customers") as any).select("*").eq("agency_id", agency.id);
    
    if (!showArchived) {
      query = query.eq("is_deleted", false);
    }
    
    const [cRes, lRes] = await Promise.all([
      query.order("name"),
      (supabase.from("customer_ledger") as any).select("customer_id, debit, credit").eq("agency_id", agency.id)
    ]);

    const ledgerMap: Record<string, number> = {};
    (lRes.data ?? []).forEach((r: any) => {
      ledgerMap[r.customer_id] = (ledgerMap[r.customer_id] ?? 0) + Number(r.debit || 0) - Number(r.credit || 0);
    });

    let mismatchFound = false;
    const mapped = ((cRes.data ?? []) as any[]).map((c) => {
      const live = ledgerMap[c.id] ?? 0;
      const cached = Number(c.outstanding_balance || 0);
      const isMismatch = Math.abs(live - cached) > 0.01;
      if (isMismatch) mismatchFound = true;
      return {
        id: c.id,
        name: c.name,
        mobile: c.mobile,
        village: c.village,
        consumer_number: c.consumer_number,
        outstanding: live, // Chronological ledger balance is the ONLY source of truth
        is_deleted: c.is_deleted,
        hasMismatch: isMismatch,
        liveOutstanding: live,
        dbOutstanding: cached
      };
    });

    setHasAnyMismatch(mismatchFound);
    setRows(mapped);
  };

  useEffect(() => { void load(); }, [agency, showArchived]);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (!s) return rows;
    return rows.filter((c) =>
      c.name.toLowerCase().includes(s) || 
      (c.mobile ?? "").includes(s) || 
      (c.village ?? "").toLowerCase().includes(s) ||
      (c.consumer_number ?? "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  const doExport = (kind: "pdf" | "xlsx") => {
    if (kind === "pdf") {
      const cols = ["Name", "Mobile", "Village", "Consumer No", "Outstanding"];
      const data = filtered.map((c) => [
        c.name, 
        c.mobile ?? "", 
        c.village ?? "", 
        c.consumer_number ?? "", 
        fmtCurrency(c.outstanding)
      ]);
      exportToPDF("Customer Directory", cols, data, "customers");
    } else {
      const data = filtered.map((c) => ({
        "Customer Name": c.name,
        "Mobile Number": c.mobile ?? "",
        "Village/Area": c.village ?? "",
        "Consumer Number": c.consumer_number ?? "",
        "Outstanding Balance (INR)": Number(c.outstanding),
        "Is Archived": c.is_deleted ? "Yes" : "No"
      }));
      exportToExcel(data, "customers", "Customers");
    }
  };

  const archiveCustomer = async (id: string, e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Are you sure you want to archive this customer profile? Outstanding balance remains pending.")) return;
    
    const { error } = await (supabase.from("customers") as any).update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: session?.user?.id
    }).eq("id", id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Customer profile archived.");
      void load();
    }
  };

  const restoreCustomer = async (id: string, e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const { error } = await (supabase.from("customers") as any).update({
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
      updated_by: session?.user?.id
    }).eq("id", id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Customer profile successfully restored.");
      void load();
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("customers.title")} actions={
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11">
                <Download className="h-4.5 w-4.5 mr-1.5" />{t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("pdf")}>
                <FileText className="h-4 w-4 mr-2" />PDF Report
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx")}>
                <FileText className="h-4 w-4 mr-2" />Excel Sheet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Sheet open={open || !!editCustomer} onOpenChange={(v) => { if (!v) { setOpen(false); setEditCustomer(null); } }}>
            <SheetTrigger asChild>
              <Button onClick={() => setOpen(true)} className="h-11">
                <Plus className="h-4.5 w-4.5 mr-1.5" />{t("customers.addCustomer")}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{editCustomer ? "Edit Customer Details" : t("customers.addCustomer")}</SheetTitle>
              </SheetHeader>
              <CustomerForm 
                agencyId={agency?.id} 
                userId={session?.user?.id}
                editCustomer={editCustomer}
                onDone={() => { setOpen(false); setEditCustomer(null); void load(); }} 
              />
            </SheetContent>
          </Sheet>
        </div>
      } />

      {/* Search & Archives Toggle */}
      <Card className="shadow-soft"><CardContent className="p-4 flex flex-wrap gap-4 items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Input 
            placeholder={t("customers.searchPh")} 
            value={q} 
            onChange={(e) => setQ(e.target.value)} 
            className="h-11 pl-10"
          />
          <Search className="h-4.5 w-4.5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
        </div>
        <div className="flex items-center space-x-2">
          <Switch 
            id="archived" 
            checked={showArchived} 
            onCheckedChange={setShowArchived}
          />
          <Label htmlFor="archived" className="text-sm font-semibold text-muted-foreground cursor-pointer select-none">
            Show Archived Customers
          </Label>
        </div>
      </CardContent></Card>



      <Card className="shadow-card overflow-hidden">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState title={t("common.noData")} />
          ) : (
            <div className="divide-y divide-border/60">
              {filtered.map((c) => (
                <div key={c.id} className={`p-4 flex items-center justify-between gap-4 transition-colors ${c.is_deleted ? "bg-slate-50/50" : "hover:bg-accent/10"}`}>
                  <Link to="/app/customers/$id" params={{ id: c.id }} className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold truncate ${c.is_deleted ? "text-muted-foreground" : "text-foreground"}`}>
                        {c.name}
                      </span>
                      {c.is_deleted && (
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground border">
                          Archived
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Mob: <span className="font-medium text-foreground">{c.mobile ?? "—"}</span> · 
                      Village: <span className="font-medium text-foreground">{c.village ?? "—"}</span> · 
                      Ref: <span className="font-medium text-foreground">{c.consumer_number ?? "—"}</span>
                    </div>
                  </Link>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="flex items-center gap-1.5 justify-end">

                        <div className={`text-sm font-bold ${Number(c.outstanding) > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {fmtCurrency(c.outstanding)}
                        </div>
                      </div>
                      <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">{t("customers.outstanding")}</div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!c.is_deleted ? (
                        <>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditCustomer(c); }}
                            className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={(e) => archiveCustomer(c.id, e)}
                            className="h-9 w-9 p-0 text-destructive hover:bg-destructive/5"
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={(e) => restoreCustomer(c.id, e)}
                          className="h-9 px-2.5 gap-1.5 text-success hover:bg-success/5 font-semibold text-xs"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CustomerForm({ agencyId, userId, editCustomer, onDone }: { agencyId?: string; userId?: string; editCustomer: C | null; onDone: () => void }) {
  const [f, setF] = useState({ name: "", mobile: "", village: "", consumer_number: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editCustomer) {
      setF({
        name: editCustomer.name,
        mobile: editCustomer.mobile ?? "",
        village: editCustomer.village ?? "",
        consumer_number: editCustomer.consumer_number ?? ""
      });
    } else {
      setF({ name: "", mobile: "", village: "", consumer_number: "" });
    }
  }, [editCustomer]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); 
    if (!agencyId) return; 
    setBusy(true);

    try {
      if (editCustomer) {
        const { error } = await (supabase.from("customers") as any).update({
          name: f.name,
          mobile: f.mobile || null,
          village: f.village || null,
          consumer_number: f.consumer_number || null,
          updated_by: userId
        }).eq("id", editCustomer.id);
        
        if (error) throw error;
        toast.success("Customer profile updated.");
      } else {
        const { error } = await (supabase.from("customers") as any).insert({ 
          agency_id: agencyId, 
          name: f.name,
          mobile: f.mobile || null,
          village: f.village || null,
          consumer_number: f.consumer_number || null,
          created_by: userId
        });
        
        if (error) throw error;
        toast.success("Customer profile established.");
      }
      onDone();
    } catch (err: any) {
      toast.error(err?.message || (err instanceof Error ? err.message : "Operation failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 mt-6">
      <div className="space-y-1.5">
        <Label>Customer Name</Label>
        <Input required value={f.name} onChange={(e) => setF({...f, name: e.target.value})} placeholder="Ramesh Patel" className="h-11" />
      </div>
      <div className="space-y-1.5">
        <Label>Mobile Number</Label>
        <Input type="tel" value={f.mobile} onChange={(e) => setF({...f, mobile: e.target.value})} placeholder="9876543210" className="h-11" />
      </div>
      <div className="space-y-1.5">
        <Label>Village / Area</Label>
        <Input value={f.village} onChange={(e) => setF({...f, village: e.target.value})} placeholder="Pimpalgaon" className="h-11" />
      </div>
      <div className="space-y-1.5">
        <Label>Consumer Number (LPG Ref)</Label>
        <Input value={f.consumer_number} onChange={(e) => setF({...f, consumer_number: e.target.value})} placeholder="e.g. CX-9908" className="h-11" />
      </div>
      <Button type="submit" disabled={busy} className="w-full h-12 font-semibold mt-4">
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {editCustomer ? "Save Changes" : "Save Customer"}
      </Button>
    </form>
  );
}

