import { createFileRoute } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, EmptyState } from "@/components/page-header";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fmtCurrency, fmtDate, todayISO } from "@/lib/format";
import { ArrowUpRight, ArrowDownRight, Printer, Download, FileText, Sparkles } from "lucide-react";
import { exportToExcel, exportToPDF } from "@/lib/exports";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/app/cashbook")({ component: () => <RequireAgencyUser><Page/></RequireAgencyUser> });

interface CashSaleItem {
  id: string;
  customer_name: string | null;
  product_name: string;
  quantity: number;
  total: number;
  payment_mode: string;
  commission_total: number;
  notes: string | null;
}

interface CashPaymentItem {
  id: string;
  customer_name: string;
  amount: number;
  payment_mode: string;
}

interface CashExpenseItem {
  id: string;
  category: string;
  amount: number;
  notes: string | null;
}

interface CommissionItem {
  id: string;
  boy_name: string;
  quantity: number;
  commission_total: number;
}

function Page() {
  const { t } = useTranslation();
  const { agency } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [opening, setOpening] = useState("0");
  const [actual, setActual] = useState("");
  const [otherReceipts, setOtherReceipts] = useState("0");
  const [busy, setBusy] = useState(false);

  // Daily records list for Money Received / Money Paid sections
  const [dailySales, setDailySales] = useState<CashSaleItem[]>([]);
  const [dailyPayments, setDailyPayments] = useState<CashPaymentItem[]>([]);
  const [dailyExpenses, setDailyExpenses] = useState<CashExpenseItem[]>([]);
  
  const load = async () => {
    if (!agency) return;

    // 1. Fetch cash book record for today
    const { data: bookData } = await supabase
      .from("cash_book_days")
      .select("opening_cash, actual_closing, notes")
      .eq("agency_id", agency.id)
      .eq("book_date", date)
      .maybeSingle();

    if (bookData) {
      setOpening(String(bookData.opening_cash ?? 0));
      setActual(bookData.actual_closing != null ? String(bookData.actual_closing) : "");
      
      let parsedOther = "0";
      if (bookData.notes) {
        try {
          const meta = JSON.parse(bookData.notes);
          if (meta && typeof meta === "object" && meta.other_cash_receipts != null) {
            parsedOther = String(meta.other_cash_receipts);
          }
        } catch (e) {
          // ignore parsing error
        }
      }
      setOtherReceipts(parsedOther);
    } else {
      // If no book exists for today, fetch yesterday's actual closing cash as opening cash fallback
      const yesterday = new Date(new Date(date).getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const { data: prevBook } = await supabase
        .from("cash_book_days")
        .select("actual_closing")
        .eq("agency_id", agency.id)
        .eq("book_date", yesterday)
        .maybeSingle();
      
      setOpening(prevBook?.actual_closing != null ? String(prevBook.actual_closing) : "0");
      setActual("");
      setOtherReceipts("0");
    }

    // 2. Fetch daily sales (non-deleted only)
    const { data: sData } = await supabase
      .from("sales")
      .select("id, sale_date, quantity, gross_amount, commission_amount, payment_mode, notes, customer:customers(name), product:products(name)")
      .eq("agency_id", agency.id)
      .eq("sale_date", date)
      .eq("is_deleted", false);
    
    const formattedSales = ((sData ?? []) as any[]).map((s) => ({
      id: s.id,
      customer_name: s.customer?.name ?? "—",
      product_name: s.product?.name ?? "—",
      quantity: Number(s.quantity),
      total: Number(s.gross_amount),
      payment_mode: s.payment_mode,
      commission_total: Number(s.commission_amount || 0),
      notes: s.notes
    }));
    setDailySales(formattedSales);

    // 3. Fetch daily payment collections (non-deleted only)
    const { data: pData } = await (supabase
      .from("payments") as any)
      .select("id, amount, mode, customer:customers(name)")
      .eq("agency_id", agency.id)
      .eq("payment_date", date)
      .eq("is_deleted", false);
    
    const formattedPayments = ((pData ?? []) as any[]).map((p: any) => ({
      id: p.id,
      customer_name: p.customer?.name ?? "—",
      amount: Number(p.amount),
      payment_mode: p.mode
    }));
    setDailyPayments(formattedPayments);

    // 4. Fetch daily overhead expenses (non-deleted only)
    const { data: eData } = await (supabase
      .from("expenses") as any)
      .select("id, category, amount, notes")
      .eq("agency_id", agency.id)
      .eq("expense_date", date)
      .eq("is_deleted", false);
    setDailyExpenses((eData ?? []) as unknown as CashExpenseItem[]);
  };

  useEffect(() => {
    void load();
  }, [agency, date]);

  // Aggregate values
  const aggregates = useMemo(() => {
    // Extract the cash portion and net cash for each sale (handling split payments)
    const salesWithCash = dailySales.map((s) => {
      let isSplitSale = false;
      let cashAmt = 0;
      if (s.notes) {
        try {
          const meta = JSON.parse(s.notes);
          if (meta && typeof meta === "object" && meta.is_split) {
            isSplitSale = true;
            cashAmt = Number(meta.cash_amount || 0) + Number(meta.online_amount || 0);
          }
        } catch (e) {}
      }

      if (!isSplitSale) {
        cashAmt = s.payment_mode !== "credit" ? s.total : 0;
      }

      const netCash = Math.max(0, cashAmt - s.commission_total);
      return {
        ...s,
        isSplitSale,
        cashAmt,
        netCash
      };
    });

    // 1. Daily Business Register - Cash Sales Received
    const cashSalesList = salesWithCash.filter((s) => s.cashAmt > 0);
    const cashSales = cashSalesList.reduce((a, r) => a + r.netCash, 0);

    // Group cash sales by product name (Net cash value)
    const cashSalesByProductMap: Record<string, { quantity: number; total: number }> = {};
    cashSalesList.forEach((s) => {
      const pName = s.product_name;
      if (!cashSalesByProductMap[pName]) {
        cashSalesByProductMap[pName] = { quantity: 0, total: 0 };
      }
      cashSalesByProductMap[pName].quantity += s.quantity || 0;
      cashSalesByProductMap[pName].total += s.netCash || 0;
    });

    const cashSalesByProduct = Object.entries(cashSalesByProductMap).map(([name, stats]) => ({
      product_name: name,
      quantity: stats.quantity,
      total: stats.total,
    }));

    // Calculate digital sales (handles split online portions)
    const digitalSales = dailySales.reduce((a, s) => {
      let isSplitSale = false;
      let onlineAmt = 0;
      if (s.notes) {
        try {
          const meta = JSON.parse(s.notes);
          if (meta && typeof meta === "object" && meta.is_split) {
            isSplitSale = true;
            onlineAmt = Number(meta.online_amount || 0);
          }
        } catch (e) {}
      }
      if (!isSplitSale) {
        return a + (s.payment_mode !== "cash" && s.payment_mode !== "credit" ? s.total : 0);
      }
      return a + onlineAmt;
    }, 0);

    // Calculate credit/udhari sales (handles split credit portions)
    const creditSales = dailySales.reduce((a, s) => {
      let isSplitSale = false;
      let creditAmt = 0;
      if (s.notes) {
        try {
          const meta = JSON.parse(s.notes);
          if (meta && typeof meta === "object" && meta.is_split) {
            isSplitSale = true;
            creditAmt = Number(meta.credit_amount || 0);
          }
        } catch (e) {}
      }
      if (!isSplitSale) {
        return a + (s.payment_mode === "credit" ? s.total : 0);
      }
      return a + creditAmt;
    }, 0);

    const grossSalesTotal = dailySales.reduce((a, r) => a + r.total, 0); // Gross business done today

    // Outstanding Collections Received (All modes: Cash, Online, Paytm)
    const cashPayments = dailyPayments.reduce((a, r) => a + Number(r.amount), 0);
    const digitalPayments = 0; // all integrated into cashbook expected closing
    const paymentsTotal = cashPayments;

    // 2. Business Expenses (Cash Outflows)
    // Decompose Expenses by Category
    const bankDeposits = dailyExpenses.filter((e) => ["bank_deposit", "paytm_transfer"].includes(e.category)).reduce((a, r) => a + Number(r.amount), 0);
    const vehicleExpenses = dailyExpenses.filter((e) => ["vehicle_expense", "fuel", "repair", "maintenance"].includes(e.category)).reduce((a, r) => a + Number(r.amount), 0);
    const deliveryBoyPayments = dailyExpenses.filter((e) => e.category === "delivery_boy_payment").reduce((a, r) => a + Number(r.amount), 0);
    const otherExpenses = dailyExpenses.filter((e) => ["salary", "miscellaneous"].includes(e.category)).reduce((a, r) => a + Number(r.amount), 0);

    const expensesTotal = dailyExpenses.reduce((a, r) => a + Number(r.amount), 0);
    const commissionsTotal = dailySales.reduce((a, r) => a + Number(r.commission_total), 0);

    // Expected Closing Cash Box Drawer calculation
    const openingCash = Number(opening || 0);
    const otherCashReceipts = Number(otherReceipts || 0);
    const cashInflow = cashSales + cashPayments + otherCashReceipts;
    const cashOutflow = bankDeposits + vehicleExpenses + deliveryBoyPayments + otherExpenses; 
    const expectedClosingCash = openingCash + cashInflow - cashOutflow;

    const difference = actual === "" ? 0 : Number(actual) - expectedClosingCash;

    return {
      grossSalesTotal,
      cashSales,
      cashSalesList,
      cashSalesByProduct,
      digitalSales,
      creditSales,
      paymentsTotal,
      cashPayments,
      digitalPayments,
      commissionsTotal,
      expensesTotal,
      bankDeposits,
      vehicleExpenses,
      deliveryBoyPayments,
      otherExpenses,
      cashInflow,
      cashOutflow,
      expectedClosingCash,
      difference,
      otherCashReceipts
    };
  }, [dailySales, dailyPayments, dailyExpenses, opening, actual, otherReceipts]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!agency) return;
    setBusy(true);

    const payload = {
      agency_id: agency.id,
      book_date: date,
      opening_cash: Number(opening || 0),
      actual_closing: actual === "" ? null : Number(actual),
      notes: JSON.stringify({ other_cash_receipts: Number(otherReceipts || 0) })
    };

    const { error } = await supabase
      .from("cash_book_days")
      .upsert(payload, { onConflict: "agency_id,book_date" });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Daily Cash Book saved successfully.");
      void load();
    }
    setBusy(false);
  };

  const doExport = (kind: "pdf" | "xlsx") => {
    if (kind === "pdf") {
      const cols = ["Section", "Transaction Details", "Mode / Category", "Amount (INR)"];
      const rowsData = [
        ["Opening Balance", "Opening Cash Balance", "CASH", fmtCurrency(Number(opening || 0))],
        ["Inflow (Paisa Aaya)", `Cash Sales Received (Net)`, "CASH", fmtCurrency(aggregates.cashSales)],
        ["Inflow (Paisa Aaya)", `Outstanding Collections Received`, "CASH", fmtCurrency(aggregates.cashPayments)],
        ["Inflow (Paisa Aaya)", `Other Cash Receipts`, "CASH", fmtCurrency(aggregates.otherCashReceipts)],
        ["Outflow (Paisa Gaya)", `Bank Deposits`, "CASH", fmtCurrency(aggregates.bankDeposits)],
        ["Outflow (Paisa Gaya)", `Vehicle Expenses`, "CASH", fmtCurrency(aggregates.vehicleExpenses)],
        ["Outflow (Paisa Gaya)", `Delivery Expenses`, "CASH", fmtCurrency(aggregates.deliveryBoyPayments)],
        ["Outflow (Paisa Gaya)", `Other Expenses`, "CASH", fmtCurrency(aggregates.otherExpenses)],
        ["Summary", "Expected Closing Cash", "CALCULATED", fmtCurrency(aggregates.expectedClosingCash)],
        ["Summary", "Actual Cash Count", "AUDITED", actual === "" ? "—" : fmtCurrency(Number(actual))],
        ["Summary", "Difference", "STATUS", actual === "" ? "—" : `${fmtCurrency(aggregates.difference)} (${Math.abs(aggregates.difference) < 0.01 ? "Balanced" : aggregates.difference < 0 ? "Short" : "Excess"})`]
      ];
      exportToPDF(`Daily Cash Book Statement - ${fmtDate(date)}`, cols, rowsData, `cash_register_${date}`);
    } else {
      const data = [
        { Date: fmtDate(date), Description: "Opening Cash Balance", Section: "Opening Balance", Mode: "CASH", Inflow: Number(opening || 0), Outflow: 0 },
        { Date: fmtDate(date), Description: "Cash Sales Received (Net)", Section: "Inflow", Mode: "CASH", Inflow: aggregates.cashSales, Outflow: 0 },
        { Date: fmtDate(date), Description: "Outstanding Collections Received (Cash)", Section: "Inflow", Mode: "CASH", Inflow: aggregates.cashPayments, Outflow: 0 },
        { Date: fmtDate(date), Description: "Other Cash Receipts", Section: "Inflow", Mode: "CASH", Inflow: aggregates.otherCashReceipts, Outflow: 0 },
        { Date: fmtDate(date), Description: "Bank Deposits Today", Section: "Outflow", Mode: "DEBIT", Inflow: 0, Outflow: aggregates.bankDeposits },
        { Date: fmtDate(date), Description: "Vehicle & Fuel Expenses Today", Section: "Outflow", Mode: "DEBIT", Inflow: 0, Outflow: aggregates.vehicleExpenses },
        { Date: fmtDate(date), Description: "Delivery Expenses Today", Section: "Outflow", Mode: "DEBIT", Inflow: 0, Outflow: aggregates.deliveryBoyPayments },
        { Date: fmtDate(date), Description: "Other Expenses Today", Section: "Outflow", Mode: "DEBIT", Inflow: 0, Outflow: aggregates.otherExpenses },
        { Date: fmtDate(date), Description: "Expected Closing Cash", Section: "Expected", Mode: "CASH", Inflow: aggregates.expectedClosingCash, Outflow: 0 }
      ];
      exportToExcel(data, `cash_register_${date}`, "Daily Cash Book");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Daily Cash Book" actions={
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11">
                <Download className="h-4.5 w-4.5 mr-1.5" />{t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("pdf")}><FileText className="h-4 w-4 mr-2" />PDF Cash Statement</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx")}><FileText className="h-4 w-4 mr-2" />Excel Daily Book</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" className="h-11 gap-1.5" onClick={() => window.print()}>
            <Printer className="h-4.5 w-4.5" /> Print Register
          </Button>
        </div>
      } />

      {/* Date Select Panel */}
      <Card className="shadow-soft bg-muted/20 border"><CardContent className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-primary shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">Select Distributorship Date</h3>
            <p className="text-xs text-muted-foreground">Showing records for: <strong className="text-foreground">{fmtDate(date)}</strong></p>
          </div>
        </div>
        <div className="w-full sm:w-auto">
          <Input 
            type="date" 
            value={date} 
            onChange={(e) => setDate(e.target.value)} 
            className="h-10 text-sm font-semibold max-w-xs" 
          />
        </div>
      </CardContent></Card>

      {/* Main Dual Column Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Money Inflow & Outflow details */}
        <div className="lg:col-span-2 space-y-8">
            
          {/* Section: MONEY RECEIVED (Paisa Aaya) */}
          <div className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-600 bg-emerald-500/10 px-3 py-1.5 rounded-md inline-block">
              MONEY RECEIVED (Paisa Aaya)
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Cash Sales Received Card */}
              <Card className="shadow-soft border-primary/20 overflow-hidden">
                <div className="bg-primary/10 border-b border-primary/20 px-4 py-3 flex items-center justify-between">
                  <h3 className="font-bold text-primary flex items-center gap-1.5 text-xs uppercase tracking-wider">
                    <ArrowUpRight className="h-4 w-4 text-primary" /> Cash Sales Received
                  </h3>
                  <span className="font-extrabold text-primary text-sm">{fmtCurrency(aggregates.cashSales)}</span>
                </div>
                <CardContent className="p-0 divide-y text-xs max-h-64 overflow-y-auto">
                  {aggregates.cashSalesList.length === 0 ? (
                    <EmptyState title="No cylinder sales recorded." />
                  ) : (
                    aggregates.cashSalesList.map((s) => (
                      <div key={s.id} className="p-3 flex justify-between items-center hover:bg-muted/10 transition-colors">
                        <div>
                          <div className="font-semibold text-foreground">{s.product_name} Cylinder</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            To: {s.customer_name} · Qty: {s.quantity} · Mode: {s.payment_mode.toUpperCase()}
                            {s.isSplitSale && <span className="ml-1 text-primary font-bold">(Split)</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-foreground">{fmtCurrency(s.netCash)}</p>
                          {s.commission_total > 0 && (
                            <p className="text-[9px] text-muted-foreground font-medium">Net (Commission -{fmtCurrency(s.commission_total)})</p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Outstanding Collections Received Card */}
              <Card className="shadow-soft border-success/20 overflow-hidden">
                <div className="bg-success/10 border-b border-success/20 px-4 py-3 flex items-center justify-between">
                  <h3 className="font-bold text-success-dark flex items-center gap-1.5 text-xs uppercase tracking-wider">
                    <ArrowUpRight className="h-4 w-4 text-success" /> Outstanding Collections
                  </h3>
                  <span className="font-extrabold text-success-dark text-sm">{fmtCurrency(aggregates.cashPayments)}</span>
                </div>
                <CardContent className="p-0 divide-y text-xs max-h-64 overflow-y-auto">
                  {dailyPayments.length === 0 ? (
                    <EmptyState title="No customer payments collected." />
                  ) : (
                    dailyPayments.map((p) => (
                      <div key={p.id} className="p-3 flex justify-between items-center hover:bg-muted/10 transition-colors">
                        <div>
                          <div className="font-semibold text-foreground">Recovery Payment ({p.payment_mode.toUpperCase()})</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">From: {p.customer_name}</div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-success-dark">{fmtCurrency(p.amount)}</p>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Section: MONEY PAID (Paisa Gaya) */}
          <div className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-red-600 bg-red-500/10 px-3 py-1.5 rounded-md inline-block">
              MONEY PAID (Paisa Gaya)
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Bank Deposits & Paytm Transfers Outflows */}
              <Card className="shadow-soft border-destructive/20 overflow-hidden">
                <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-3 flex items-center justify-between">
                  <h3 className="font-bold text-destructive-dark flex items-center gap-1.5 text-xs uppercase tracking-wider">
                    <ArrowDownRight className="h-4 w-4 text-destructive" /> Bank Deposits
                  </h3>
                  <span className="font-bold text-destructive-dark text-sm">{fmtCurrency(aggregates.bankDeposits)}</span>
                </div>
                <CardContent className="p-4 text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Bank/Online Cash Deposits</span>
                    <span className="font-semibold">{fmtCurrency(dailyExpenses.filter(e => e.category === "bank_deposit").reduce((a,r)=>a+r.amount, 0))}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Paytm Wallet Transfers</span>
                    <span className="font-semibold">{fmtCurrency(dailyExpenses.filter(e => e.category === "paytm_transfer").reduce((a,r)=>a+r.amount, 0))}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Vehicle Expenses Card */}
              <Card className="shadow-soft border-destructive/20 overflow-hidden">
                <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-3 flex items-center justify-between">
                  <h3 className="font-bold text-destructive-dark flex items-center gap-1.5 text-xs uppercase tracking-wider">
                    <ArrowDownRight className="h-4 w-4 text-destructive" /> Vehicle Expenses
                  </h3>
                  <span className="font-bold text-destructive-dark text-sm">{fmtCurrency(aggregates.vehicleExpenses)}</span>
                </div>
                <CardContent className="p-4 text-xs space-y-2 max-h-32 overflow-y-auto">
                  {dailyExpenses.filter(e => ["vehicle_expense", "fuel", "repair", "maintenance"].includes(e.category)).length === 0 ? (
                    <div className="text-muted-foreground py-2 text-center select-none">No vehicle expenses logged.</div>
                  ) : (
                    dailyExpenses.filter(e => ["vehicle_expense", "fuel", "repair", "maintenance"].includes(e.category)).map((e) => (
                      <div key={e.id} className="flex justify-between items-start">
                        <div>
                          <span className="font-medium text-foreground capitalize">{e.category.replace("_", " ")}</span>
                          {e.notes && <p className="text-[10px] text-muted-foreground">{e.notes}</p>}
                        </div>
                        <span className="font-semibold text-destructive-dark">{fmtCurrency(e.amount)}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Delivery Expenses Card */}
              <Card className="shadow-soft border-destructive/20 overflow-hidden">
                <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-3 flex items-center justify-between">
                  <h3 className="font-bold text-destructive-dark flex items-center gap-1.5 text-xs uppercase tracking-wider">
                    <ArrowDownRight className="h-4 w-4 text-destructive" /> Delivery Expenses
                  </h3>
                  <span className="font-bold text-destructive-dark text-sm">{fmtCurrency(aggregates.deliveryBoyPayments)}</span>
                </div>
                <CardContent className="p-4 text-xs space-y-2 max-h-32 overflow-y-auto">
                  {dailyExpenses.filter(e => e.category === "delivery_boy_payment").length === 0 ? (
                    <div className="text-muted-foreground py-2 text-center select-none">No direct delivery staff payments.</div>
                  ) : (
                    dailyExpenses.filter(e => e.category === "delivery_boy_payment").map((e) => (
                      <div key={e.id} className="flex justify-between items-start">
                        <div>
                          <span className="font-medium text-foreground">Delivery Staff Payout</span>
                          {e.notes && <p className="text-[10px] text-muted-foreground">{e.notes}</p>}
                        </div>
                        <span className="font-semibold text-destructive-dark">{fmtCurrency(e.amount)}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Other Expenses Card */}
              <Card className="shadow-soft border-destructive/20 overflow-hidden">
                <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-3 flex items-center justify-between">
                  <h3 className="font-bold text-destructive-dark flex items-center gap-1.5 text-xs uppercase tracking-wider">
                    <ArrowDownRight className="h-4 w-4 text-destructive" /> Other Expenses
                  </h3>
                  <span className="font-bold text-destructive-dark text-sm">{fmtCurrency(aggregates.otherExpenses)}</span>
                </div>
                <CardContent className="p-4 text-xs space-y-2 max-h-32 overflow-y-auto">
                  {dailyExpenses.filter(e => ["salary", "miscellaneous"].includes(e.category)).length === 0 ? (
                    <div className="text-muted-foreground py-2 text-center select-none">No salary or office expenses logged.</div>
                  ) : (
                    dailyExpenses.filter(e => ["salary", "miscellaneous"].includes(e.category)).map((e) => (
                      <div key={e.id} className="flex justify-between items-start">
                        <div>
                          <span className="font-medium text-foreground capitalize">{e.category}</span>
                          {e.notes && <p className="text-[10px] text-muted-foreground">{e.notes}</p>}
                        </div>
                        <span className="font-semibold text-destructive-dark">{fmtCurrency(e.amount)}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

        </div>

        {/* Daily Cash Book Summary Box */}
        <div className="space-y-6">
          <Card className="shadow-soft border-primary/20"><CardContent className="p-5">
            <h3 className="font-bold text-sm uppercase tracking-wider text-primary border-b border-primary/20 pb-3 mb-4 flex items-center gap-1.5">
              <Sparkles className="h-4.5 w-4.5 text-primary shrink-0" /> Daily Cash Book
            </h3>

            <form onSubmit={save} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Opening Cash</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={opening} 
                  onChange={(e) => setOpening(e.target.value)} 
                  className="h-11 font-bold text-lg text-primary" 
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Other Cash Receipts</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={otherReceipts} 
                  onChange={(e) => setOtherReceipts(e.target.value)} 
                  className="h-11 font-bold text-lg text-primary" 
                  placeholder="Enter manual cash receipts..."
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Actual Cash Count</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={actual} 
                  onChange={(e) => setActual(e.target.value)} 
                  className="h-11 font-bold text-lg text-success-dark" 
                  placeholder="Enter physical cash count..." 
                />
              </div>

              <div className="rounded-lg border border-border/80 bg-muted/30 p-4 space-y-2.5 text-xs">
                <div className="font-semibold text-primary uppercase text-[10px] tracking-wider border-b pb-1.5 mb-1.5">Expected Closing Cash</div>
                
                <div className="flex justify-between font-medium">
                  <span className="text-muted-foreground">Opening Cash</span>
                  <span>{fmtCurrency(Number(opening || 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-success-dark">+ Cash Sales</span>
                  <span className="font-semibold text-success-dark">+{fmtCurrency(aggregates.cashSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-success-dark">+ Outstanding Collections</span>
                  <span className="font-semibold text-success-dark">+{fmtCurrency(aggregates.cashPayments)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-success-dark">+ Other Cash Receipts</span>
                  <span className="font-semibold text-success-dark">+{fmtCurrency(aggregates.otherCashReceipts)}</span>
                </div>
                
                <div className="border-t border-dashed my-1.5" />
                
                <div className="flex justify-between">
                  <span className="text-destructive-dark">- Bank Deposits</span>
                  <span className="font-semibold text-destructive-dark">-{fmtCurrency(aggregates.bankDeposits)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive-dark">- Vehicle Expenses</span>
                  <span className="font-semibold text-destructive-dark">-{fmtCurrency(aggregates.vehicleExpenses)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive-dark">- Delivery Expenses</span>
                  <span className="font-semibold text-destructive-dark">-{fmtCurrency(aggregates.deliveryBoyPayments)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive-dark">- Other Expenses</span>
                  <span className="font-semibold text-destructive-dark">-{fmtCurrency(aggregates.otherExpenses)}</span>
                </div>

                <div className="border-t border-border/80 pt-2.5 flex justify-between font-bold text-sm">
                  <span>Expected Closing Cash</span>
                  <span className="text-primary font-extrabold">{fmtCurrency(aggregates.expectedClosingCash)}</span>
                </div>

                {actual !== "" && (
                  <>
                    <div className="border-t border-dashed my-1.5" />
                    
                    <div className="flex justify-between font-medium">
                      <span className="text-muted-foreground">Actual Cash Count</span>
                      <span className="font-bold text-foreground">{fmtCurrency(Number(actual))}</span>
                    </div>
                    
                    <div className={`flex justify-between font-bold text-sm ${
                      Math.abs(aggregates.difference) < 0.01 
                        ? "text-success-dark" 
                        : "text-destructive-dark"
                    }`}>
                      <span>Difference</span>
                      <span>{fmtCurrency(aggregates.difference)}</span>
                    </div>

                    <div className="flex justify-between items-center pt-1.5">
                      <span className="text-xs font-bold text-muted-foreground">Reconciliation Status</span>
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                        Math.abs(aggregates.difference) < 0.01 
                          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" 
                          : aggregates.difference < 0
                          ? "bg-red-500/10 text-red-600 border-red-500/20"
                          : "bg-blue-500/10 text-blue-600 border-blue-500/20"
                      }`}>
                        {Math.abs(aggregates.difference) < 0.01 
                          ? "Balanced" 
                          : aggregates.difference < 0
                          ? "Short"
                          : "Excess"}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <Button type="submit" disabled={busy} className="w-full h-12 shadow-sm font-bold uppercase tracking-wider text-xs">
                {busy ? "Saving..." : "Save Daily Cash Book"}
              </Button>
            </form>
          </CardContent></Card>
        </div>

      </div>
    </div>
  );
}

function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}
