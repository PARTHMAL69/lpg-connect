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
  Plus, Download, FileText, Search, Calendar, Archive, RotateCcw, 
  Edit, Loader2, Eye, Info, Clock, User 
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fmtCurrency, fmtDate, todayISO } from "@/lib/format";
import { reconcileCustomerOutstanding, compensateSaleLedger, syncSaleLedger } from "@/lib/accounting";
import { recordSaleDeduction, reverseSaleDeduction } from "@/lib/stock-store";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { exportToExcel, exportToPDF } from "@/lib/exports";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from "@/components/ui/dialog";
import { getFriendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/app/sales")({ component: () => <RequireAgencyUser><Page/></RequireAgencyUser> });

interface Row { 
  id: string; 
  sale_date: string; 
  customer_id: string | null;
  customer_name: string | null; 
  product_id: string | null;
  product_name: string; 
  quantity: number; 
  rate: number; 
  total: number; 
  payment_mode: string;
  delivery_boy_id: string | null;
  commission_rate: number;
  commission_total: number;
  net_amount: number;
  notes: string | null;
  display_notes?: string;
  txn_no: string | null;
  is_deleted: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
}

function Page() {
  const { t } = useTranslation();
  const { agency, session } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [editSale, setEditSale] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Advanced filters state
  const [q, setQ] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [filterProduct, setFilterProduct] = useState("all");
  const [showArchived, setShowArchived] = useState(false);

  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);

  // Detail Modal & Void confirmation states
  const [selectedSale, setSelectedSale] = useState<Row | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

  const load = async () => {
    if (!agency) return;
    setLoading(true);
    try {
      let query = supabase
        .from("sales")
        .select(`
          *,
          customer:customers(name),
          product:products(name)
        `)
        .eq("agency_id", agency.id);
      
      if (!showArchived) {
        query = query.eq("is_deleted", false);
      }
      
      const { data, error } = await query
        .order("sale_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;

      const formattedRows = (data ?? []).map((s: any) => {
        let isCheque = false;
        let displayNotes = s.notes ?? "";
        let paymentMode = s.payment_mode;
        if (s.notes) {
          try {
            const meta = JSON.parse(s.notes);
            if (meta && typeof meta === "object") {
              if (meta.is_cheque) {
                isCheque = true;
                paymentMode = "cheque";
                displayNotes = meta.remarks ?? "";
              } else if (meta.is_split) {
                const parts: string[] = [];
                if (meta.cash_amount) parts.push(`Cash ₹${Number(meta.cash_amount).toLocaleString("en-IN")}`);
                if (meta.online_amount) parts.push(`Online ₹${Number(meta.online_amount).toLocaleString("en-IN")}`);
                if (meta.credit_amount) parts.push(`Credit ₹${Number(meta.credit_amount).toLocaleString("en-IN")}`);
                const rem = meta.remarks ? ` · Notes: ${meta.remarks}` : "";
                displayNotes = `Split [${parts.join(" + ")}]${rem}`;
              } else if (meta.website_prepaid_qty != null) {
                const rem = meta.remarks ? ` · Notes: ${meta.remarks}` : "";
                displayNotes = `Website Prepaid: ${meta.website_prepaid_qty} units${rem}`;
              }
            }
          } catch (e) {}
        }
        return {
          id: s.id,
          sale_date: s.sale_date,
          customer_id: s.customer_id,
          customer_name: s.customer?.name ?? null,
          product_id: s.product_id,
          product_name: s.product?.name ?? "Cylinder",
          quantity: Number(s.quantity),
          rate: Number(s.rate),
          total: Number(s.gross_amount),
          payment_mode: paymentMode,
          delivery_boy_id: s.delivery_boy_id,
          commission_rate: Number(s.commission_rate),
          commission_total: Number(s.commission_amount),
          net_amount: Number(s.net_amount),
          notes: s.notes,
          display_notes: displayNotes,
          txn_no: s.txn_no,
          is_deleted: s.is_deleted,
          created_at: s.created_at,
          created_by: s.created_by,
          updated_at: s.updated_at,
          updated_by: s.updated_by,
          deleted_at: s.deleted_at,
          deleted_by: s.deleted_by
        };
      });

      setRows(formattedRows as Row[]);

      // Fetch unique products for filtering
      const { data: pData } = await (supabase.from("products") as any).select("id, name").eq("agency_id", agency.id).eq("is_deleted", false);
      setProducts(pData ?? []);
    } catch (err: any) {
      toast.error(getFriendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [agency, showArchived]);

  // Dynamic search/filter memo
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      // 1. Search Query (Product, Customer name, Notes)
      const matchesSearch = !q.trim() || 
        r.product_name.toLowerCase().includes(q.toLowerCase()) ||
        (r.customer_name ?? "").toLowerCase().includes(q.toLowerCase()) ||
        (r.display_notes ?? r.notes ?? "").toLowerCase().includes(q.toLowerCase());
      
      // 2. Date Range
      const matchesStart = !startDate || r.sale_date >= startDate;
      const matchesEnd = !endDate || r.sale_date <= endDate;

      // 3. Payment Mode
      const matchesMode = filterMode === "all" || r.payment_mode === filterMode;

      // 4. Product
      const matchesProduct = filterProduct === "all" || r.product_id === filterProduct;

      return matchesSearch && matchesStart && matchesEnd && matchesMode && matchesProduct;
    });
  }, [rows, q, startDate, endDate, filterMode, filterProduct]);

  const voidSale = async () => {
    if (!confirmVoidId || !session) return;
    setVoiding(true);
    try {
      const voidedSale = rows.find(r => r.id === confirmVoidId);
      const { error } = await (supabase.from("sales") as any).update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: session.user.id
      }).eq("id", confirmVoidId);

      if (error) throw error;
      
      // Explicitly delete from customer_ledger to bypass database trigger bugs
      await supabase.from("customer_ledger").delete().eq("sale_id", confirmVoidId);

      // Compensate customer ledger and outstanding balance
      if (voidedSale?.customer_id) {
        await reconcileCustomerOutstanding(voidedSale.customer_id);
      }

      // Revert stock deduction
      if (agency && voidedSale?.product_id) {
        reverseSaleDeduction(agency.id, voidedSale.product_id, voidedSale.product_name, voidedSale.quantity, voidedSale.id, session.user.id);
      }
      
      toast.success("Sale invoice voided successfully.");
      setConfirmVoidId(null);
      void load();
    } catch (err: any) {
      toast.error(getFriendlyError(err));
    } finally {
      setVoiding(false);
    }
  };

  const restoreSale = async (id: string) => {
    try {
      const restoredSale = rows.find(r => r.id === id);
      const { error } = await (supabase.from("sales") as any).update({
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        updated_by: session?.user?.id
      }).eq("id", id);

      if (error) throw error;
      
      // Reconstruct customer ledger entry using syncSaleLedger for absolute correctness
      if (restoredSale?.customer_id && agency) {
        let isSplit = false;
        let creditAmount = 0;
        if (restoredSale.notes) {
          try {
            const meta = JSON.parse(restoredSale.notes);
            if (meta && typeof meta === "object") {
              if (meta.is_split) {
                isSplit = true;
                creditAmount = Number(meta.credit_amount || 0);
              }
            }
          } catch (e) {}
        }
        await syncSaleLedger(
          id,
          restoredSale.customer_id,
          isSplit,
          creditAmount,
          restoredSale.total,
          restoredSale.txn_no || null,
          restoredSale.sale_date,
          agency.id,
          restoredSale.payment_mode
        );
      }

      // Re-apply stock deduction
      if (agency && restoredSale?.product_id) {
        recordSaleDeduction(agency.id, restoredSale.product_id, restoredSale.product_name, restoredSale.quantity, restoredSale.id, session?.user?.id);
      }
      
      toast.success("Sale invoice successfully restored.");
      void load();
    } catch (err: any) {
      toast.error(getFriendlyError(err));
    }
  };

  const doExport = (kind: "pdf" | "xlsx") => {
    if (kind === "pdf") {
      const cols = ["Date", "Customer", "Product", "Qty", "Rate", "Total", "Mode"];
      const data = filtered.map((r) => [
        fmtDate(r.sale_date),
        r.customer_name ?? "—",
        r.product_name,
        r.quantity,
        fmtCurrency(r.rate),
        fmtCurrency(r.total),
        r.payment_mode.toUpperCase()
      ]);
      exportToPDF("Sales Invoice Register", cols, data, "sales_report");
    } else {
      const data = filtered.map((r) => ({
        Date: fmtDate(r.sale_date),
        "Invoice No": r.id.substring(0, 8).toUpperCase(),
        Customer: r.customer_name ?? "—",
        Product: r.product_name,
        Quantity: Number(r.quantity),
        Rate: Number(r.rate),
        "Gross Invoice (INR)": Number(r.total),
        "Payment Mode": r.payment_mode.toUpperCase(),
        "Commission Rate": Number(r.commission_rate),
        "Total Commission Paid": Number(r.commission_total),
        "Net Cash Received": Number(r.net_amount),
        "Is Voided": r.is_deleted ? "Yes" : "No"
      }));
      exportToExcel(data, "sales_report", "Sales Invoice Register");
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader title={t("sales.title")} actions={
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11">
                <Download className="h-4 w-4 mr-1.5" />{t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("pdf")}><FileText className="h-4 w-4 mr-2 text-primary" />PDF Invoice Log</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx")}><FileText className="h-4 w-4 mr-2 text-success" />Excel Sheet</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Sheet open={open || !!editSale} onOpenChange={(v) => { if (!v) { setOpen(false); setEditSale(null); } }}>
            <SheetTrigger asChild>
              <Button onClick={() => setOpen(true)} className="h-11">
                <Plus className="h-4 w-4 mr-1.5" />{t("sales.newSale")}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{editSale ? "Edit Sale Details" : t("sales.newSale")}</SheetTitle>
              </SheetHeader>
              <SaleForm 
                editSale={editSale} 
                onDone={() => { setOpen(false); setEditSale(null); void load(); }} 
              />
            </SheetContent>
          </Sheet>
        </div>
      } />

      {/* Advanced Filters Panel */}
      <Card className="shadow-soft"><CardContent className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Search Sales</Label>
            <div className="relative">
              <Input 
                placeholder="Product, customer, notes..." 
                value={q} 
                onChange={(e) => setQ(e.target.value)} 
                className="h-10 pl-9 text-sm"
              />
              <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment Mode</Label>
            <Select value={filterMode} onValueChange={setFilterMode}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modes</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="paytm">Paytm</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="credit">Credit (Udhari)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Product Filter</Label>
            <Select value={filterProduct} onValueChange={setFilterProduct}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date Filters</Label>
            <div className="flex gap-1.5 items-center">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10 text-xs px-2" />
              <span className="text-slate-400 font-bold text-xs">to</span>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10 text-xs px-2" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end border-t pt-3">
          <div className="flex items-center space-x-2 select-none">
            <Switch id="archived-sales" checked={showArchived} onCheckedChange={setShowArchived} />
            <Label htmlFor="archived-sales" className="text-xs font-semibold text-muted-foreground cursor-pointer">
              Show Voided/Cancelled Sales
            </Label>
          </div>
        </div>
      </CardContent></Card>

      <Card className="shadow-card overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-xs text-muted-foreground animate-pulse">Loading sales invoice ledger...</div>
          ) : filtered.length === 0 ? (
            <EmptyState title={t("common.noData")} />
          ) : (
            <div className="divide-y divide-border/60">
              {filtered.map((r) => (
                <div 
                  key={r.id} 
                  onClick={() => { setSelectedSale(r); setShowDetails(true); }}
                  className={`p-5 flex flex-wrap items-center justify-between gap-4 transition-all cursor-pointer ${
                    r.is_deleted ? "bg-slate-50/50 text-muted-foreground" : "hover:bg-accent/5"
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-foreground">{r.product_name} × {r.quantity}</span>
                      <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                        r.payment_mode === "credit" ? "bg-red-50 text-red-600 border border-red-200" : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                      }`}>
                        {r.payment_mode}
                      </span>
                      {r.is_deleted && (
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border">
                          Voided
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-medium">
                      Cust: <span className="text-foreground font-semibold">{r.customer_name ?? "Direct / Walk-in"}</span> · 
                      Date: <span className="text-foreground font-semibold">{fmtDate(r.sale_date)}</span> · 
                      Ref: <span className="font-semibold uppercase">{r.id.substring(0, 8)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                    <div className="text-right space-y-0.5">
                      <div className="text-sm font-bold text-primary">{fmtCurrency(r.total)}</div>
                      <div className="text-[10px] text-muted-foreground uppercase font-semibold">Net Received: {fmtCurrency(r.net_amount)}</div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => { setSelectedSale(r); setShowDetails(true); }}
                        className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {!r.is_deleted ? (
                        <>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setEditSale(r)}
                            className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setConfirmVoidId(r.id)}
                            className="h-9 w-9 p-0 text-destructive hover:bg-destructive/5"
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => restoreSale(r.id)}
                          className="h-9 px-2 text-success hover:bg-success/5 font-semibold text-xs"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
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

      {/* Sale Details & System Audit Trail Modal */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-lg bg-white border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" /> Sale Invoice Details
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Ref ID: <span className="font-mono font-semibold text-foreground uppercase">{selectedSale?.id}</span>
            </DialogDescription>
          </DialogHeader>

          {selectedSale && (
            <div className="space-y-5 mt-4">
              
              {/* Primary metrics panel */}
              <div className="grid grid-cols-2 gap-4 bg-muted/40 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Product Sold</span>
                  <div className="font-bold text-sm text-foreground mt-0.5">
                    {selectedSale.product_name}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Invoice Status</span>
                  <div className="mt-0.5">
                    {selectedSale.is_deleted ? (
                      <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">Voided / Void</span>
                    ) : (
                      <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded bg-success/15 text-success border border-success/20">Active Invoice</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Data fields */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b pb-1">Invoice Breakdown</h4>
                
                <div className="grid grid-cols-2 gap-y-2 text-xs">
                  <div className="text-muted-foreground">Sale Date</div>
                  <div className="font-semibold text-foreground text-right">{fmtDate(selectedSale.sale_date)}</div>

                  <div className="text-muted-foreground">Customer</div>
                  <div className="font-bold text-foreground text-right">{selectedSale.customer_name ?? "Direct Counter client"}</div>

                  <div className="text-muted-foreground">Quantity & Base Rate</div>
                  <div className="font-semibold text-foreground text-right">
                    {selectedSale.quantity} unit(s) @ {fmtCurrency(selectedSale.rate)}
                  </div>

                  <div className="text-muted-foreground">Gross Invoice Total</div>
                  <div className="font-black text-destructive text-right">{fmtCurrency(selectedSale.total)}</div>

                  <div className="text-muted-foreground">Delivery Boy Commission</div>
                  <div className="font-semibold text-foreground text-right">
                    {selectedSale.commission_total > 0 ? `${fmtCurrency(selectedSale.commission_total)} (${fmtCurrency(selectedSale.commission_rate)}/unit)` : "—"}
                  </div>

                  <div className="text-muted-foreground">Net Cash Received</div>
                  <div className="font-black text-success text-right">{fmtCurrency(selectedSale.net_amount)}</div>

                  <div className="text-muted-foreground">Payment Mode</div>
                  <div className="font-bold text-foreground uppercase text-right">{selectedSale.payment_mode}</div>

                  <div className="text-muted-foreground">Notes / Remarks</div>
                  <div className="font-medium text-foreground text-right italic truncate max-w-xs">{selectedSale.display_notes ?? selectedSale.notes ?? "—"}</div>
                </div>
              </div>

              {/* AUDIT TRAIL METADATA SECTION */}
              <div className="space-y-2.5 bg-slate-50/50 p-4 rounded-xl border border-dashed border-slate-200">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 select-none">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" /> System Records
                </h4>
                
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex justify-between items-center">
                    <span>Created At</span>
                    <span className="font-semibold text-foreground">
                      {new Date(selectedSale.created_at).toLocaleString()}
                    </span>
                  </div>

                  {selectedSale.updated_at && selectedSale.updated_by && (
                    <div className="flex justify-between items-center border-t pt-1.5 mt-1.5">
                      <span>Last Updated At</span>
                      <span className="font-semibold text-foreground">
                        {new Date(selectedSale.updated_at).toLocaleString()}
                      </span>
                    </div>
                  )}

                  {selectedSale.is_deleted && (
                    <div className="space-y-1.5 border-t border-destructive/25 pt-1.5 mt-1.5 bg-destructive/5 -mx-4 -mb-4 p-4 rounded-b-xl text-destructive-dark">
                      <div className="flex justify-between items-center">
                        <span>Voided At</span>
                        <span className="font-extrabold text-destructive-dark text-right">
                          {selectedSale.deleted_at ? new Date(selectedSale.deleted_at).toLocaleString() : "—"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                {selectedSale.is_deleted ? (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      void restoreSale(selectedSale.id);
                      setShowDetails(false);
                    }}
                    className="border-success/30 hover:bg-success/5 text-success font-bold"
                  >
                    <RotateCcw className="h-4 w-4 mr-1.5" /> Restore Sale Invoice
                  </Button>
                ) : (
                  <Button 
                    variant="destructive"
                    onClick={() => {
                      setShowDetails(false);
                      setConfirmVoidId(selectedSale.id);
                    }}
                    className="font-bold"
                  >
                    <Archive className="h-4 w-4 mr-1.5" /> Void Sale Invoice
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setShowDetails(false)}>Close</Button>
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation overlay for Void Sale */}
      <Dialog open={!!confirmVoidId} onOpenChange={(v) => { if (!v) setConfirmVoidId(null); }}>
        <DialogContent className="max-w-sm bg-white border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-destructive flex items-center gap-2">
              ⚠️ Cancel Sale Invoice?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-2">
              Are you sure you want to void this sale? Outstanding customer dues and route commissions will be instantly adjusted and reversed. This action is fully audited.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setConfirmVoidId(null)} disabled={voiding}>
              No, Keep Sale
            </Button>
            <Button onClick={voidSale} disabled={voiding} className="bg-destructive hover:bg-destructive-dark text-white font-bold">
              {voiding ? "Voiding..." : "Yes, Void Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function SaleForm({ editSale, onDone }: { editSale: Row | null; onDone: () => void }) {
  const { agency, session } = useAuth(); 
  const { t } = useTranslation();
  
  const [products, setProducts] = useState<Array<{ id: string; name: string; rate: number }>>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [boys, setBoys] = useState<Array<{ id: string; name: string; commission_rate: number }>>([]);

  interface ProductRow {
    key: string;
    product_id: string;
    quantity: string;
    rate: string;
    commission_rate: string;
    prepaid_qty: string;
  }

  const [prodRows, setProdRows] = useState<ProductRow[]>([
    { key: "row-0", product_id: "", quantity: "1", rate: "", commission_rate: "0", prepaid_qty: "0" }
  ]);

  const [f, setF] = useState({
    sale_date: todayISO(), customer_id: "",
    payment_mode: "split", delivery_boy_id: "", notes: "",
  });

  const [isSplit, setIsSplit] = useState(true);
  const [splitCash, setSplitCash] = useState("0");
  const [splitOnline, setSplitOnline] = useState("0");
  const [splitCredit, setSplitCredit] = useState("0");

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!agency) return;
    (async () => {
      const [p, c, d] = await Promise.all([
        supabase.from("products").select("id, name, rate").eq("agency_id", agency.id).eq("is_active", true).eq("is_deleted", false).order("name"),
        supabase.from("customers").select("id, name").eq("agency_id", agency.id).eq("is_deleted", false).order("name"),
        supabase.from("delivery_boys").select("id, name, commission_rate:default_commission").eq("agency_id", agency.id).eq("is_active", true).eq("is_deleted", false),
      ]);
      setProducts((p.data ?? []) as typeof products);
      setCustomers((c.data ?? []) as typeof customers);
      setBoys((d.data ?? []) as typeof boys);
    })();
  }, [agency]);

  const boy = useMemo(() => boys.find((b) => b.id === f.delivery_boy_id), [boys, f.delivery_boy_id]);

  useEffect(() => {
    if (editSale) {
      let split = false;
      let cashAmt = "0";
      let onlineAmt = "0";
      let creditAmt = "0";
      let remarks = editSale.notes ?? "";
      let prepQty = "0";

      if (editSale.notes) {
        try {
          const meta = JSON.parse(editSale.notes);
          if (meta && typeof meta === "object") {
            if (meta.is_split) {
              split = true;
              cashAmt = String(meta.cash_amount ?? 0);
              onlineAmt = String(meta.online_amount ?? 0);
              creditAmt = String(meta.credit_amount ?? 0);
            }
            if (meta.website_prepaid_qty != null) {
              prepQty = String(meta.website_prepaid_qty);
            }
            remarks = meta.remarks ?? "";
          }
        } catch (e) {}
      }

      setIsSplit(split);
      setSplitCash(cashAmt);
      setSplitOnline(onlineAmt);
      setSplitCredit(creditAmt);

      setProdRows([
        {
          key: "row-edit",
          product_id: editSale.product_id ?? "",
          quantity: String(editSale.quantity),
          rate: String(editSale.rate),
          commission_rate: String(editSale.commission_rate),
          prepaid_qty: prepQty,
        }
      ]);

      setF({
        sale_date: editSale.sale_date,
        customer_id: editSale.customer_id ?? "",
        payment_mode: split ? "split" : editSale.payment_mode,
        delivery_boy_id: editSale.delivery_boy_id ?? "",
        notes: remarks,
      });
    } else {
      setIsSplit(true);
      setSplitCash("0");
      setSplitOnline("0");
      setSplitCredit("0");
      setProdRows([
        { key: "row-0", product_id: "", quantity: "1", rate: "", commission_rate: "0", prepaid_qty: "0" }
      ]);
      setF({
        sale_date: todayISO(), customer_id: "",
        payment_mode: "split", delivery_boy_id: "", notes: "",
      });
    }
  }, [editSale]);

  const calculatedRows = useMemo(() => {
    return prodRows.map((row) => {
      const prod = products.find(p => p.id === row.product_id);
      const isCnc = prod ? prod.name.toLowerCase().includes("cnc") : false;

      const qty = Math.max(0, Math.round(Number(row.quantity || 0)));
      const prep = Math.max(0, Math.round(Number(row.prepaid_qty || 0)));
      const billedQty = Math.max(0, qty - prep);
      const rateVal = Math.max(0, Number(row.rate || 0));
      const grossTotal = billedQty * rateVal;
      const commissionPerUnit = isCnc ? 0 : Math.max(0, Number(row.commission_rate || 0));
      const commissionTotal = commissionPerUnit * qty;
      const netTotal = grossTotal - commissionTotal;

      return {
        ...row,
        product_name: prod ? prod.name : "Cylinder",
        isCnc,
        qty,
        prep,
        billedQty,
        rateVal,
        grossTotal,
        commissionPerUnit,
        commissionTotal,
        netTotal,
      };
    });
  }, [prodRows, products]);

  const combinedGross = calculatedRows.reduce((sum, r) => sum + r.grossTotal, 0);
  const combinedCommission = calculatedRows.reduce((sum, r) => sum + r.commissionTotal, 0);
  const combinedNet = combinedGross - combinedCommission;

  const isFirstCnc = calculatedRows[0]?.isCnc ?? false;
  const showDeliveryAndAddBtn = !isFirstCnc;

  const splitTarget = Math.max(0, combinedNet);
  const splitSum = Number(splitCash || 0) + Number(splitOnline || 0) + Number(splitCredit || 0);
  const isSplitValid = Math.abs(splitSum - splitTarget) < 0.01;

  useEffect(() => {
    if (isSplit && combinedNet >= 0) {
      const currentSum = Number(splitCash || 0) + Number(splitOnline || 0) + Number(splitCredit || 0);
      if (Math.abs(currentSum - combinedNet) > 0.01) {
        const newCash = Math.max(0, combinedNet - Number(splitOnline || 0) - Number(splitCredit || 0));
        setSplitCash(String(newCash));
      }
    }
  }, [combinedNet, isSplit]);

  const handlePaymentModeChange = (val: string) => {
    setF((prev) => ({ ...prev, payment_mode: val }));
    if (val === "split") {
      setIsSplit(true);
      setSplitCash(String(splitTarget));
      setSplitOnline("0");
      setSplitCredit("0");
    } else {
      setIsSplit(false);
    }
  };

  const handleProductChange = (index: number, prodId: string) => {
    const selected = products.find(p => p.id === prodId);
    if (!selected) return;

    setProdRows(prev => prev.map((row, idx) => {
      if (idx !== index) return row;
      const isCnc = selected.name.toLowerCase().includes("cnc");
      return {
        ...row,
        product_id: prodId,
        rate: String(selected.rate),
        commission_rate: isCnc ? "0" : (boy ? String(boy.commission_rate) : "0"),
      };
    }));
  };

  const handleDeliveryBoyChange = (boyId: string) => {
    setF(prev => ({ ...prev, delivery_boy_id: boyId }));
    const selectedBoy = boys.find(b => b.id === boyId);
    if (selectedBoy) {
      setProdRows(prev => prev.map(row => {
        const prod = products.find(p => p.id === row.product_id);
        const isCnc = prod ? prod.name.toLowerCase().includes("cnc") : false;
        return {
          ...row,
          commission_rate: isCnc ? "0" : String(selectedBoy.commission_rate),
        };
      }));
    }
  };

  const handleRowValueChange = (index: number, key: keyof ProductRow, val: string) => {
    setProdRows(prev => prev.map((row, idx) => {
      if (idx !== index) return row;
      return { ...row, [key]: val };
    }));
  };

  const addRow = () => {
    setProdRows(prev => [
      ...prev,
      {
        key: `row-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        product_id: "",
        quantity: "1",
        rate: "",
        commission_rate: boy ? String(boy.commission_rate) : "0",
        prepaid_qty: "0",
      }
    ]);
  };

  const removeRow = (index: number) => {
    setProdRows(prev => prev.filter((_, idx) => idx !== index));
  };

  const distributeSplit = (
    rows: typeof calculatedRows,
    totalCash: number,
    totalOnline: number,
    totalCredit: number,
    totalNet: number
  ) => {
    let cashSum = 0;
    let onlineSum = 0;
    let creditSum = 0;

    return rows.map((r, idx) => {
      if (idx === rows.length - 1) {
        return {
          cash: Number((totalCash - cashSum).toFixed(2)),
          online: Number((totalOnline - onlineSum).toFixed(2)),
          credit: Number((totalCredit - creditSum).toFixed(2)),
        };
      }

      const prop = totalNet > 0 ? (r.netTotal / totalNet) : 0;
      const cashPart = Number((totalCash * prop).toFixed(2));
      const onlinePart = Number((totalOnline * prop).toFixed(2));
      const creditPart = Number((totalCredit * prop).toFixed(2));

      cashSum += cashPart;
      onlineSum += onlinePart;
      creditSum += creditPart;

      return {
        cash: cashPart,
        online: onlinePart,
        credit: creditPart,
      };
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault(); 
    if (!agency || calculatedRows.some(r => !r.product_id)) return; 
    
    if (isSplit && !isSplitValid) {
      toast.error(`Split payment total must equal: ${fmtCurrency(splitTarget)}`);
      return;
    }

    setBusy(true);

    const finalDeliveryBoyId = isFirstCnc ? null : (f.delivery_boy_id || null);
    
    // Shared transaction ID for inserts, or existing transaction ID for edit
    const txnNo = editSale?.txn_no || ("TXN-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7).toUpperCase());

    const splitDetails = distributeSplit(
      calculatedRows,
      isSplit ? Number(splitCash || 0) : (f.payment_mode === "cash" ? combinedNet : 0),
      isSplit ? Number(splitOnline || 0) : (f.payment_mode === "online" || f.payment_mode === "paytm" ? combinedNet : 0),
      isSplit ? Number(splitCredit || 0) : (f.payment_mode === "credit" ? combinedNet : 0),
      combinedNet
    );

    const payloads = calculatedRows.map((r, idx) => {
      const rowSplit = splitDetails[idx];
      const isRowSplit = isSplit;

      const rowPaymentMode = f.payment_mode === "cheque"
        ? "online"
        : (isRowSplit
            ? (rowSplit.credit > 0 ? "credit" : "cash")
            : f.payment_mode);

      const metaDetails: any = {};
      if (isRowSplit) {
        metaDetails.is_split = true;
        metaDetails.cash_amount = rowSplit.cash;
        metaDetails.online_amount = rowSplit.online;
        metaDetails.credit_amount = rowSplit.credit;
      }
      if (f.payment_mode === "cheque") {
        metaDetails.is_cheque = true;
      }
      if (r.prep > 0) {
        metaDetails.website_prepaid_qty = r.prep;
      }
      metaDetails.remarks = f.notes || null;

      return {
        agency_id: agency.id,
        sale_date: f.sale_date,
        customer_id: f.customer_id || null,
        product_id: r.product_id,
        quantity: r.qty,
        rate: r.rateVal,
        gross_amount: r.grossTotal,
        payment_mode: rowPaymentMode,
        delivery_boy_id: finalDeliveryBoyId,
        commission_rate: r.commissionPerUnit,
        commission_amount: r.commissionTotal,
        net_amount: r.netTotal,
        notes: (isRowSplit || r.prep > 0 || f.payment_mode === "cheque") ? JSON.stringify(metaDetails) : (f.notes || null),
        txn_no: txnNo,
        updated_by: session?.user?.id
      };
    });

    try {
      if (editSale) {
        const payload = payloads[0];
        const { error } = await (supabase.from("sales") as any).update(payload).eq("id", editSale.id);
        if (error) throw error;

        // Reconcile ledger entry
        if (payload.customer_id) {
          const meta = JSON.parse(payload.notes || "{}");
          const rowCredit = Number(meta.credit_amount || 0);
          await syncSaleLedger(
            editSale.id,
            payload.customer_id,
            isSplit,
            rowCredit,
            payload.gross_amount,
            editSale.txn_no || null,
            payload.sale_date,
            agency.id,
            payload.payment_mode
          );
        }
        if (editSale.customer_id && editSale.customer_id !== payload.customer_id) {
          await reconcileCustomerOutstanding(editSale.customer_id);
        }

        toast.success("Sale details successfully updated.");
      } else {
        const { data, error } = await (supabase.from("sales") as any).insert(
          payloads.map(p => ({ ...p, created_by: session?.user?.id }))
        ).select("id, customer_id, gross_amount, sale_date, payment_mode, notes, product_id, quantity");
        
        if (error) throw error;

        if (data) {
          for (const s of data) {
            if (s.customer_id) {
              const meta = JSON.parse(s.notes || "{}");
              const rowCredit = Number(meta.credit_amount || 0);
              await syncSaleLedger(
                s.id,
                s.customer_id,
                isSplit,
                rowCredit,
                s.gross_amount,
                null,
                s.sale_date,
                agency.id,
                s.payment_mode
              );
            }
            const prod = products.find(p => p.id === s.product_id);
            recordSaleDeduction(agency.id, s.product_id, prod?.name ?? "Cylinder", s.quantity, s.id, session?.user?.id);
          }
        }

        toast.success(t("sales.saved"));
      }
      onDone();
    } catch (err: any) {
      toast.error(getFriendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 mt-6">
      {/* 1. Date */}
      <div className="space-y-1.5">
        <Label>{t("common.date")}</Label>
        <Input type="date" required value={f.sale_date} onChange={(e) => setF({...f, sale_date: e.target.value})} className="h-11" />
      </div>

      {/* 2. Customer */}
      <div className="space-y-1.5">
        <Label className="mb-1 block">{t("sales.customer")}</Label>
        <Combobox
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
          value={f.customer_id}
          onValueChange={(v) => setF({...f, customer_id: v})}
          placeholder="Search / Select Customer..."
          searchPlaceholder="Type to search..."
          emptyMessage="No customer found."
        />
      </div>

      {/* 3. Delivery Boy (hidden for CNC) */}
      {showDeliveryAndAddBtn && (
        <div className="space-y-1.5">
          <Label>{t("sales.deliveryBoy")}</Label>
          <Select value={f.delivery_boy_id} onValueChange={handleDeliveryBoyChange}>
            <SelectTrigger className="h-11">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {boys.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Product List */}
      <div className="space-y-4">
        {prodRows.map((row, index) => {
          const prod = products.find(p => p.id === row.product_id);
          const isCnc = prod ? prod.name.toLowerCase().includes("cnc") : false;
          
          return (
            <Card key={row.key} className="p-4 border border-slate-100 bg-slate-50/30 rounded-lg relative space-y-3">
              {prodRows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="absolute right-3 top-3 text-red-500 hover:text-red-700 text-xs font-semibold"
                >
                  ✕ Remove
                </button>
              )}
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Product #{index + 1}</h4>
              
              {/* Product Select */}
              <div className="space-y-1.5">
                <Label>Product</Label>
                <Select
                  value={row.product_id}
                  onValueChange={(v) => handleProductChange(index, v)}
                  required
                >
                  <SelectTrigger className="h-11 bg-white">
                    <SelectValue placeholder="Select Product..." />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({fmtCurrency(p.rate)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Qty & Rate */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={row.quantity}
                    onChange={(e) => handleRowValueChange(index, "quantity", e.target.value)}
                    onBlur={(e) => {
                      const val = Math.max(1, Math.round(Number(e.target.value) || 1));
                      handleRowValueChange(index, "quantity", String(val));
                    }}
                    className="h-11 bg-white font-bold text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Rate (₹)</Label>
                  <Input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={row.rate}
                    onChange={(e) => handleRowValueChange(index, "rate", e.target.value)}
                    onBlur={(e) => {
                      const val = Math.max(0, parseFloat(e.target.value) || 0);
                      handleRowValueChange(index, "rate", String(val));
                    }}
                    className="h-11 bg-white font-bold text-sm"
                  />
                </div>
              </div>

              {/* Commission Per Unit (hidden if row is CNC) */}
              {!isCnc && (
                <div className="space-y-1.5">
                  <Label>Commission Per Unit (₹)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={row.commission_rate}
                    onChange={(e) => handleRowValueChange(index, "commission_rate", e.target.value)}
                    onBlur={(e) => {
                      const val = Math.max(0, parseFloat(e.target.value) || 0);
                      handleRowValueChange(index, "commission_rate", String(val));
                    }}
                    className="h-11 bg-white"
                  />
                </div>
              )}

              {/* Online Website Orders */}
              <div className="space-y-1.5">
                <Label>Online Website Orders (Qty Paid Online)</Label>
                <Input
                  type="number"
                  min="0"
                  max={row.quantity}
                  step="1"
                  value={row.prepaid_qty}
                  onChange={(e) => handleRowValueChange(index, "prepaid_qty", e.target.value)}
                  onBlur={(e) => {
                    const qVal = Math.max(1, Math.round(Number(row.quantity) || 1));
                    const val = Math.max(0, Math.min(qVal, Math.round(Number(e.target.value) || 0)));
                    handleRowValueChange(index, "prepaid_qty", String(val));
                  }}
                  className="h-11 bg-white font-bold text-sm"
                  placeholder="Prepaid quantity..."
                />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Add Product Button (only for non-CNC) */}
      {showDeliveryAndAddBtn && !editSale && (
        <Button
          type="button"
          variant="outline"
          onClick={addRow}
          className="w-full h-11 border-dashed border-primary/40 text-primary hover:bg-primary/5 font-semibold"
        >
          <Plus className="h-4 w-4 mr-1.5" /> + Add Product
        </Button>
      )}

      {/* 8. Payment Mode */}
      <div className="space-y-1.5">
        <Label>{t("sales.paymentMode")}</Label>
        <Select value={f.payment_mode} onValueChange={handlePaymentModeChange}>
          <SelectTrigger className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="split">Split Payment (Mix Cash/Online/Udhari)</SelectItem>
            <SelectItem value="cheque">Cheque</SelectItem>
            {f.payment_mode !== "split" && f.payment_mode !== "cheque" && (
              <SelectItem value={f.payment_mode}>{f.payment_mode.toUpperCase()}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Split Payment Breakdown */}
      {isSplit && (
        <Card className="p-4 bg-muted/40 border border-slate-100 space-y-3 rounded-lg">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Split Payment Breakdown</h4>
          
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Cash (₹)</Label>
              <Input type="number" step="any" min="0" value={splitCash} onChange={(e) => setSplitCash(e.target.value)} className="h-10 text-xs font-bold" />
            </div>
            
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Online (₹)</Label>
              <Input type="number" step="any" min="0" value={splitOnline} onChange={(e) => setSplitOnline(e.target.value)} className="h-10 text-xs font-bold" />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Udhari (₹)</Label>
              <Input type="number" step="any" min="0" value={splitCredit} onChange={(e) => setSplitCredit(e.target.value)} className="h-10 text-xs font-bold" />
            </div>
          </div>

          <div className="flex justify-between items-center text-[10px] font-bold mt-1">
            <span className="text-muted-foreground">Sum: {fmtCurrency(splitSum)} / Target: {fmtCurrency(splitTarget)}</span>
            <span className={isSplitValid ? "text-success" : "text-destructive"}>
              {isSplitValid ? "✓ Perfect match" : `✗ Discrepancy: ${fmtCurrency(Math.abs(splitTarget - splitSum))}`}
            </span>
          </div>
        </Card>
      )}

      {/* Notes */}
      <div className="space-y-1.5">
        <Label>{t("common.notes")}</Label>
        <Textarea value={f.notes} onChange={(e) => setF({...f, notes: e.target.value})} placeholder="Optional transaction notes..." />
      </div>

      {/* Summary card — Show Product-wise subtotal & final total */}
      <Card className="bg-primary-soft p-4 space-y-3 border border-primary/20 rounded-lg">
        <h4 className="text-xs font-bold text-primary uppercase tracking-wider border-b border-primary/20 pb-1.5">
          Invoice Breakdown
        </h4>
        <div className="space-y-3 divide-y divide-primary/10">
          {calculatedRows.map((r, idx) => (
            <div key={r.key} className={`text-xs space-y-1.5 ${idx > 0 ? "pt-2.5" : ""}`}>
              <div className="font-bold text-slate-700 flex justify-between">
                <span>{idx + 1}. {r.product_name} ({r.qty} unit{r.qty !== 1 ? "s" : ""})</span>
                {r.prep > 0 && <span className="text-slate-400 font-normal">({r.prep} prepaid)</span>}
              </div>
              <div className="flex justify-between items-center text-slate-500 pl-2">
                <span>Gross Amount ({r.billedQty} × {fmtCurrency(r.rateVal)})</span>
                <span>{fmtCurrency(r.grossTotal)}</span>
              </div>
              {!r.isCnc && f.delivery_boy_id && r.commissionTotal > 0 && (
                <div className="flex justify-between items-center text-destructive-dark/80 pl-2">
                  <span>Delivery Commission ({r.qty} × {fmtCurrency(r.commissionPerUnit)})</span>
                  <span>-{fmtCurrency(r.commissionTotal)}</span>
                </div>
              )}
              <div className="flex justify-between items-center font-semibold text-slate-600 pl-2 pt-0.5">
                <span>Product Subtotal</span>
                <span>{fmtCurrency(r.netTotal)}</span>
              </div>
            </div>
          ))}
        </div>
        
        <div className="border-t border-dashed border-primary/30 my-2 pt-2 flex justify-between items-center text-sm font-bold text-primary">
          <span>FINAL COMBINED TOTAL</span>
          <span className="font-black text-lg">{fmtCurrency(combinedNet)}</span>
        </div>
      </Card>

      <Button type="submit" disabled={busy || (isSplit && !isSplitValid)} className="w-full h-12 font-semibold mt-4">
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {editSale ? "Save Changes" : "Record Invoice"}
      </Button>
    </form>
  );
}
