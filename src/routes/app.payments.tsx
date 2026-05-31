import { createFileRoute } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Plus, Download, FileText, Search, Filter, Calendar, Archive, RotateCcw, Edit, Printer, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fmtCurrency, fmtDate, todayISO } from "@/lib/format";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { exportToExcel, exportToPDF } from "@/lib/exports";
import { reconcileCustomerOutstanding } from "@/lib/accounting";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/app/payments")({ component: () => <RequireAgencyUser><Page/></RequireAgencyUser> });

interface PaymentRow {
  id: string;
  payment_date: string;
  amount: number;
  payment_mode: string;
  customer_id: string;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  customer: { name: string } | null;
}

function Page() {
  const { t } = useTranslation();
  const { agency, session } = useAuth();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; outstanding: number }>>([]);
  const [open, setOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentRow | null>(null);
  const [receiptPayment, setReceiptPayment] = useState<PaymentRow | null>(null);
  
  // Advanced filters state
  const [q, setQ] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  
  const load = async () => {
    if (!agency) return;
    
    // Fetch customers
    const { data: cData } = await (supabase
      .from("customers") as any)
      .select("id, name, outstanding:outstanding_balance")
      .eq("agency_id", agency.id)
      .eq("is_deleted", false)
      .order("name");
    setCustomers(cData ?? []);

    // Fetch payments
    let query = (supabase
      .from("payments") as any)
      .select("*, customer:customers(name), payment_mode:mode, notes:remarks")
      .eq("agency_id", agency.id);
      
    if (!showArchived) {
      query = query.eq("is_deleted", false);
    }
    
    const { data, error } = await query.order("payment_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
    } else {
      setRows((data ?? []) as unknown as PaymentRow[]);
    }
  };

  useEffect(() => {
    void load();
  }, [agency, showArchived]);

  // Dynamic filter memo
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const cName = r.customer?.name ?? "";
      const matchesSearch = !q.trim() || cName.toLowerCase().includes(q.toLowerCase());
      
      const matchesStart = !startDate || r.payment_date >= startDate;
      const matchesEnd = !endDate || r.payment_date <= endDate;
      
      const matchesMode = filterMode === "all" || r.payment_mode === filterMode;
      
      return matchesSearch && matchesStart && matchesEnd && matchesMode;
    });
  }, [rows, q, startDate, endDate, filterMode]);

  const voidPayment = async (id: string) => {
    if (!confirm("Are you sure you want to void/cancel this payment? The customer outstanding balance will automatically adjust back.")) return;
    
    const targetPayment = rows.find(r => r.id === id);
    const { error } = await (supabase
      .from("payments") as any)
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: session?.user?.id
      })
      .eq("id", id);

    if (error) {
      toast.error(error.message);
    } else {
      if (targetPayment?.customer_id) {
        await reconcileCustomerOutstanding(targetPayment.customer_id);
      }
      toast.success("Payment transaction voided successfully.");
      void load();
    }
  };

  const restorePayment = async (id: string) => {
    const targetPayment = rows.find(r => r.id === id);
    const { error } = await (supabase
      .from("payments") as any)
      .update({
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        updated_by: session?.user?.id
      })
      .eq("id", id);

    if (error) {
      toast.error(error.message);
    } else {
      if (targetPayment?.customer_id) {
        await reconcileCustomerOutstanding(targetPayment.customer_id);
      }
      toast.success("Payment transaction restored successfully.");
      void load();
    }
  };

  const doExport = (kind: "pdf" | "xlsx") => {
    if (kind === "pdf") {
      const cols = ["Receipt ID", "Date", "Customer", "Payment Mode", "Amount Received"];
      const data = filtered.map((r) => [
        r.id.substring(0, 8).toUpperCase(),
        fmtDate(r.payment_date),
        r.customer?.name ?? "—",
        r.payment_mode.toUpperCase(),
        fmtCurrency(r.amount)
      ]);
      exportToPDF("Payment History Ledger", cols, data, "payments_ledger");
    } else {
      const data = filtered.map((r) => ({
        "Receipt ID": r.id.substring(0, 8).toUpperCase(),
        Date: fmtDate(r.payment_date),
        Customer: r.customer?.name ?? "—",
        "Payment Mode": r.payment_mode.toUpperCase(),
        "Amount Received (INR)": Number(r.amount),
        "Is Voided": r.is_deleted ? "Yes" : "No"
      }));
      exportToExcel(data, "payments_ledger", "Payments Ledger");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("payments.title")} actions={
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11">
                <Download className="h-4.5 w-4.5 mr-1.5" />{t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("pdf")}><FileText className="h-4 w-4 mr-2" />PDF History Log</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx")}><FileText className="h-4 w-4 mr-2" />Excel Sheet</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Sheet open={open || !!editPayment} onOpenChange={(v) => { if (!v) { setOpen(false); setEditPayment(null); } }}>
            <SheetTrigger asChild>
              <Button onClick={() => setOpen(true)} className="h-11">
                <Plus className="h-4.5 w-4.5 mr-1.5" />{t("dashboard.receivePayment")}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{editPayment ? "Edit Payment Details" : "Receive Customer Payment"}</SheetTitle>
              </SheetHeader>
              <PaymentForm 
                editPayment={editPayment} 
                customers={customers}
                onDone={() => { setOpen(false); setEditPayment(null); void load(); }} 
              />
            </SheetContent>
          </Sheet>
        </div>
      } />

      {/* Advanced Filters Panel */}
      <Card className="shadow-soft"><CardContent className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Search Customer</Label>
            <div className="relative">
              <Input 
                placeholder="Type customer name..." 
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
          <div className="flex items-center gap-2">
            <Switch id="archived" checked={showArchived} onCheckedChange={setShowArchived} />
            <Label htmlFor="archived" className="text-xs font-medium cursor-pointer">Show Archived / Voided Payments</Label>
          </div>
          <div className="text-xs text-muted-foreground">
            Showing <strong className="text-foreground">{filtered.length}</strong> entries
          </div>
        </div>
      </CardContent></Card>

      {/* Payment History Register */}
      <Card className="shadow-soft overflow-hidden"><CardContent className="p-0">
        {filtered.length === 0 ? <EmptyState title={t("common.noData")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-muted/50 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="p-4">Receipt ID</th>
                  <th className="p-4">{t("common.date")}</th>
                  <th className="p-4">{t("sales.customer")}</th>
                  <th className="p-4">{t("sales.paymentMode")}</th>
                  <th className="p-4 text-right">{t("payments.amount")}</th>
                  <th className="p-4 text-center">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => (
                  <tr key={r.id} className={`hover:bg-muted/30 transition-colors ${r.is_deleted ? "bg-destructive/5 text-muted-foreground line-through" : ""}`}>
                    <td className="p-4 font-mono text-xs">#{r.id.substring(0, 8).toUpperCase()}</td>
                    <td className="p-4 font-medium whitespace-nowrap">{fmtDate(r.payment_date)}</td>
                    <td className="p-4 font-semibold">{r.customer?.name ?? "—"}</td>
                    <td className="p-4 uppercase text-xs font-bold tracking-wider">{r.payment_mode}</td>
                    <td className="p-4 text-right font-bold text-success-dark whitespace-nowrap">
                      {r.is_deleted ? "-" : ""}{fmtCurrency(r.amount)}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => setReceiptPayment(r)} 
                          title="Print Receipt"
                          className="h-8 w-8 hover:text-primary"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>

                        {!r.is_deleted ? (
                          <>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => setEditPayment(r)}
                              title="Edit"
                              className="h-8 w-8 hover:text-primary"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => voidPayment(r.id)}
                              title="Void Payment"
                              className="h-8 w-8 hover:text-destructive text-destructive/70"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => restorePayment(r.id)}
                            title="Restore"
                            className="h-8 w-8 text-primary"
                          >
                            <RotateCcw className="h-4 w-4" />
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

      {/* Print Receipt Dialog */}
      <Dialog open={!!receiptPayment} onOpenChange={(v) => { if (!v) setReceiptPayment(null); }}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <DialogTitle>Payment Receipt</DialogTitle>
          </DialogHeader>
          {receiptPayment && (
            <div className="space-y-6 pt-4" id="printable-receipt">
              <div className="text-center border-b pb-4 space-y-1">
                <h2 className="text-2xl font-bold text-primary tracking-wide">GASFLOW AGENCY</h2>
                <p className="text-xs text-muted-foreground">Official Payment Acknowledgment</p>
                <p className="text-xs font-mono">Receipt No: #{receiptPayment.id.substring(0, 10).toUpperCase()}</p>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Receipt Date:</span>
                  <span className="font-semibold">{fmtDate(receiptPayment.payment_date)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Customer Name:</span>
                  <span className="font-semibold">{receiptPayment.customer?.name ?? "—"}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Payment Method:</span>
                  <span className="font-semibold uppercase tracking-wider">{receiptPayment.payment_mode}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <span className={`font-bold text-xs uppercase tracking-wider px-2 py-0.5 rounded-full ${receiptPayment.is_deleted ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                    {receiptPayment.is_deleted ? "Voided / Cancelled" : "Cleared / Approved"}
                  </span>
                </div>

                <div className="bg-muted p-4 rounded-lg flex justify-between items-center mt-4 border border-dashed">
                  <span className="text-sm font-semibold uppercase">Total Paid</span>
                  <span className="text-xl font-bold text-success-dark">{fmtCurrency(receiptPayment.amount)}</span>
                </div>
              </div>

              <div className="border-t pt-4 text-center text-xs text-muted-foreground space-y-1">
                <p>Thank you for your business!</p>
                <p>For support, please contact your authorized LPG distributor.</p>
              </div>

              <div className="flex gap-2 justify-end no-print">
                <Button variant="outline" onClick={() => setReceiptPayment(null)}>Close</Button>
                <Button onClick={() => window.print()} className="gap-2">
                  <Printer className="h-4 w-4" /> Print Receipt
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Payment Form Sheet Component
interface PaymentFormProps {
  editPayment: PaymentRow | null;
  customers: Array<{ id: string; name: string; outstanding: number }>;
  onDone: () => void;
}

function PaymentForm({ editPayment, customers, onDone }: PaymentFormProps) {
  const { t } = useTranslation();
  const { agency, session } = useAuth();
  const [customer_id, setCustomerId] = useState(editPayment?.customer_id ?? "");
  const [amount, setAmount] = useState(editPayment?.amount ? String(editPayment.amount) : "");
  const [payment_mode, setPaymentMode] = useState(editPayment?.payment_mode ?? "cash");
  const [payment_date, setPaymentDate] = useState(editPayment?.payment_date ?? todayISO());
  const [busy, setBusy] = useState(false);

  const selectedCustomer = customers.find((c) => c.id === customer_id);

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

    if (editPayment) {
      // Perform Edit
      const { error } = await (supabase
        .from("payments") as any)
        .update({
          customer_id,
          amount: val,
          mode: payment_mode,
          payment_date,
          updated_by: session?.user?.id
        })
        .eq("id", editPayment.id);

      if (error) {
        toast.error(error.message);
      } else {
        await reconcileCustomerOutstanding(customer_id);
        if (editPayment.customer_id && editPayment.customer_id !== customer_id) {
          await reconcileCustomerOutstanding(editPayment.customer_id);
        }
        toast.success("Payment transaction updated successfully.");
        onDone();
      }
    } else {
      // Perform Fresh Create
      const { error } = await (supabase
        .from("payments") as any)
        .insert({
          agency_id: agency.id,
          customer_id,
          amount: val,
          mode: payment_mode,
          payment_date,
          updated_by: session?.user?.id
        });

      if (error) {
        toast.error(error.message);
      } else {
        await reconcileCustomerOutstanding(customer_id);
        toast.success("Payment recorded successfully.");
        onDone();
      }
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4 pt-4">
      <div className="space-y-1.5">
        <Label>{t("sales.customer")}</Label>
        <Combobox
          options={customers.map((c) => ({
            value: c.id,
            label: c.name,
            sublabel: `Outstanding: ${fmtCurrency(c.outstanding)}`,
          }))}
          value={customer_id}
          onValueChange={setCustomerId}
          placeholder="Search / Select Customer..."
          searchPlaceholder="Type to search..."
          emptyMessage="No customer found."
        />
        {selectedCustomer && (
          <p className="text-xs text-muted-foreground">
            Current Outstanding Balance: <strong className="text-foreground">{fmtCurrency(selectedCustomer.outstanding)}</strong>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("payments.amount")}</Label>
          <Input 
            type="number" 
            step="0.01"
            required 
            value={amount} 
            onChange={(e) => setAmount(e.target.value)} 
            placeholder="0.00"
            className="h-11 mt-1" 
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("common.date")}</Label>
          <Input 
            type="date" 
            required 
            value={payment_date} 
            onChange={(e) => setPaymentDate(e.target.value)} 
            className="h-11 mt-1 text-sm" 
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t("sales.paymentMode")}</Label>
        <Select value={payment_mode} onValueChange={setPaymentMode}>
          <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">{t("sales.cash")}</SelectItem>
            <SelectItem value="online">{t("sales.online")}</SelectItem>
            <SelectItem value="paytm">{t("sales.paytm")}</SelectItem>
          </SelectContent>
        </Select>
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
