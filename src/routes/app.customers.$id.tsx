import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, Download, FileText, Trash2, RotateCcw, 
  ShoppingBag, CreditCard, Receipt, HandCoins, Info, Calendar, Clock, User, AlertCircle
} from "lucide-react";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { reconcileCustomerOutstanding, compensateSaleLedger } from "@/lib/accounting";
import { toast } from "sonner";
import { exportToExcel, exportToPDF } from "@/lib/exports";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

interface LedgerItem {
  id: string;
  date: string;
  type: "sale" | "payment";
  description: string;
  debit: number;
  credit: number;
  paymentMode: string;
  balance: number;
  is_deleted: boolean;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  // Sale-specific
  quantity?: number;
  rate?: number;
  commission_amount?: number;
  commission_rate?: number;
  net_amount?: number;
  product_name?: string;
}

export const Route = createFileRoute("/app/customers/$id")({ component: () => <RequireAgencyUser><Page/></RequireAgencyUser> });

function Page() {
  const { id } = Route.useParams();
  const { agency, session } = useAuth();
  
  const [c, setC] = useState<{ 
    name: string; 
    mobile: string | null; 
    village: string | null; 
    consumer_number: string | null; 
    outstanding: number 
  } | null>(null);

  const [sales, setSales] = useState<any[]>([]);
  const [pays, setPays] = useState<any[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState("ledger");
  const [loading, setLoading] = useState(true);

  // Collect payment states
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState<"cash" | "online" | "paytm">("cash");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payRemarks, setPayRemarks] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  // Transaction details modal states
  const [selectedItem, setSelectedItem] = useState<LedgerItem | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const load = async () => {
    if (!agency) return;
    setLoading(true);
    try {
      const [{ data: cust }, { data: s }, { data: p }] = await Promise.all([
        (supabase.from("customers") as any).select("name, mobile, village, consumer_number, outstanding:outstanding_balance").eq("id", id).maybeSingle(),
        (supabase.from("sales") as any).select("id, sale_date, gross_amount, payment_mode, is_deleted, quantity, rate, commission_amount, commission_rate, net_amount, notes, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, product:products(name)").eq("customer_id", id).order("sale_date", { ascending: true }),
        (supabase.from("payments") as any).select("id, payment_date, amount, mode, is_deleted, remarks, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by").eq("customer_id", id).order("payment_date", { ascending: true }),
      ]);

      setC(cust as any); 
      setSales((s ?? []) as any[]); 
      setPays((p ?? []) as any[]);
    } catch (err: any) {
      toast.error("Failed to load customer details: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id, agency]);

  // Compute merged chronological ledger
  const ledger = useMemo<LedgerItem[]>(() => {
    const sItems: LedgerItem[] = sales.map((s) => ({
      id: s.id,
      date: s.sale_date,
      type: "sale",
      description: `${s.product?.name ?? "Cylinder"} (${s.payment_mode})`,
      debit: Number(s.gross_amount),
      credit: s.payment_mode !== "credit" ? Number(s.gross_amount) : 0,
      paymentMode: s.payment_mode,
      is_deleted: s.is_deleted,
      balance: 0,
      notes: s.notes,
      created_at: s.created_at,
      created_by: s.created_by,
      updated_at: s.updated_at,
      updated_by: s.updated_by,
      deleted_at: s.deleted_at,
      deleted_by: s.deleted_by,
      quantity: s.quantity,
      rate: s.rate,
      commission_amount: s.commission_amount,
      commission_rate: s.commission_rate,
      net_amount: s.net_amount,
      product_name: s.product?.name,
    }));

    const pItems: LedgerItem[] = pays.map((p) => ({
      id: p.id,
      date: p.payment_date,
      type: "payment",
      description: `Payment Received (${p.mode})`,
      debit: 0,
      credit: Number(p.amount),
      paymentMode: p.mode,
      is_deleted: p.is_deleted,
      balance: 0,
      notes: p.remarks,
      created_at: p.created_at,
      created_by: p.created_by,
      updated_at: p.updated_at,
      updated_by: p.updated_by,
      deleted_at: p.deleted_at,
      deleted_by: p.deleted_by,
    }));

    // Filter archived unless toggled
    const merged = [...sItems, ...pItems];
    const filtered = showArchived ? merged : merged.filter(item => !item.is_deleted);
    
    // Sort strictly chronological ascending to calculate running balances
    filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    return filtered.map((item) => {
      if (!item.is_deleted) {
        if (item.type === "sale" && item.paymentMode === "credit") {
          runningBalance += item.debit;
        } else if (item.type === "payment") {
          runningBalance -= item.credit;
        }
      }
      return {
        ...item,
        balance: runningBalance,
      };
    }).reverse(); // Display newest on top
  }, [sales, pays, showArchived]);

  const handleCollectPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Please enter a valid payment amount.");
      return;
    }
    if (!agency) return;

    setSavingPayment(true);
    try {
      const { error: payErr } = await supabase.from("payments").insert({
        agency_id: agency.id,
        customer_id: id,
        amount: amt,
        mode: payMode,
        payment_date: payDate,
        remarks: payRemarks || null,
        created_by: session?.user?.id,
        updated_by: session?.user?.id
      });

      if (payErr) throw payErr;

      // Reconcile outstanding
      await reconcileCustomerOutstanding(id);

      toast.success("Payment recorded successfully.");
      setShowPaymentModal(false);
      setPayAmount("");
      setPayRemarks("");
      void load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingPayment(false);
    }
  };

  const restoreTransaction = async (item: LedgerItem) => {
    const targetTable = item.type === "sale" ? "sales" : "payments";
    
    try {
      const { error } = await (supabase.from(targetTable) as any).update({
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        updated_by: session?.user?.id
      }).eq("id", item.id);

      if (error) throw error;

      if (item.type === "sale") {
        await compensateSaleLedger(item.id, Number(item.debit), id);
      } else {
        await reconcileCustomerOutstanding(id);
      }

      toast.success("Transaction restored successfully.");
      void load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const archiveTransaction = async (item: LedgerItem) => {
    const targetTable = item.type === "sale" ? "sales" : "payments";
    
    try {
      const { error } = await (supabase.from(targetTable) as any).update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: session?.user?.id
      }).eq("id", item.id);

      if (error) throw error;

      await reconcileCustomerOutstanding(id);

      toast.success("Transaction voided.");
      void load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const doExport = (kind: "pdf" | "xlsx") => {
    const title = `${c?.name || "Customer"}'s Account Statement`;
    const headers = ["Date", "Type", "Ref No", "Description", "Debit (+)", "Credit (-)", "Running Bal"];
    
    if (kind === "pdf") {
      const data = ledger.map(r => [
        fmtDate(r.date),
        r.type === "sale" ? `${r.paymentMode} sale` : "payment",
        r.id.substring(0, 8).toUpperCase(),
        r.description,
        r.debit > 0 ? fmtCurrency(r.debit) : "—",
        r.credit > 0 ? fmtCurrency(r.credit) : "—",
        fmtCurrency(r.balance)
      ]);
      exportToPDF(title, headers, data, "customer_statement");
    } else {
      const data = ledger.map(r => ({
        Date: fmtDate(r.date),
        Type: r.type === "sale" ? `${r.paymentMode} sale` : "Payment received",
        "Ref No": r.id.substring(0, 8).toUpperCase(),
        Description: r.description,
        "Debit (INR)": r.debit,
        "Credit (INR)": r.credit,
        "Running Balance (INR)": r.balance,
        "Is Voided": r.is_deleted ? "Yes" : "No"
      }));
      exportToExcel(data, "customer_statement", "Account Statement");
    }
  };

  const liveOutstanding = useMemo(() => {
    return ledger.filter(item => !item.is_deleted).reduce((sum, item) => sum + item.debit - item.credit, 0);
  }, [ledger]);

  const hasMismatch = useMemo(() => {
    if (!c) return false;
    const cached = Number((c as any).outstanding || 0);
    return Math.abs(liveOutstanding - cached) > 0.01;
  }, [c, liveOutstanding]);

  const stats = useMemo(() => {
    const activeSales = sales.filter(s => !s.is_deleted);
    const activePayments = pays.filter(p => !p.is_deleted);

    const lifetimeSales = activeSales.reduce((sum, s) => sum + Number(s.gross_amount), 0);
    const lifetimePayments = activePayments.reduce((sum, p) => sum + Number(p.amount), 0);

    const lastSaleDate = activeSales.length > 0 
      ? [...activeSales].sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime())[0].sale_date 
      : null;

    const lastPaymentDate = activePayments.length > 0 
      ? [...activePayments].sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime())[0].payment_date 
      : null;

    return {
      lifetimeSales,
      lifetimePayments,
      lastSaleDate,
      lastPaymentDate
    };
  }, [sales, pays]);

  return (
    <div className="space-y-6 pb-8">
      
      {/* Page Navigation & Actions */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="h-10">
          <Link to="/app/customers">
            <ArrowLeft className="h-4 w-4 mr-1.5" />Back to List
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button 
            asChild
            className="h-10 bg-primary hover:bg-primary-dark text-white font-bold shadow-soft"
          >
            <Link to="/app/sales">
              <ShoppingBag className="h-4 w-4 mr-1.5" />New Sale
            </Link>
          </Button>
          <Button 
            onClick={() => setShowPaymentModal(true)} 
            className="h-10 bg-success hover:bg-success-dark text-white font-bold shadow-soft"
          >
            <HandCoins className="h-4 w-4 mr-1.5" />Receive Payment
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-10">
                <Download className="h-4 w-4 mr-1.5" />Export Statement
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("pdf")}>
                <FileText className="h-4 w-4 mr-2 text-primary" />Export PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx")}>
                <FileText className="h-4 w-4 mr-2 text-success" />Export Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {hasMismatch && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 flex items-start gap-3 text-destructive-dark">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <h4 className="font-bold">⚠️ ERP Ledger Variance Alert</h4>
            <p>This customer's cached Outstanding Balance (<strong>{fmtCurrency(Number((c as any)?.outstanding || 0))}</strong>) has a discrepancy with the chronological Ledger (<strong>{fmtCurrency(liveOutstanding)}</strong>). The statement below is authoritative. Please execute a reconciliation or adjust manually.</p>
          </div>
        </div>
      )}

      {/* Customer Info Card */}
      <Card className="shadow-soft border-slate-100 bg-surface/90 backdrop-blur-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-primary" />
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{c?.name ?? "—"}</h1>
                {c?.village && (
                  <span className="text-[10px] bg-primary-soft text-primary font-bold px-2 py-0.5 rounded-full uppercase">
                    {c.village}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground font-medium">
                <div>Mobile: <span className="text-foreground font-semibold">{c?.mobile ?? "—"}</span></div>
                <div>Consumer No: <span className="text-foreground font-semibold">{c?.consumer_number ?? "—"}</span></div>
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="flex items-center gap-1.5 justify-end">
                {hasMismatch && (
                  <span title={`Cache: ${fmtCurrency(Number((c as any)?.outstanding || 0))} vs Ledger: ${fmtCurrency(liveOutstanding)}`} className="cursor-help flex items-center bg-destructive/15 text-destructive text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-destructive/25 gap-0.5 animate-pulse">
                    <AlertCircle className="h-2.5 w-2.5" /> Variance
                  </span>
                )}
                <div className={`text-3xl font-extrabold ${liveOutstanding > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  {fmtCurrency(liveOutstanding)}
                </div>
              </div>
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider font-bold">Outstanding Dues Balance</div>
            </div>
          </div>

          {/* Detailed Lifetime Stats & Last Transaction Dates Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 border-t border-slate-100 pt-4 text-xs">
            <div className="bg-slate-50/50 p-3 rounded-lg border">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Last Sale Date</span>
              <div className="font-semibold text-foreground mt-1">{stats.lastSaleDate ? fmtDate(stats.lastSaleDate) : "No Sales Recorded"}</div>
            </div>
            <div className="bg-slate-50/50 p-3 rounded-lg border">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Last Payment Date</span>
              <div className="font-semibold text-foreground mt-1">{stats.lastPaymentDate ? fmtDate(stats.lastPaymentDate) : "No Payments Recorded"}</div>
            </div>
            <div className="bg-slate-50/50 p-3 rounded-lg border">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Lifetime Sales</span>
              <div className="font-bold text-foreground mt-1">{fmtCurrency(stats.lifetimeSales)}</div>
            </div>
            <div className="bg-slate-50/50 p-3 rounded-lg border">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Lifetime Payments</span>
              <div className="font-bold text-success mt-1">{fmtCurrency(stats.lifetimePayments)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tab Select & Switch Panel */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-2">
          <div className="flex gap-1.5 bg-muted/65 p-1 rounded-xl">
            <Button 
              variant={tab === "ledger" ? "default" : "ghost"} 
              size="sm" 
              onClick={() => setTab("ledger")} 
              className={`h-9 rounded-lg px-4 font-semibold ${tab === "ledger" ? "shadow-soft" : "text-muted-foreground"}`}
            >
              <Receipt className="h-4 w-4 mr-1.5" /> Statement
            </Button>
            <Button 
              variant={tab === "purchases" ? "default" : "ghost"} 
              size="sm" 
              onClick={() => setTab("purchases")} 
              className={`h-9 rounded-lg px-4 font-semibold ${tab === "purchases" ? "shadow-soft" : "text-muted-foreground"}`}
            >
              <ShoppingBag className="h-4 w-4 mr-1.5" /> Sales History
            </Button>
            <Button 
              variant={tab === "payments" ? "default" : "ghost"} 
              size="sm" 
              onClick={() => setTab("payments")} 
              className={`h-9 rounded-lg px-4 font-semibold ${tab === "payments" ? "shadow-soft" : "text-muted-foreground"}`}
            >
              <CreditCard className="h-4 w-4 mr-1.5" /> Payments
            </Button>
          </div>
          
          <div className="flex items-center space-x-2 select-none">
            <Switch id="archived-ledger" checked={showArchived} onCheckedChange={setShowArchived} />
            <Label htmlFor="archived-ledger" className="text-xs font-semibold text-muted-foreground cursor-pointer">
              Show Voided Transactions
            </Label>
          </div>
        </div>

        {/* Ledger Statement view */}
        {tab === "ledger" && (
          <Card className="shadow-soft overflow-hidden">
            <CardContent className="p-0">
              {loading ? (
                <div className="p-12 text-center text-xs text-muted-foreground animate-pulse">Loading transaction statements...</div>
              ) : ledger.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
                  <Receipt className="h-10 w-10 text-muted-foreground/45" />
                  <p>No ledger transactions found for this customer.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100 select-none">
                      <tr>
                        <th className="text-left px-5 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider w-32">Date</th>
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider w-24">Ref No</th>
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Description</th>
                        <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider w-28">Debit (+)</th>
                        <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider w-28">Credit (-)</th>
                        <th className="text-right px-5 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider w-32">Running Balance</th>
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider w-24">Cashier</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider w-20">Actions</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-border/60">
                      {ledger.map((r) => (
                        <tr 
                          key={r.id} 
                          onClick={() => {
                            setSelectedItem(r);
                            setShowDetailsModal(true);
                          }}
                          className={`hover:bg-accent/15 transition-colors cursor-pointer ${r.is_deleted ? "bg-slate-50/50 text-muted-foreground" : ""}`}
                        >
                          <td className="px-5 py-3.5 whitespace-nowrap text-xs font-semibold text-muted-foreground">
                            {fmtDate(r.date)}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap text-xs font-mono font-bold uppercase text-muted-foreground">
                            {r.id.substring(0, 8)}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className={`font-bold ${r.is_deleted ? "text-muted-foreground line-through" : "text-foreground"}`}>
                              {r.description}
                            </div>
                            {r.notes && (
                              <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-xs">{r.notes}</div>
                            )}
                            {r.is_deleted && (
                              <span className="inline-block text-[8px] tracking-wider uppercase font-extrabold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive mt-1">
                                Voided
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right font-bold text-destructive">
                            {r.debit > 0 ? fmtCurrency(r.debit) : "—"}
                          </td>
                          <td className="px-4 py-3.5 text-right font-bold text-success">
                            {r.credit > 0 ? fmtCurrency(r.credit) : "—"}
                          </td>
                          <td className="px-5 py-3.5 text-right font-black text-foreground">
                            {r.is_deleted ? "—" : fmtCurrency(r.balance)}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap text-xs font-mono font-semibold text-muted-foreground">
                            {r.created_by ? `UID:${r.created_by.substring(0, 5)}` : "System"}
                          </td>
                          <td className="px-4 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                            {r.is_deleted ? (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => restoreTransaction(r)} 
                                className="h-8 px-2 text-success hover:bg-success/10 font-bold text-xs"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => archiveTransaction(r)} 
                                className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>

                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Purchase History */}
        {tab === "purchases" && (
          <Card className="shadow-soft overflow-hidden">
            <CardContent className="p-0">
              {loading ? (
                <div className="p-12 text-center text-xs text-muted-foreground animate-pulse">Loading sales history...</div>
              ) : sales.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
                  <ShoppingBag className="h-10 w-10 text-muted-foreground/45" />
                  <p>No purchase records found.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {sales.filter(s => showArchived || !s.is_deleted).map((s) => (
                    <div 
                      key={s.id} 
                      onClick={() => {
                        const item: LedgerItem = {
                          id: s.id,
                          date: s.sale_date,
                          type: "sale",
                          description: `${s.product?.name ?? "Cylinder"} (${s.payment_mode})`,
                          debit: Number(s.gross_amount),
                          credit: s.payment_mode !== "credit" ? Number(s.gross_amount) : 0,
                          paymentMode: s.payment_mode,
                          is_deleted: s.is_deleted,
                          balance: 0,
                          notes: s.notes,
                          created_at: s.created_at,
                          created_by: s.created_by,
                          updated_at: s.updated_at,
                          updated_by: s.updated_by,
                          deleted_at: s.deleted_at,
                          deleted_by: s.deleted_by,
                          quantity: s.quantity,
                          rate: s.rate,
                          commission_amount: s.commission_amount,
                          commission_rate: s.commission_rate,
                          net_amount: s.net_amount,
                          product_name: s.product?.name,
                        };
                        setSelectedItem(item);
                        setShowDetailsModal(true);
                      }}
                      className={`p-4 flex items-center justify-between hover:bg-muted/15 transition-colors cursor-pointer ${s.is_deleted ? "bg-slate-50/50 text-muted-foreground" : ""}`}
                    >
                      <div>
                        <div className="font-bold text-foreground flex items-center gap-2">
                          {s.product?.name ?? "Refill cylinder"}
                          {s.is_deleted && <span className="text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">Voided</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Date: <span className="font-semibold text-foreground">{fmtDate(s.sale_date)}</span> · 
                          Qty: <span className="font-semibold text-foreground">{s.quantity}</span> · 
                          Payment: <span className="font-semibold text-foreground uppercase">{s.payment_mode}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-foreground">{fmtCurrency(s.gross_amount)}</div>
                        <div className="text-[9px] text-muted-foreground uppercase font-bold">Gross Invoice</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Payments history */}
        {tab === "payments" && (
          <Card className="shadow-soft overflow-hidden">
            <CardContent className="p-0">
              {loading ? (
                <div className="p-12 text-center text-xs text-muted-foreground animate-pulse">Loading payments received...</div>
              ) : pays.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
                  <CreditCard className="h-10 w-10 text-muted-foreground/45" />
                  <p>No payments recorded yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {pays.filter(p => showArchived || !p.is_deleted).map((p) => (
                    <div 
                      key={p.id} 
                      onClick={() => {
                        const item: LedgerItem = {
                          id: p.id,
                          date: p.payment_date,
                          type: "payment",
                          description: `Payment Received (${p.mode})`,
                          debit: 0,
                          credit: Number(p.amount),
                          paymentMode: p.mode,
                          is_deleted: p.is_deleted,
                          balance: 0,
                          notes: p.remarks,
                          created_at: p.created_at,
                          created_by: p.created_by,
                          updated_at: p.updated_at,
                          updated_by: p.updated_by,
                          deleted_at: p.deleted_at,
                          deleted_by: p.deleted_by,
                        };
                        setSelectedItem(item);
                        setShowDetailsModal(true);
                      }}
                      className={`p-4 flex items-center justify-between hover:bg-muted/15 transition-colors cursor-pointer ${p.is_deleted ? "bg-slate-50/50 text-muted-foreground" : ""}`}
                    >
                      <div>
                        <div className="font-bold text-foreground flex items-center gap-2">
                          Collection Received
                          {p.is_deleted && <span className="text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">Voided</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Date: <span className="font-semibold text-foreground">{fmtDate(p.payment_date)}</span> · 
                          Mode: <span className="font-semibold text-foreground uppercase">{p.mode}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-success">{fmtCurrency(p.amount)}</div>
                        <div className="text-[9px] text-muted-foreground uppercase font-bold">Amount Paid</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Collect Payment Dialog (Modal) */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="max-w-md bg-surface/95 border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-success" /> Receive Ledger Payment
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Collect and record a physical outstanding dues payment from <span className="font-semibold text-foreground">{c?.name}</span>.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCollectPayment} className="space-y-4 mt-4">
            
            {/* Amount input */}
            <div className="space-y-1.5">
              <Label htmlFor="pay-amt" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Amount Collected (INR)</Label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₹</span>
                <Input 
                  id="pay-amt"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="pl-7 font-bold text-lg focus:border-success focus:ring-success"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Payment Mode */}
              <div className="space-y-1.5">
                <Label htmlFor="pay-mode" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Mode</Label>
                <Select value={payMode} onValueChange={(val: any) => setPayMode(val)}>
                  <SelectTrigger id="pay-mode">
                    <SelectValue placeholder="Mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">💵 Cash (Drawer)</SelectItem>
                    <SelectItem value="online">🏦 Bank Transfer</SelectItem>
                    <SelectItem value="paytm">📱 Paytm Wallet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <Label htmlFor="pay-date" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Payment Date</Label>
                <Input 
                  id="pay-date"
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Remarks */}
            <div className="space-y-1.5">
              <Label htmlFor="pay-rem" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Notes / Remarks</Label>
              <Textarea 
                id="pay-rem"
                placeholder="Enter transaction receipt number, check no, or details..."
                value={payRemarks}
                onChange={(e) => setPayRemarks(e.target.value)}
                className="resize-none h-16"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setShowPaymentModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingPayment} className="bg-success hover:bg-success-dark text-white font-bold">
                {savingPayment ? "Recording..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Transaction Details & Audit Trail Dialog */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="max-w-lg bg-surface/95 border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" /> Transaction Details
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Ref ID: <span className="font-mono font-semibold text-foreground uppercase">{selectedItem?.id}</span>
            </DialogDescription>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-5 mt-4">
              
              {/* Primary metrics panel */}
              <div className="grid grid-cols-2 gap-4 bg-muted/40 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Type</span>
                  <div className="font-bold text-sm text-foreground mt-0.5">
                    {selectedItem.type === "sale" ? "📄 Sales Invoice" : "💵 Cash Payment"}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Status</span>
                  <div className="mt-0.5">
                    {selectedItem.is_deleted ? (
                      <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">Voided / Deleted</span>
                    ) : (
                      <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded bg-success/15 text-success border border-success/20">Active Log</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Data fields */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b pb-1 select-none">Transaction Breakdown</h4>
                
                <div className="grid grid-cols-2 gap-y-3 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                    <span>Transaction Date</span>
                  </div>
                  <div className="font-semibold text-foreground text-right">{fmtDate(selectedItem.date)}</div>

                  {selectedItem.type === "sale" ? (
                    <>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                        <span>Product cylinder</span>
                      </div>
                      <div className="font-bold text-foreground text-right">{selectedItem.product_name ?? "—"}</div>

                      <div className="text-muted-foreground">Quantity & Rate</div>
                      <div className="font-semibold text-foreground text-right">
                        {selectedItem.quantity} unit(s) @ {fmtCurrency(selectedItem.rate ?? 0)}
                      </div>

                      <div className="text-muted-foreground">Gross Invoice Total</div>
                      <div className="font-black text-destructive text-right">{fmtCurrency(selectedItem.debit)}</div>

                      <div className="text-muted-foreground">Commission kept (Boy)</div>
                      <div className="font-semibold text-foreground text-right">{fmtCurrency(selectedItem.commission_amount ?? 0)}</div>

                      <div className="text-muted-foreground">Net cash collection</div>
                      <div className="font-black text-success text-right">{fmtCurrency(selectedItem.net_amount ?? 0)}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-muted-foreground">Amount collected</div>
                      <div className="font-black text-success text-right">{fmtCurrency(selectedItem.credit)}</div>
                    </>
                  )}

                  <div className="text-muted-foreground">Payment Mode</div>
                  <div className="font-bold text-foreground uppercase text-right">{selectedItem.paymentMode}</div>

                  <div className="text-muted-foreground">Remarks / Description</div>
                  <div className="font-medium text-foreground text-right italic truncate max-w-xs">{selectedItem.notes ?? "—"}</div>
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
                      {selectedItem.created_by ? `UID: ${selectedItem.created_by.substring(0, 8)}` : "System / Seeder"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span>Created Timestamp</span>
                    <span className="font-semibold text-foreground">
                      {new Date(selectedItem.created_at).toLocaleString()}
                    </span>
                  </div>

                  {selectedItem.updated_by && (
                    <div className="flex justify-between items-center border-t pt-1.5 mt-1.5">
                      <span className="flex items-center gap-1"><User className="h-3 w-3" /> Last Updated By</span>
                      <span className="font-mono text-[10px] text-foreground font-semibold bg-white border px-1.5 py-0.5 rounded">
                        UID: {selectedItem.updated_by.substring(0, 8)}
                      </span>
                    </div>
                  )}

                  {selectedItem.updated_at && selectedItem.updated_by && (
                    <div className="flex justify-between items-center">
                      <span>Last Updated Timestamp</span>
                      <span className="font-semibold text-foreground">
                        {new Date(selectedItem.updated_at).toLocaleString()}
                      </span>
                    </div>
                  )}

                  {selectedItem.is_deleted && (
                    <div className="space-y-1.5 border-t border-destructive/25 pt-1.5 mt-1.5 bg-destructive/5 -mx-4 -mb-4 p-4 rounded-b-xl text-destructive-dark">
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1"><User className="h-3 w-3" /> Voided/Deleted By</span>
                        <span className="font-mono text-[10px] text-destructive-dark font-black bg-white border border-destructive/25 px-1.5 py-0.5 rounded">
                          UID: {selectedItem.deleted_by?.substring(0, 8)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Voided Timestamp</span>
                        <span className="font-extrabold text-destructive-dark">
                          {selectedItem.deleted_at ? new Date(selectedItem.deleted_at).toLocaleString() : "—"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                {selectedItem.is_deleted ? (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      void restoreTransaction(selectedItem);
                      setShowDetailsModal(false);
                    }}
                    className="border-success/30 hover:bg-success/5 text-success font-bold"
                  >
                    <RotateCcw className="h-4 w-4 mr-1.5" /> Restore Transaction
                  </Button>
                ) : (
                  <Button 
                    variant="destructive"
                    onClick={() => {
                      if (confirm("Are you sure you want to void this transaction?")) {
                        void archiveTransaction(selectedItem);
                        setShowDetailsModal(false);
                      }
                    }}
                    className="font-bold"
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" /> Void / Cancel Transaction
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setShowDetailsModal(false)}>Close</Button>
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
