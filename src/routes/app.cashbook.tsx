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
      .select("opening_cash, actual_closing")
      .eq("agency_id", agency.id)
      .eq("book_date", date)
      .maybeSingle();

    if (bookData) {
      setOpening(String(bookData.opening_cash ?? 0));
      setActual(bookData.actual_closing != null ? String(bookData.actual_closing) : "");
    } else {
      // If no book exists for today, fetch yesterday's actual closing cash as opening cash
      const yesterday = new Date(new Date(date).getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const { data: prevBook } = await supabase
        .from("cash_book_days")
        .select("actual_closing")
        .eq("agency_id", agency.id)
        .eq("book_date", yesterday)
        .maybeSingle();
      
      setOpening(prevBook?.actual_closing != null ? String(prevBook.actual_closing) : "0");
      setActual("");
    }

    // 2. Fetch daily sales (non-deleted only)
    const { data: sData } = await supabase
      .from("sales")
      .select("id, sale_date, quantity, gross_amount, commission_amount, payment_mode, customer:customers(name), product:products(name)")
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
      commission_total: Number(s.commission_amount || 0)
    }));
    setDailySales(formattedSales);

    // 3. Fetch daily payment collections (non-deleted only)
    const { data: pData } = await (supabase
      .from("payments") as any)
      .select("id, amount, payment_mode, customer:customers(name)")
      .eq("agency_id", agency.id)
      .eq("payment_date", date)
      .eq("is_deleted", false);
    
    const formattedPayments = ((pData ?? []) as any[]).map((p: any) => ({
      id: p.id,
      customer_name: p.customer?.name ?? "—",
      amount: Number(p.amount),
      payment_mode: p.payment_mode
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
    // 1. Money Received (Paisa Aaya)
    // Cash Sales
    const cashSalesList = dailySales.filter((s) => s.payment_mode === "cash");
    const cashSales = cashSalesList.reduce((a, r) => a + Number(r.total), 0);

    // Group cash sales by product name
    const cashSalesByProductMap: Record<string, { quantity: number; total: number }> = {};
    cashSalesList.forEach((s) => {
      const pName = s.product_name;
      if (!cashSalesByProductMap[pName]) {
        cashSalesByProductMap[pName] = { quantity: 0, total: 0 };
      }
      cashSalesByProductMap[pName].quantity += s.quantity || 0;
      cashSalesByProductMap[pName].total += s.total || 0;
    });

    const cashSalesByProduct = Object.entries(cashSalesByProductMap).map(([name, stats]) => ({
      product_name: name,
      quantity: stats.quantity,
      total: stats.total,
    }));

    const digitalSales = dailySales.filter((s) => s.payment_mode !== "cash" && s.payment_mode !== "credit").reduce((a, r) => a + Number(r.total), 0);
    const creditSales = dailySales.filter((s) => s.payment_mode === "credit").reduce((a, r) => a + Number(r.total), 0);
    const grossSalesTotal = cashSales + digitalSales + creditSales;

    const cashPayments = dailyPayments.filter((p) => p.payment_mode === "cash").reduce((a, r) => a + Number(r.amount), 0);
    const digitalPayments = dailyPayments.filter((p) => p.payment_mode !== "cash").reduce((a, r) => a + Number(r.amount), 0);
    const paymentsTotal = cashPayments + digitalPayments;

    // 2. Money Paid (Paisa Gaya)
    // Decompose Expenses by Category
    const bankDeposits = dailyExpenses.filter((e) => e.category === "bank_deposit").reduce((a, r) => a + Number(r.amount), 0);
    const paytmTransfers = dailyExpenses.filter((e) => e.category === "paytm_transfer").reduce((a, r) => a + Number(r.amount), 0);
    
    // Vehicle Expense = vehicle_expense + fuel + repair + maintenance
    const vehicleExpenses = dailyExpenses.filter((e) => ["vehicle_expense", "fuel", "repair", "maintenance"].includes(e.category)).reduce((a, r) => a + Number(r.amount), 0);
    
    // Delivery Boy Payments = commissions kept on cash sales + separate boy payouts
    const commissionsKept = cashSalesList.reduce((a, r) => a + Number(r.commission_total), 0);
    const boyPayouts = dailyExpenses.filter((e) => e.category === "delivery_boy_payment").reduce((a, r) => a + Number(r.amount), 0);
    const deliveryBoyPayments = commissionsKept + boyPayouts;

    // Other Expenses (e.g. salary, miscellaneous)
    const otherExpenses = dailyExpenses.filter((e) => ["salary", "miscellaneous"].includes(e.category)).reduce((a, r) => a + Number(r.amount), 0);

    const expensesTotal = dailyExpenses.reduce((a, r) => a + Number(r.amount), 0);
    const commissionsTotal = dailySales.reduce((a, r) => a + Number(r.commission_total), 0);

    // Physical Drawer Expected Cash (Matching Ramdev Gas Agency Diagram exactly)
    const openingCash = Number(opening || 0);
    const cashInflow = cashSales + cashPayments;
    const cashOutflow = bankDeposits + paytmTransfers + vehicleExpenses + deliveryBoyPayments + otherExpenses;
    const expectedClosingCash = openingCash + cashInflow - cashOutflow;

    const difference = actual === "" ? 0 : Number(actual) - expectedClosingCash;

    return {
      grossSalesTotal,
      cashSales,
      cashSalesByProduct,
      digitalSales,
      creditSales,
      paymentsTotal,
      cashPayments,
      digitalPayments,
      commissionsTotal,
      commissionsKept,
      boyPayouts,
      deliveryBoyPayments,
      expensesTotal,
      bankDeposits,
      paytmTransfers,
      vehicleExpenses,
      otherExpenses,
      cashInflow,
      cashOutflow,
      expectedClosingCash,
      difference
    };
  }, [dailySales, dailyPayments, dailyExpenses, opening, actual]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!agency) return;
    setBusy(true);

    const payload = {
      agency_id: agency.id,
      book_date: date,
      opening_cash: Number(opening || 0),
      actual_closing: actual === "" ? null : Number(actual),
    };

    const { error } = await supabase
      .from("cash_book_days")
      .upsert(payload, { onConflict: "agency_id,book_date" });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Cash book register saved successfully.");
      void load();
    }
  };

  const doExport = (kind: "pdf" | "xlsx") => {
    if (kind === "pdf") {
      const cols = ["Section", "Transaction Details", "Mode / Category", "Amount (INR)"];
      const rowsData = [
        ["Opening Balance", "Opening Cash Drawer", "CASH", fmtCurrency(Number(opening || 0))],
        ["Inflow (Sales)", `Cash Sales Today (${dailySales.filter(s => s.payment_mode === "cash").length} items)`, "CASH", fmtCurrency(aggregates.cashSales)],
        ["Inflow (Sales)", `Digital Sales (${dailySales.filter(s => s.payment_mode !== "cash" && s.payment_mode !== "credit").length} items)`, "ONLINE / PAYTM", fmtCurrency(aggregates.digitalSales)],
        ["Inflow (Sales)", `Udhari Sales (${dailySales.filter(s => s.payment_mode === "credit").length} items)`, "CREDIT", fmtCurrency(aggregates.creditSales)],
        ["Inflow (Payments)", `Recovered Udhari Payments (Cash)`, "CASH", fmtCurrency(aggregates.cashPayments)],
        ["Inflow (Payments)", `Recovered Udhari Payments (Digital)`, "ONLINE / PAYTM", fmtCurrency(aggregates.digitalPayments)],
        ["Outflow (Deposits)", `Bank Deposits Today`, "CASH", fmtCurrency(aggregates.bankDeposits)],
        ["Outflow (Transfers)", `UPI/Paytm Transfers Today`, "CASH", fmtCurrency(aggregates.paytmTransfers)],
        ["Outflow (Vehicle)", `Vehicle & Fuel Expenses`, "CASH", fmtCurrency(aggregates.vehicleExpenses)],
        ["Outflow (Delivery)", `Delivery Boy Commissions & Payouts`, "CASH", fmtCurrency(aggregates.deliveryBoyPayments)],
        ["Outflow (Other)", `Other Operating Expenses`, "CASH", fmtCurrency(aggregates.otherExpenses)],
        ["Summary", "Expected Closing Cash Drawer", "CALCULATED", fmtCurrency(aggregates.expectedClosingCash)],
        ["Summary", "Actual Closing Cash Drawer", "AUDITED", actual === "" ? "—" : fmtCurrency(Number(actual))],
        ["Summary", "Drawer Discrepancy", "STATUS", actual === "" ? "—" : `${fmtCurrency(aggregates.difference)} (${Math.abs(aggregates.difference) < 0.01 ? "Balanced" : "Discrepancy"})`]
      ];
      exportToPDF(`Cash Register Statement - ${fmtDate(date)}`, cols, rowsData, `cash_register_${date}`);
    } else {
      const data = [
        { Date: fmtDate(date), Description: "Opening Cash Drawer", Section: "Opening Balance", Mode: "CASH", Inflow: Number(opening || 0), Outflow: 0 },
        { Date: fmtDate(date), Description: "Cash Sales Today", Section: "Inflow", Mode: "CASH", Inflow: aggregates.cashSales, Outflow: 0 },
        { Date: fmtDate(date), Description: "Digital Sales Today", Section: "Inflow", Mode: "DIGITAL", Inflow: aggregates.digitalSales, Outflow: 0 },
        { Date: fmtDate(date), Description: "Udhari Sales Today", Section: "Inflow", Mode: "CREDIT", Inflow: aggregates.creditSales, Outflow: 0 },
        { Date: fmtDate(date), Description: "Recovered Udhari Payments (Cash)", Section: "Inflow", Mode: "CASH", Inflow: aggregates.cashPayments, Outflow: 0 },
        { Date: fmtDate(date), Description: "Recovered Udhari Payments (Digital)", Section: "Inflow", Mode: "DIGITAL", Inflow: aggregates.digitalPayments, Outflow: 0 },
        { Date: fmtDate(date), Description: "Bank Deposits Today", Section: "Outflow", Mode: "DEBIT", Inflow: 0, Outflow: aggregates.bankDeposits },
        { Date: fmtDate(date), Description: "UPI/Paytm Transfers Today", Section: "Outflow", Mode: "DEBIT", Inflow: 0, Outflow: aggregates.paytmTransfers },
        { Date: fmtDate(date), Description: "Vehicle & Fuel Expenses Today", Section: "Outflow", Mode: "DEBIT", Inflow: 0, Outflow: aggregates.vehicleExpenses },
        { Date: fmtDate(date), Description: "Delivery Boy Commissions & Payouts Today", Section: "Outflow", Mode: "DEBIT", Inflow: 0, Outflow: aggregates.deliveryBoyPayments },
        { Date: fmtDate(date), Description: "Other Operating Expenses Today", Section: "Outflow", Mode: "DEBIT", Inflow: 0, Outflow: aggregates.otherExpenses },
        { Date: fmtDate(date), Description: "Expected Closing Cash Drawer", Section: "Expected", Mode: "CASH", Inflow: aggregates.expectedClosingCash, Outflow: 0 }
      ];
      exportToExcel(data, `cash_register_${date}`, "Cash Book");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("cashbook.title")} actions={
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
        <div className="lg:col-span-2 space-y-6">
            {/* Today's Sales Register - MONEY RECEIVED (PAISA AAYA) */}
          <Card className="shadow-soft border-primary/20 overflow-hidden">
            <div className="bg-primary/10 border-b border-primary/20 px-5 py-3 flex items-center justify-between">
              <h3 className="font-bold text-primary flex items-center gap-2 text-sm uppercase tracking-wider">
                <ArrowUpRight className="h-5 w-5 text-primary" /> MONEY RECEIVED (PAISA AAYA)
              </h3>
              <div className="text-right">
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Total Business Today</span>
                <span className="font-extrabold text-primary text-base">{fmtCurrency(aggregates.grossSalesTotal)}</span>
              </div>
            </div>
            <CardContent className="p-0 divide-y text-sm">
              {dailySales.length === 0 ? (
                <EmptyState title="No cylinder sales recorded on this date." />
              ) : (
                dailySales.map((s) => (
                  <div key={s.id} className="p-4 flex justify-between items-center hover:bg-muted/10 transition-colors">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-foreground">{s.product_name} Sale to {s.customer_name}</div>
                      <div className="text-xs text-muted-foreground">Qty: {s.quantity} units · Rate: {fmtCurrency(s.total / s.quantity)}</div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase border ${
                        s.payment_mode === "cash" 
                          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" 
                          : s.payment_mode === "credit"
                          ? "bg-destructive/10 text-destructive border-destructive/20 animate-pulse"
                          : s.payment_mode === "paytm"
                          ? "bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
                          : "bg-sky-500/10 text-sky-600 border-sky-500/20"
                      }`}>
                        {s.payment_mode === "cash" ? "CASH" : s.payment_mode === "credit" ? "UDHARI" : s.payment_mode === "paytm" ? "UPI" : "BANK"}
                      </span>
                      <p className="font-bold text-foreground mt-1">{fmtCurrency(s.total)}</p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Udhari Recoveries */}
          <Card className="shadow-soft border-success/20 overflow-hidden">
            <div className="bg-success/10 border-b border-success/20 px-5 py-3 flex items-center justify-between">
              <h3 className="font-bold text-success-dark flex items-center gap-2 text-sm uppercase tracking-wider">
                <ArrowUpRight className="h-5 w-5 text-success" /> UDHARI RECOVERIES
              </h3>
              <div className="text-right">
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Recovered Udhari Payments</span>
                <span className="font-extrabold text-success-dark text-base">{fmtCurrency(aggregates.paymentsTotal)}</span>
              </div>
            </div>
            <CardContent className="p-0 divide-y text-sm">
              {dailyPayments.length === 0 ? (
                <EmptyState title="No customer payments collected on this date." />
              ) : (
                dailyPayments.map((p) => (
                  <div key={p.id} className="p-4 flex justify-between items-center hover:bg-muted/10 transition-colors">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-foreground">Collection from {p.customer_name}</div>
                      <div className="text-xs text-muted-foreground">Outstanding dues payment receipt</div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase border ${
                        p.payment_mode === "cash" 
                          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" 
                          : p.payment_mode === "paytm"
                          ? "bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
                          : "bg-sky-500/10 text-sky-600 border-sky-500/20"
                      }`}>
                        {p.payment_mode === "cash" ? "CASH" : p.payment_mode === "paytm" ? "UPI" : "BANK"}
                      </span>
                      <p className="font-bold text-success-dark mt-1">{fmtCurrency(p.amount)}</p>
                    </div>
                  </div>
                ))
              )}
              <div className="p-4 bg-muted/40 font-semibold text-xs flex justify-between items-center border-t border-dashed leading-relaxed">
                <span className="text-muted-foreground flex items-start gap-1.5">
                  <ArrowUpRight className="h-4 w-4 text-success shrink-0 mt-0.5" />
                  <span><strong>Note:</strong> These recovered payments collected against past Udhari dues reduce the customer's pending dues balance only, and do NOT increase today's sales. This prevents double-counting of revenue.</span>
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Money Paid (Expenses & Commission / Outflow) */}
          <Card className="shadow-soft border-destructive/20 overflow-hidden">
            <div className="bg-destructive/10 border-b border-destructive/20 px-5 py-3 flex items-center justify-between">
              <h3 className="font-bold text-destructive-dark flex items-center gap-2 text-sm uppercase tracking-wider">
                <ArrowDownRight className="h-5 w-5 text-destructive" /> Money Paid (Paisa Gaya)
              </h3>
              <span className="font-bold text-destructive-dark text-sm">{fmtCurrency(aggregates.cashOutflow)}</span>
            </div>
            <CardContent className="p-0 divide-y text-sm">
              {aggregates.cashOutflow === 0 ? (
                <EmptyState title="No cash outflows paid on this date." />
              ) : (
                <>
                  {/* Bank Deposits */}
                  {aggregates.bankDeposits > 0 && (
                    <div className="p-4 flex justify-between items-center hover:bg-muted/10 transition-colors">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-foreground">Bank Deposits</div>
                        <div className="text-xs text-muted-foreground">Cash deposited into bank accounts</div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-destructive-dark">{fmtCurrency(aggregates.bankDeposits)}</p>
                      </div>
                    </div>
                  )}

                  {/* Paytm Transfers */}
                  {aggregates.paytmTransfers > 0 && (
                    <div className="p-4 flex justify-between items-center hover:bg-muted/10 transition-colors">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-foreground">Paytm Transfers</div>
                        <div className="text-xs text-muted-foreground">Cash transferred to Paytm business wallets</div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-destructive-dark">{fmtCurrency(aggregates.paytmTransfers)}</p>
                      </div>
                    </div>
                  )}

                  {/* Vehicle Expenses */}
                  {aggregates.vehicleExpenses > 0 && (
                    <div className="p-4 flex justify-between items-center hover:bg-muted/10 transition-colors">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-foreground">Vehicle Expenses</div>
                        <div className="text-xs text-muted-foreground">Diesel/fuel, repair, vehicle driver & maintenance</div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-destructive-dark">{fmtCurrency(aggregates.vehicleExpenses)}</p>
                      </div>
                    </div>
                  )}

                  {/* Delivery Boy Payments */}
                  {aggregates.deliveryBoyPayments > 0 && (
                    <div className="p-4 flex justify-between items-center hover:bg-muted/10 transition-colors">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-foreground">Delivery Boy Payments & Commissions</div>
                        <div className="text-xs text-muted-foreground">Commissions kept directly by boys + separate cash payouts</div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-destructive-dark">{fmtCurrency(aggregates.deliveryBoyPayments)}</p>
                      </div>
                    </div>
                  )}

                  {/* Other Expenses */}
                  {aggregates.otherExpenses > 0 && (
                    <div className="p-4 flex justify-between items-center hover:bg-muted/10 transition-colors">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-foreground">Other / Salary Expenses</div>
                        <div className="text-xs text-muted-foreground">Operator salaries, office rent, and miscellaneous charges</div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-destructive-dark">{fmtCurrency(aggregates.otherExpenses)}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

        </div>

        {/* Cash Drawer Reconciliation Box */}
        <div className="space-y-6">
          <Card className="shadow-soft border-primary/20"><CardContent className="p-5">
            <h3 className="font-bold text-sm uppercase tracking-wider text-primary border-b border-primary/20 pb-3 mb-4 flex items-center gap-1.5">
              <Sparkles className="h-4.5 w-4.5 text-primary shrink-0" /> Drawer Reconciliation
            </h3>

            <form onSubmit={save} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Opening Cash Drawer</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={opening} 
                  onChange={(e) => setOpening(e.target.value)} 
                  className="h-11 font-bold text-lg text-primary" 
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Actual Cash Drawer Closing</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={actual} 
                  onChange={(e) => setActual(e.target.value)} 
                  className="h-11 font-bold text-lg text-success-dark" 
                  placeholder="Count physical drawer..." 
                />
                <p className="text-[10px] text-muted-foreground">Input the exact physical cash amount present inside the drawer.</p>
              </div>

              <div className="rounded-lg border border-border/80 bg-muted/30 p-4 space-y-2.5 text-xs">
                <div className="flex justify-between font-medium">
                  <span className="text-muted-foreground">Opening Cash Drawer</span>
                  <span>{fmtCurrency(Number(opening || 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-success-dark">+ Cash Sales Today</span>
                  <span className="font-semibold text-success-dark">{fmtCurrency(aggregates.cashSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-success-dark">+ Cash Recoveries Today</span>
                  <span className="font-semibold text-success-dark">{fmtCurrency(aggregates.cashPayments)}</span>
                </div>
                <div className="flex justify-between border-t border-dashed pt-1 mt-1">
                  <span className="text-destructive-dark">- Bank Deposits Today</span>
                  <span className="font-semibold text-destructive-dark">-{fmtCurrency(aggregates.bankDeposits)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive-dark">- UPI/Paytm Transfers Today</span>
                  <span className="font-semibold text-destructive-dark">-{fmtCurrency(aggregates.paytmTransfers)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive-dark">- Vehicle & Fuel Expenses Today</span>
                  <span className="font-semibold text-destructive-dark">-{fmtCurrency(aggregates.vehicleExpenses)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive-dark">- Delivery Boy Commissions & Payouts</span>
                  <span className="font-semibold text-destructive-dark">-{fmtCurrency(aggregates.deliveryBoyPayments)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-destructive-dark">- Other Operating Expenses</span>
                  <span className="font-semibold text-destructive-dark">-{fmtCurrency(aggregates.otherExpenses)}</span>
                </div>

                <div className="border-t border-border/80 pt-2.5 flex justify-between font-bold text-sm">
                  <span>Expected Closing Cash Drawer</span>
                  <span className="text-primary">{fmtCurrency(aggregates.expectedClosingCash)}</span>
                </div>

                {actual !== "" && (
                  <div className={`border-t border-border/80 pt-2.5 flex justify-between font-bold text-sm ${Math.abs(aggregates.difference) < 0.01 ? "text-success-dark" : "text-destructive-dark"}`}>
                    <span>Drawer Discrepancy</span>
                    <span>
                      {fmtCurrency(aggregates.difference)} <span className="text-[10px] font-semibold">({Math.abs(aggregates.difference) < 0.01 ? "Balanced" : "Discrepancy"})</span>
                    </span>
                  </div>
                )}
              </div>

              <Button type="submit" disabled={busy} className="w-full h-12 shadow-sm font-bold uppercase tracking-wider text-xs">
                {busy ? "Saving Day..." : "Save Daily Register"}
              </Button>
            </form>
          </CardContent></Card>

          {/* Digital transactions warning side card */}
          <Card className="shadow-soft bg-gradient-to-b from-primary/5 to-background border-primary/10">
            <CardContent className="p-4 space-y-3 text-xs leading-relaxed text-muted-foreground">
              <div className="font-semibold text-primary uppercase text-[10px] tracking-wider">Digital / Non-Cash Summary</div>
              <div className="flex justify-between">
                <span>Digital Sales (Online/Paytm):</span>
                <span className="font-semibold text-foreground">{fmtCurrency(aggregates.digitalSales)}</span>
              </div>
              <div className="flex justify-between">
                <span>Digital Udhari Payments:</span>
                <span className="font-semibold text-foreground">{fmtCurrency(aggregates.digitalPayments)}</span>
              </div>
              <div className="border-t border-dashed pt-2 mt-1">
                Digital payments bypass physical drawers entirely and accumulate inside your merchant accounts. Reconcile them strictly against merchant app statements.
              </div>
            </CardContent>
          </Card>
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
