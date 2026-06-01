import { createFileRoute } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader, EmptyState } from "@/components/page-header";
import { 
  Plus, Download, FileText, Search, RotateCcw, Edit, Archive, X, Eye, Info, Clock, User 
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fmtCurrency, fmtDate, todayISO } from "@/lib/format";
import { exportToExcel, exportToPDF } from "@/lib/exports";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from "@/components/ui/dialog";

export const Route = createFileRoute("/app/expenses")({ component: () => <RequireAgencyUser><Page/></RequireAgencyUser> });

interface ExpenseRow {
  id: string;
  expense_date: string;
  category: string;
  amount: number;
  notes: string | null;
  delivery_boy_id: string | null;
  delivery_boy?: { name: string } | null;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

const CATS = [
  "bank_deposit",
  "vehicle_expense",
  "fuel",
  "repair",
  "maintenance",
  "paytm_transfer",
  "salary",
  "delivery_boy_payment",
  "miscellaneous"
] as const;

const catLabels: Record<string, string> = {
  bank_deposit: "Bank Deposit",
  vehicle_expense: "Vehicle Expense",
  fuel: "Fuel",
  repair: "Repair",
  maintenance: "Maintenance",
  paytm_transfer: "Paytm Transfer",
  salary: "Salary",
  delivery_boy_payment: "Delivery Boy Payment",
  miscellaneous: "Miscellaneous"
};

function Page() {
  const { t } = useTranslation();
  const { agency, session } = useAuth();
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [boys, setBoys] = useState<Array<{ id: string; name: string }>>([]);
  const [open, setOpen] = useState(false);
  const [editExpense, setEditExpense] = useState<ExpenseRow | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Advanced filters state
  const [q, setQ] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [showArchived, setShowArchived] = useState(false);

  // View Details & Void overlays
  const [selectedExpense, setSelectedExpense] = useState<ExpenseRow | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

  const load = async () => {
    if (!agency) return;
    setLoading(true);
    try {
      let query = supabase
        .from("expenses")
        .select("*")
        .eq("agency_id", agency.id);
      
      if (!showArchived) {
        query = query.eq("is_deleted", false);
      }
      
      const [{ data: expData, error }, { data: boysData }] = await Promise.all([
        query.order("expense_date", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("delivery_boys").select("id, name").eq("agency_id", agency.id).eq("is_deleted", false)
      ]);

      if (error) throw error;
      
      setBoys(boysData ?? []);
      setRows((expData ?? []) as unknown as ExpenseRow[]);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [agency, showArchived]);

  // Dynamic filter memo
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const notesText = r.notes ?? "";
      const catLabelText = catLabels[r.category] ?? r.category;
      
      const matchesSearch = !q.trim() || 
        notesText.toLowerCase().includes(q.toLowerCase()) ||
        catLabelText.toLowerCase().includes(q.toLowerCase()) ||
        String(r.amount).includes(q);
      
      const matchesStart = !startDate || r.expense_date >= startDate;
      const matchesEnd = !endDate || r.expense_date <= endDate;
      
      const matchesCat = filterCat === "all" || r.category === filterCat;
      
      return matchesSearch && matchesStart && matchesEnd && matchesCat;
    });
  }, [rows, q, startDate, endDate, filterCat]);

  const voidExpense = async () => {
    if (!confirmVoidId || !session) return;
    setVoiding(true);
    try {
      const { error } = await supabase
        .from("expenses")
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: session.user.id
        })
        .eq("id", confirmVoidId);

      if (error) throw error;
      toast.success("Expense transaction voided successfully.");
      setConfirmVoidId(null);
      void load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setVoiding(false);
    }
  };

  const restoreExpense = async (id: string) => {
    try {
      const { error } = await supabase
        .from("expenses")
        .update({
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
          updated_by: session?.user?.id
        })
        .eq("id", id);

      if (error) throw error;
      toast.success("Expense transaction successfully restored.");
      void load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const doExport = (kind: "pdf" | "xlsx") => {
    if (kind === "pdf") {
      const cols = ["Date", "Category", "Amount", "Remarks / Notes", "Status"];
      const data = filtered.map((r) => [
        fmtDate(r.expense_date),
        catLabels[r.category] ?? r.category.toUpperCase(),
        fmtCurrency(r.amount),
        r.notes ?? "—",
        r.is_deleted ? "Voided" : "Active"
      ]);
      exportToPDF("Overhead Expenses Log", cols, data, "expenses_ledger");
    } else {
      const data = filtered.map((r) => ({
        Date: fmtDate(r.expense_date),
        Category: catLabels[r.category] ?? r.category,
        "Amount (INR)": Number(r.amount),
        Notes: r.notes ?? "—",
        "Is Voided": r.is_deleted ? "Yes" : "No"
      }));
      exportToExcel(data, "expenses_ledger", "Overhead Expenses");
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader title={t("expenses.title")} actions={
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11">
                <Download className="h-4 w-4 mr-1.5" />{t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("pdf")}><FileText className="h-4 w-4 mr-2 text-primary" />PDF History Log</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx")}><FileText className="h-4 w-4 mr-2 text-success" />Excel Sheet</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Sheet open={open || !!editExpense} onOpenChange={(v) => { if (!v) { setOpen(false); setEditExpense(null); } }}>
            <SheetTrigger asChild>
              <Button onClick={() => setOpen(true)} className="h-11">
                <Plus className="h-4 w-4 mr-1.5" />{t("expenses.newExpense")}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{editExpense ? "Edit Expense details" : t("expenses.newExpense")}</SheetTitle>
              </SheetHeader>
              <ExpenseForm 
                editExpense={editExpense} 
                onDone={() => { setOpen(false); setEditExpense(null); void load(); }} 
              />
            </SheetContent>
          </Sheet>
        </div>
      } />

      {/* Filters Panel */}
      <Card className="shadow-soft"><CardContent className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Search Expense</Label>
            <div className="relative">
              <Input 
                placeholder="Search amount, notes..." 
                value={q} 
                onChange={(e) => setQ(e.target.value)} 
                className="h-10 pl-9 text-sm"
              />
              <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Expense Category</Label>
            <Select value={filterCat} onValueChange={setFilterCat}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATS.map((c) => (
                  <SelectItem key={c} value={c}>{catLabels[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date Filters</Label>
            <div className="flex gap-1.5 items-center">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10 text-xs px-2" />
              <span className="text-muted-foreground text-xs">to</span>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10 text-xs px-2" />
              {(startDate || endDate) && (
                <Button variant="ghost" size="icon" onClick={() => { setStartDate(""); setEndDate(""); }} className="h-10 w-10 shrink-0">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <div className="flex items-center space-x-2 select-none">
            <Switch id="archived" checked={showArchived} onCheckedChange={setShowArchived} />
            <Label htmlFor="archived" className="text-xs font-medium cursor-pointer">Show Archived / Voided Expenses</Label>
          </div>
          <div className="text-xs text-muted-foreground">
            Showing <strong className="text-foreground">{filtered.length}</strong> records
          </div>
        </div>
      </CardContent></Card>

      {/* Expenses Table */}
      <Card className="shadow-soft overflow-hidden"><CardContent className="p-0">
        {loading ? (
          <div className="p-12 text-center text-xs text-muted-foreground animate-pulse">Loading overhead expenses...</div>
        ) : filtered.length === 0 ? (
          <EmptyState title={t("common.noData")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-muted/50 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none">
                  <th className="p-4">{t("common.date")}</th>
                  <th className="p-4">{t("expenses.category")}</th>
                  <th className="p-4">Notes / Remarks</th>
                  <th className="p-4 text-right">Debit Amount</th>
                  <th className="p-4 text-center">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.map((r) => (
                  <tr 
                    key={r.id} 
                    onClick={() => { setSelectedExpense(r); setShowDetails(true); }}
                    className={`hover:bg-muted/15 transition-colors cursor-pointer ${
                      r.is_deleted ? "bg-destructive/5 text-muted-foreground line-through" : ""
                    }`}
                  >
                    <td className="p-4 font-semibold whitespace-nowrap">{fmtDate(r.expense_date)}</td>
                    <td className="p-4 font-bold">
                      <span className="inline-block px-2.5 py-1 rounded bg-muted font-medium text-xs">
                        {catLabels[r.category] ?? r.category}
                        {r.category === "delivery_boy_payment" && r.delivery_boy_id && ` (${boys.find(b => b.id === r.delivery_boy_id)?.name ?? "Boy " + r.delivery_boy_id.substring(0, 8)})`}
                      </span>
                    </td>
                    <td className="p-4 text-muted-foreground text-xs italic truncate max-w-xs">{r.notes ?? "—"}</td>
                    <td className="p-4 text-right font-black text-destructive whitespace-nowrap">
                      - {fmtCurrency(r.amount)}
                    </td>
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => { setSelectedExpense(r); setShowDetails(true); }}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {!r.is_deleted ? (
                          <>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => setEditExpense(r)}
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => setConfirmVoidId(r.id)}
                              className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 text-destructive/70"
                            >
                              <Archive className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => restoreExpense(r.id)}
                            className="h-8 px-2 text-success hover:bg-success/5 font-semibold text-xs"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent></Card>

      {/* Expense details dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md bg-white border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" /> Expense Record Details
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Ref ID: <span className="font-mono font-semibold text-foreground uppercase">{selectedExpense?.id}</span>
            </DialogDescription>
          </DialogHeader>

          {selectedExpense && (
            <div className="space-y-5 mt-4">
              
              {/* Primary metrics panel */}
              <div className="grid grid-cols-2 gap-4 bg-muted/40 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Debit Outflow</span>
                  <div className="font-black text-base text-destructive mt-0.5">
                    - {fmtCurrency(selectedExpense.amount)}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Log Status</span>
                  <div className="mt-0.5">
                    {selectedExpense.is_deleted ? (
                      <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">Voided / Cancelled</span>
                    ) : (
                      <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded bg-success/15 text-success border border-success/20">Active Payout</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Data fields */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b pb-1">Expense Breakdown</h4>
                
                <div className="grid grid-cols-2 gap-y-2 text-xs">
                  <div className="text-muted-foreground">Expense Date</div>
                  <div className="font-semibold text-foreground text-right">{fmtDate(selectedExpense.expense_date)}</div>

                  <div className="text-muted-foreground">Category</div>
                  <div className="font-bold text-foreground text-right">{catLabels[selectedExpense.category] ?? selectedExpense.category}</div>

                  {selectedExpense.category === "delivery_boy_payment" && selectedExpense.delivery_boy_id && (
                    <>
                      <div className="text-muted-foreground">Delivery Boy Payout</div>
                      <div className="font-bold text-primary text-right">
                        {boys.find(b => b.id === selectedExpense.delivery_boy_id)?.name ?? "Boy " + selectedExpense.delivery_boy_id.substring(0, 8)}
                      </div>
                    </>
                  )}

                  <div className="text-muted-foreground">Remarks / Notes</div>
                  <div className="font-medium text-foreground text-right italic truncate max-w-xs">{selectedExpense.notes ?? "—"}</div>
                </div>
              </div>

              {/* AUDIT TRAIL METADATA SECTION */}
              <div className="space-y-2.5 bg-slate-50/50 p-4 rounded-xl border border-dashed border-slate-200">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 select-none">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Complete System Audit Trail
                </h4>
                
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1"><User className="h-3 w-3" /> Created By</span>
                    <span className="font-mono text-[10px] text-foreground font-semibold bg-white border px-1.5 py-0.5 rounded">
                      {selectedExpense.created_by ? `UID: ${selectedExpense.created_by.substring(0, 8)}` : "System / Seeder"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span>Created Timestamp</span>
                    <span className="font-semibold text-foreground">
                      {new Date(selectedExpense.created_at).toLocaleString()}
                    </span>
                  </div>

                  {selectedExpense.updated_by && (
                    <div className="flex justify-between items-center border-t pt-1.5 mt-1.5">
                      <span className="flex items-center gap-1"><User className="h-3 w-3" /> Last Updated By</span>
                      <span className="font-mono text-[10px] text-foreground font-semibold bg-white border px-1.5 py-0.5 rounded">
                        UID: {selectedExpense.updated_by.substring(0, 8)}
                      </span>
                    </div>
                  )}

                  {selectedExpense.updated_at && selectedExpense.updated_by && (
                    <div className="flex justify-between items-center">
                      <span>Last Updated Timestamp</span>
                      <span className="font-semibold text-foreground">
                        {new Date(selectedExpense.updated_at).toLocaleString()}
                      </span>
                    </div>
                  )}

                  {selectedExpense.is_deleted && (
                    <div className="space-y-1.5 border-t border-destructive/25 pt-1.5 mt-1.5 bg-destructive/5 -mx-4 -mb-4 p-4 rounded-b-xl text-destructive-dark">
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1"><User className="h-3 w-3" /> Voided/Deleted By</span>
                        <span className="font-mono text-[10px] text-destructive-dark font-black bg-white border border-destructive/25 px-1.5 py-0.5 rounded">
                          UID: {selectedExpense.deleted_by?.substring(0, 8)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Voided Timestamp</span>
                        <span className="font-extrabold text-destructive-dark">
                          {selectedExpense.deleted_at ? new Date(selectedExpense.deleted_at).toLocaleString() : "—"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                {selectedExpense.is_deleted ? (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      void restoreExpense(selectedExpense.id);
                      setShowDetails(false);
                    }}
                    className="border-success/30 hover:bg-success/5 text-success font-bold"
                  >
                    <RotateCcw className="h-4 w-4 mr-1.5" /> Restore Outflow Log
                  </Button>
                ) : (
                  <Button 
                    variant="destructive"
                    onClick={() => {
                      setShowDetails(false);
                      setConfirmVoidId(selectedExpense.id);
                    }}
                    className="font-bold"
                  >
                    <Archive className="h-4 w-4 mr-1.5" /> Void Expense Log
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setShowDetails(false)}>Close</Button>
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Void Expense */}
      <Dialog open={!!confirmVoidId} onOpenChange={(v) => { if (!v) setConfirmVoidId(null); }}>
        <DialogContent className="max-w-sm bg-white border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-destructive flex items-center gap-2">
              ⚠️ Cancel Expense Log?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-2">
              Are you sure you want to void this expense transaction? Cash book balances and daily reconciliation logs will be adjusted immediately. This action is audited.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setConfirmVoidId(null)} disabled={voiding}>
              No, Keep Log
            </Button>
            <Button onClick={voidExpense} disabled={voiding} className="bg-destructive hover:bg-destructive-dark text-white font-bold">
              {voiding ? "Voiding..." : "Yes, Void Expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

// Expense Form Sheet
interface FormProps {
  editExpense: ExpenseRow | null;
  onDone: () => void;
}

function ExpenseForm({ editExpense, onDone }: FormProps) {
  const { t } = useTranslation();
  const { agency, session } = useAuth();
  const [expense_date, setExpenseDate] = useState(editExpense?.expense_date ?? todayISO());
  const [category, setCategory] = useState(editExpense?.category ?? "miscellaneous");
  const [amount, setAmount] = useState(editExpense?.amount ? String(editExpense.amount) : "");
  const [notes, setNotes] = useState(editExpense?.notes ?? "");
  const [delivery_boy_id, setDeliveryBoyId] = useState(editExpense?.delivery_boy_id ?? "");
  const [boys, setBoys] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!agency) return;
    void (async () => {
      const { data } = await supabase
        .from("delivery_boys")
        .select("id, name")
        .eq("agency_id", agency.id)
        .eq("is_deleted", false)
        .order("name");
      setBoys(data ?? []);
    })();
  }, [agency]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agency) return;
    setBusy(true);

    const val = Number(amount);
    if (isNaN(val) || val <= 0) {
      toast.error("Please enter a valid amount greater than zero.");
      setBusy(false);
      return;
    }

    const isBoyPayment = category === "delivery_boy_payment";
    if (isBoyPayment && !delivery_boy_id) {
      toast.error("Please select a delivery boy.");
      setBusy(false);
      return;
    }

    const payload = {
      agency_id: agency.id,
      expense_date,
      category: category as any,
      amount: val,
      notes: notes || null,
      delivery_boy_id: isBoyPayment ? delivery_boy_id : null,
      updated_by: session?.user?.id
    };

    try {
      if (editExpense) {
        // Edit
        const { error } = await supabase
          .from("expenses")
          .update(payload)
          .eq("id", editExpense.id);

        if (error) throw error;
        toast.success("Expense record updated successfully.");
        onDone();
      } else {
        // Create
        const { error } = await supabase
          .from("expenses")
          .insert({
            ...payload,
            created_by: session?.user?.id
          });

        if (error) throw error;
        toast.success("Expense recorded successfully.");
        onDone();
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 pt-4">
      <div className="space-y-1.5">
        <Label>{t("common.date")}</Label>
        <Input 
          type="date" 
          required 
          value={expense_date} 
          onChange={(e) => setExpenseDate(e.target.value)} 
          className="h-11 text-sm" 
        />
      </div>

      <div className="space-y-1.5">
        <Label>{t("expenses.category")}</Label>
        <Select value={category} onValueChange={(v) => { setCategory(v); if (v !== "delivery_boy_payment") setDeliveryBoyId(""); }}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATS.map((c) => (
              <SelectItem key={c} value={c}>{catLabels[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {category === "delivery_boy_payment" && (
        <div className="space-y-1.5 animate-fade-in">
          <Label>Select Delivery Boy</Label>
          <Select value={delivery_boy_id} onValueChange={setDeliveryBoyId}>
            <SelectTrigger className="h-11">
              <SelectValue placeholder="Select Delivery Boy..." />
            </SelectTrigger>
            <SelectContent>
              {boys.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t("common.amount")}</Label>
        <Input 
          type="number" 
          step="0.01"
          required 
          value={amount} 
          onChange={(e) => setAmount(e.target.value)} 
          placeholder="0.00"
          className="h-11" 
        />
      </div>

      <div className="space-y-1.5">
        <Label>Remarks / Overhead Description</Label>
        <Textarea 
          placeholder="Enter payment reference details, vendor bills..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
        />
      </div>

      <div className="flex gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onDone} className="w-1/2 h-11">
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy} className="w-1/2 h-11">
          {busy ? "Saving..." : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
