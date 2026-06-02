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
import { 
  ArrowUpRight, ArrowDownRight, Printer, Download, FileText, 
  Sparkles, Plus, Trash2, Loader2, Calendar, CheckCircle2, AlertTriangle, AlertCircle
} from "lucide-react";
import { exportToExcel, exportToPDF } from "@/lib/exports";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

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
  delivery_boy_id: string | null;
  delivery_boy_name: string | null;
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

interface OtherReceiptItem {
  id: string;
  particular: string;
  amount: number;
}

function Page() {
  const { t } = useTranslation();
  const { agency } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [opening, setOpening] = useState("0");
  const [actual, setActual] = useState("");
  const [otherReceiptsList, setOtherReceiptsList] = useState<OtherReceiptItem[]>([]);
  const [busy, setBusy] = useState(false);

  // Other receipts quick-add dialog state
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [receiptParticular, setReceiptParticular] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");

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
      
      let parsedList: OtherReceiptItem[] = [];
      if (bookData.notes) {
        try {
          const meta = JSON.parse(bookData.notes);
          if (meta && typeof meta === "object" && Array.isArray(meta.other_receipts)) {
            parsedList = meta.other_receipts;
          } else if (meta && typeof meta === "object" && meta.other_cash_receipts != null) {
            // Fallback to legacy single manual receipts sum if list is not structured
            parsedList = [{
              id: "legacy-receipt",
              particular: "Legacy Manual Receipts",
              amount: Number(meta.other_cash_receipts)
            }];
          }
        } catch (e) {
          // ignore parsing error
        }
      }
      setOtherReceiptsList(parsedList);
    } else {
      // If no book exists for today, fetch yesterday's calculated closing cash as opening cash fallback
      const yesterday = new Date(new Date(date).getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const { data: prevBook } = await supabase
        .from("cash_book_days")
        .select("actual_closing, notes")
        .eq("agency_id", agency.id)
        .eq("book_date", yesterday)
        .maybeSingle();

      let yesterdayCalculated = 0;
      if (prevBook?.notes) {
        try {
          const meta = JSON.parse(prevBook.notes);
          if (meta && typeof meta === "object" && meta.calculated_closing != null) {
            yesterdayCalculated = Number(meta.calculated_closing);
          }
        } catch (e) {}
      }
      
      const fallbackOpening = yesterdayCalculated || (prevBook?.actual_closing != null ? prevBook.actual_closing : 0);
      setOpening(String(fallbackOpening));
      setActual("");
      setOtherReceiptsList([]);
    }

    // 2. Fetch daily sales (non-deleted only) with delivery boy name join
    const { data: sData } = await supabase
      .from("sales")
      .select(`
        id, 
        sale_date, 
        quantity, 
        gross_amount, 
        commission_amount, 
        payment_mode, 
        notes, 
        customer:customers(name), 
        product:products(name),
        delivery_boy:delivery_boys(name),
        delivery_boy_id
      `)
      .eq("agency_id", agency.id)
      .eq("sale_date", date)
      .eq("is_deleted", false);
    
    const formattedSales = ((sData ?? []) as any[]).map((s) => {
      let paymentMode = s.payment_mode;
      if (s.notes) {
        try {
          const meta = JSON.parse(s.notes);
          if (meta && typeof meta === "object" && meta.is_cheque) {
            paymentMode = "cheque";
          }
        } catch (e) {}
      }
      return {
        id: s.id,
        customer_name: s.customer?.name ?? "Walk-in Counter",
        product_name: s.product?.name ?? "Cylinder",
        quantity: Number(s.quantity),
        total: Number(s.gross_amount),
        payment_mode: paymentMode,
        commission_total: Number(s.commission_amount || 0),
        notes: s.notes,
        delivery_boy_id: s.delivery_boy_id,
        delivery_boy_name: s.delivery_boy?.name ?? null
      };
    });
    setDailySales(formattedSales);

    // 3. Fetch daily payment collections (non-deleted only)
    const { data: pData } = await (supabase
      .from("payments") as any)
      .select("id, amount, mode, remarks, customer:customers(name)")
      .eq("agency_id", agency.id)
      .eq("payment_date", date)
      .eq("is_deleted", false);
    
    const formattedPayments = ((pData ?? []) as any[]).map((p: any) => {
      let mode = p.mode;
      if (p.remarks && p.remarks.startsWith("[CHEQUE]")) {
        mode = "cheque";
      }
      return {
        id: p.id,
        customer_name: p.customer?.name ?? "—",
        amount: Number(p.amount),
        payment_mode: mode
      };
    });
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

  // Aggregate and process ledger statistics
  const aggregates = useMemo(() => {
    const openingCash = Number(opening || 0);

    // Grouping domestic sales by "Home Delivery" vs "CNC Counter"
    let homeTotal = 0;
    let cncTotal = 0;
    const productSalesTotals: Record<string, { quantity: number; total: number }> = {};

    dailySales.forEach((s) => {
      const nameLower = s.product_name.toLowerCase();
      // Main domestic cylinders check
      const isMainCylinder = nameLower.includes("14.2") || nameLower.includes("domestic") || nameLower.includes("cylinder") || nameLower === "lpg" || nameLower === "gas";
      
      if (isMainCylinder) {
        if (!s.delivery_boy_id || nameLower.includes("cnc")) {
          cncTotal += s.total;
        } else {
          homeTotal += s.total;
        }
      } else {
        const pName = s.product_name;
        if (!productSalesTotals[pName]) {
          productSalesTotals[pName] = { quantity: 0, total: 0 };
        }
        productSalesTotals[pName].quantity += s.quantity;
        productSalesTotals[pName].total += s.total;
      }
    });

    const collectionsTotal = dailyPayments.reduce((sum, p) => sum + p.amount, 0);
    const otherInflowsSum = otherReceiptsList.reduce((sum, r) => sum + r.amount, 0);

    // Left Grand Total (Inflows)
    const otherProductSalesSum = Object.values(productSalesTotals).reduce((sum, r) => sum + r.total, 0);
    const leftGrandTotal = openingCash + homeTotal + cncTotal + otherProductSalesSum + collectionsTotal + otherInflowsSum;

    // Right Side Outflows calculation
    const expensesTotal = dailyExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const commissionsTotal = dailySales.reduce((sum, s) => sum + Number(s.commission_total), 0);

    // Group commissions per driver/delivery boy
    const commissionByDriver: Record<string, { name: string; amount: number }> = {};
    dailySales.forEach((s) => {
      if (s.commission_total > 0 && s.delivery_boy_name) {
        const name = s.delivery_boy_name;
        if (!commissionByDriver[name]) {
          commissionByDriver[name] = { name, amount: 0 };
        }
        commissionByDriver[name].amount += s.commission_total;
      }
    });

    // Payment modes outflows from Sales
    const paytmSales = dailySales.filter(s => s.payment_mode === "paytm").reduce((a, r) => a + r.total, 0);
    const onlineSales = dailySales.reduce((a, s) => {
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
        return a + (s.payment_mode === "online" ? s.total : 0);
      }
      return a + onlineAmt;
    }, 0);
    const chequeSales = dailySales.filter(s => s.payment_mode === "cheque").reduce((a, r) => a + r.total, 0);
    const udhariSales = dailySales.reduce((a, s) => {
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

    // Payment modes outflows from outstanding collections / recoveries
    const paytmRecoveries = dailyPayments.filter(p => p.payment_mode === "paytm").reduce((a, r) => a + r.amount, 0);
    const onlineRecoveries = dailyPayments.filter(p => p.payment_mode === "online").reduce((a, r) => a + r.amount, 0);
    const chequeRecoveries = dailyPayments.filter(p => p.payment_mode === "cheque").reduce((a, r) => a + r.amount, 0);

    const paytmOutflow = paytmSales + paytmRecoveries;
    const onlineOutflow = onlineSales + onlineRecoveries;
    const chequeOutflow = chequeSales + chequeRecoveries;
    const udhariOutflow = udhariSales;

    // Calculated Cash Balance
    const cashBalance = leftGrandTotal - (expensesTotal + paytmOutflow + onlineOutflow + chequeOutflow + udhariOutflow + commissionsTotal);

    // Right Grand Total (Outflows + Cash Balance)
    const rightGrandTotal = expensesTotal + paytmOutflow + onlineOutflow + chequeOutflow + udhariOutflow + commissionsTotal + cashBalance;

    const difference = actual === "" ? 0 : Number(actual) - cashBalance;

    return {
      openingCash,
      homeTotal,
      cncTotal,
      productSalesTotals,
      collectionsTotal,
      otherInflowsSum,
      leftGrandTotal,
      expensesTotal,
      commissionsTotal,
      commissionByDriver,
      paytmOutflow,
      onlineOutflow,
      chequeOutflow,
      udhariOutflow,
      cashBalance,
      rightGrandTotal,
      difference
    };
  }, [dailySales, dailyPayments, dailyExpenses, opening, actual, otherReceiptsList]);

  // Add Other Manual Receipts
  const addOtherReceipt = async (e: FormEvent) => {
    e.preventDefault();
    if (!agency) return;

    const amount = Number(receiptAmount);
    if (!receiptParticular.trim() || isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid particular name and amount.");
      return;
    }

    const newItem: OtherReceiptItem = {
      id: "rec-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      particular: receiptParticular.trim(),
      amount
    };

    const updatedList = [...otherReceiptsList, newItem];
    const otherReceiptsSum = updatedList.reduce((sum, item) => sum + item.amount, 0);

    const newOtherInflowsSum = updatedList.reduce((sum, r) => sum + r.amount, 0);
    const newLeftGrandTotal = aggregates.leftGrandTotal - aggregates.otherInflowsSum + newOtherInflowsSum;
    const newCashBalance = newLeftGrandTotal - (aggregates.expensesTotal + aggregates.paytmOutflow + aggregates.onlineOutflow + aggregates.chequeOutflow + aggregates.udhariOutflow + aggregates.commissionsTotal);

    setBusy(true);
    const payload = {
      agency_id: agency.id,
      book_date: date,
      opening_cash: Number(opening || 0),
      actual_closing: actual === "" ? null : Number(actual),
      notes: JSON.stringify({
        other_cash_receipts: otherReceiptsSum,
        other_receipts: updatedList,
        calculated_closing: newCashBalance
      })
    };

    const { error } = await supabase
      .from("cash_book_days")
      .upsert(payload, { onConflict: "agency_id,book_date" });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Payment inflow recorded successfully.");
      setOtherReceiptsList(updatedList);
      setIsReceiptOpen(false);
      setReceiptParticular("");
      setReceiptAmount("");
      void load();
    }
    setBusy(false);
  };

  // Delete manual receipt
  const deleteOtherReceipt = async (id: string) => {
    if (!agency) return;
    
    const updatedList = otherReceiptsList.filter(item => item.id !== id);
    const otherReceiptsSum = updatedList.reduce((sum, item) => sum + item.amount, 0);

    const newOtherInflowsSum = updatedList.reduce((sum, r) => sum + r.amount, 0);
    const newLeftGrandTotal = aggregates.leftGrandTotal - aggregates.otherInflowsSum + newOtherInflowsSum;
    const newCashBalance = newLeftGrandTotal - (aggregates.expensesTotal + aggregates.paytmOutflow + aggregates.onlineOutflow + aggregates.chequeOutflow + aggregates.udhariOutflow + aggregates.commissionsTotal);

    const payload = {
      agency_id: agency.id,
      book_date: date,
      opening_cash: Number(opening || 0),
      actual_closing: actual === "" ? null : Number(actual),
      notes: JSON.stringify({
        other_cash_receipts: otherReceiptsSum,
        other_receipts: updatedList,
        calculated_closing: newCashBalance
      })
    };

    const { error } = await supabase
      .from("cash_book_days")
      .upsert(payload, { onConflict: "agency_id,book_date" });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Payment inflow deleted successfully.");
      setOtherReceiptsList(updatedList);
      void load();
    }
  };

  // Save full Cash Book day
  const saveCashBook = async (e: FormEvent) => {
    e.preventDefault();
    if (!agency) return;
    setBusy(true);

    const otherReceiptsSum = otherReceiptsList.reduce((sum, item) => sum + item.amount, 0);
    const payload = {
      agency_id: agency.id,
      book_date: date,
      opening_cash: Number(opening || 0),
      actual_closing: actual === "" ? null : Number(actual),
      notes: JSON.stringify({
        other_cash_receipts: otherReceiptsSum,
        other_receipts: otherReceiptsList,
        calculated_closing: aggregates.cashBalance
      })
    };

    const { error } = await supabase
      .from("cash_book_days")
      .upsert(payload, { onConflict: "agency_id,book_date" });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Daily Cash Book successfully reconciled and saved.");
      void load();
    }
    setBusy(false);
  };

  const doExport = (kind: "pdf" | "xlsx") => {
    if (kind === "pdf") {
      const cols = ["Section / Column", "Particular Ledger Details", "Payment Type", "Amount (INR)"];
      const rowsData = [
        ["Payment Received", "Opening Cash Balance", "CASH", fmtCurrency(aggregates.openingCash)],
        ["Payment Received", `Home Delivery Sales (Domestic 14.2kg)`, "REVENUE", fmtCurrency(aggregates.homeTotal)],
        ["Payment Received", `CNC Counter Sales (Domestic 14.2kg)`, "REVENUE", fmtCurrency(aggregates.cncTotal)],
        ...Object.entries(aggregates.productSalesTotals).map(([pName, stats]) => [
          "Payment Received", `${pName} Sales (${stats.quantity} units)`, "REVENUE", fmtCurrency(stats.total)
        ]),
        ["Payment Received", `Outstanding Customer Collections`, "RECOVERY", fmtCurrency(aggregates.collectionsTotal)],
        ...otherReceiptsList.map((item) => [
          "Payment Received", `${item.particular} (Manual Inflow)`, "OTHER INFLOW", fmtCurrency(item.amount)
        ]),
        ["Money Paid", `Daily Overhead Expenses`, "EXPENSE", fmtCurrency(aggregates.expensesTotal)],
        ["Money Paid", `Paytm Digital Outflow (Sales + Recovery)`, "NON-CASH", fmtCurrency(aggregates.paytmOutflow)],
        ["Money Paid", `Online UPI / Website Prepaid Outflow`, "NON-CASH", fmtCurrency(aggregates.onlineOutflow)],
        ["Money Paid", `Cheque Collections Outflow`, "NON-CASH", fmtCurrency(aggregates.chequeOutflow)],
        ["Money Paid", `Udhari Credit Sales Today`, "CREDIT", fmtCurrency(aggregates.udhariOutflow)],
        ["Money Paid", `Drivers Route Commission Paid`, "ROUTE PAYOUT", fmtCurrency(aggregates.commissionsTotal)],
        ["Money Paid", "Calculated Cash Balance", "CASH BALANCE", fmtCurrency(aggregates.cashBalance)],
        ["Summary Status", "Actual Cash Counted", "AUDIT", actual === "" ? "—" : fmtCurrency(Number(actual))],
        ["Summary Status", "Cash Drawer Discrepancy", "AUDIT STATUS", actual === "" ? "—" : `${fmtCurrency(aggregates.difference)} (${Math.abs(aggregates.difference) < 0.01 ? "Balanced" : aggregates.difference < 0 ? "Short" : "Excess"})`]
      ];
      exportToPDF(`Daily Double-Entry Ledger - ${fmtDate(date)}`, cols, rowsData, `double_ledger_${date}`);
    } else {
      const data = [
        { Date: fmtDate(date), Particulars: "Opening Cash Balance", Type: "Received", PaymentMode: "CASH", Inflow: aggregates.openingCash, Outflow: 0 },
        { Date: fmtDate(date), Particulars: "Home Delivery Sales (Domestic 14.2kg)", Type: "Received", PaymentMode: "REVENUE", Inflow: aggregates.homeTotal, Outflow: 0 },
        { Date: fmtDate(date), Particulars: "CNC Counter Sales (Domestic 14.2kg)", Type: "Received", PaymentMode: "REVENUE", Inflow: aggregates.cncTotal, Outflow: 0 },
        ...Object.entries(aggregates.productSalesTotals).map(([pName, stats]) => ({
          Date: fmtDate(date), Particulars: `${pName} Sales (${stats.quantity} units)`, Type: "Received", PaymentMode: "REVENUE", Inflow: stats.total, Outflow: 0
        })),
        { Date: fmtDate(date), Particulars: "Outstanding Customer Collections", Type: "Received", PaymentMode: "RECOVERY", Inflow: aggregates.collectionsTotal, Outflow: 0 },
        ...otherReceiptsList.map((item) => ({
          Date: fmtDate(date), Particulars: `${item.particular} (Manual Inflow)`, Type: "Received", PaymentMode: "OTHER INFLOW", Inflow: item.amount, Outflow: 0
        })),
        { Date: fmtDate(date), Particulars: "Overhead Expenses", Type: "Paid", PaymentMode: "EXPENSE", Inflow: 0, Outflow: aggregates.expensesTotal },
        { Date: fmtDate(date), Particulars: "Paytm Digital Outflow", Type: "Paid", PaymentMode: "NON-CASH", Inflow: 0, Outflow: aggregates.paytmOutflow },
        { Date: fmtDate(date), Particulars: "Online UPI Outflow", Type: "Paid", PaymentMode: "NON-CASH", Inflow: 0, Outflow: aggregates.onlineOutflow },
        { Date: fmtDate(date), Particulars: "Cheque Collections Outflow", Type: "Paid", PaymentMode: "NON-CASH", Inflow: 0, Outflow: aggregates.chequeOutflow },
        { Date: fmtDate(date), Particulars: "Udhari Credit Sales", Type: "Paid", PaymentMode: "CREDIT", Inflow: 0, Outflow: aggregates.udhariOutflow },
        { Date: fmtDate(date), Particulars: "Drivers Route Commission Paid", Type: "Paid", PaymentMode: "COMMISSION", Inflow: 0, Outflow: aggregates.commissionsTotal },
        { Date: fmtDate(date), Particulars: "Calculated Closing Cash Balance", Type: "Paid", PaymentMode: "CASH BALANCE", Inflow: 0, Outflow: aggregates.cashBalance }
      ];
      exportToExcel(data, `double_ledger_${date}`, "Double-Entry Cashbook");
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader title="Excel Double-Entry Ledger" actions={
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11">
                <Download className="h-4.5 w-4.5 mr-1.5" />{t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("pdf")}><FileText className="h-4 w-4 mr-2 text-primary" />PDF Double Ledger</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx")}><FileText className="h-4 w-4 mr-2 text-success" />Excel Spreadsheet</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" className="h-11 gap-1.5" onClick={() => window.print()}>
            <Printer className="h-4.5 w-4.5" /> Print Ledger
          </Button>
        </div>
      } />

      {/* Controls & Selection Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <Card className="md:col-span-2 shadow-soft bg-muted/20 border"><CardContent className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary shrink-0" />
            <div>
              <h3 className="font-semibold text-sm">Select Distributorship Date</h3>
              <p className="text-xs text-muted-foreground">Double-entry ledger details for: <strong className="text-foreground">{fmtDate(date)}</strong></p>
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

        {/* Quick Inflow Receipt Button */}
        <Button 
          type="button" 
          onClick={() => setIsReceiptOpen(true)}
          className="h-14 font-semibold shadow-soft text-sm bg-gradient-to-r from-emerald-600 to-teal-600 text-white gap-2"
        >
          <Plus className="h-5 w-5" /> + Other Payment Inflow
        </Button>
      </div>

      {/* Excel Dual Column Ledger Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start border rounded-xl overflow-hidden shadow-soft bg-white">
        
        {/* LEFT COLUMN: Payment Received (Paisa Aaya) */}
        <div className="flex flex-col h-full border-r border-border/80 min-h-[500px]">
          <div className="bg-slate-50 border-b border-border/80 px-5 py-2.5 flex justify-between items-center select-none">
            <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <ArrowUpRight className="h-4.5 w-4.5 text-emerald-500 shrink-0" /> Payment Received (Paisa Aaya)
            </h3>
            <div className="flex items-center gap-2">
              <Label htmlFor="opening-cash-input" className="text-[10px] font-bold text-slate-600 uppercase">Opening Cash:</Label>
              <Input 
                id="opening-cash-input"
                type="number"
                step="any"
                min="0"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                onBlur={async () => {
                  if (!agency) return;
                  const otherReceiptsSum = otherReceiptsList.reduce((sum, item) => sum + item.amount, 0);
                  const payload = {
                    agency_id: agency.id,
                    book_date: date,
                    opening_cash: Number(opening || 0),
                    actual_closing: actual === "" ? null : Number(actual),
                    notes: JSON.stringify({
                      other_cash_receipts: otherReceiptsSum,
                      other_receipts: otherReceiptsList,
                      calculated_closing: aggregates.cashBalance
                    })
                  };
                  await supabase
                    .from("cash_book_days")
                    .upsert(payload, { onConflict: "agency_id,book_date" });
                }}
                className="h-8 w-24 font-bold text-right text-xs text-primary focus-visible:ring-primary"
              />
            </div>
          </div>

          <div className="flex-1 divide-y divide-slate-100 text-xs">
            {/* Home Delivery cylinders */}
            {aggregates.homeTotal > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40 transition-colors">
                <span className="font-semibold text-slate-600">Home Delivery Sales (Domestic 14.2kg)</span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(aggregates.homeTotal)}</span>
              </div>
            )}

            {/* CNC Counter Sales */}
            {aggregates.cncTotal > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40 transition-colors">
                <span className="font-semibold text-slate-600">CNC Counter Sales (Domestic 14.2kg)</span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(aggregates.cncTotal)}</span>
              </div>
            )}

            {/* Other Products Sales */}
            {Object.entries(aggregates.productSalesTotals).map(([pName, stats]) => (
              <div key={pName} className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40 transition-colors">
                <span className="font-semibold text-slate-600">{pName} Sales ({stats.quantity} units)</span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(stats.total)}</span>
              </div>
            ))}

            {/* Recovery payments collections */}
            {aggregates.collectionsTotal > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40 transition-colors">
                <span className="font-semibold text-slate-600">Outstanding Customer Collections (Credit Recovery)</span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(aggregates.collectionsTotal)}</span>
              </div>
            )}

            {/* Manual inflows Other Receipts */}
            {otherReceiptsList.map((item) => (
              <div key={item.id} className="px-5 py-3 flex justify-between items-center hover:bg-slate-50/40 group transition-colors">
                <span className="font-semibold text-slate-600 flex items-center gap-1.5">
                  {item.particular}
                  <button 
                    type="button"
                    onClick={() => deleteOtherReceipt(item.id)}
                    className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity font-bold ml-1.5 text-[10px]"
                    title="Delete entry"
                  >
                    ✕
                  </button>
                </span>
                <span className="font-bold tabular-nums text-emerald-600 text-sm">{fmtCurrency(item.amount)}</span>
              </div>
            ))}

            {/* Empty filler rows when lists are short to balance visually */}
            {dailySales.length === 0 && otherReceiptsList.length === 0 && (
              <div className="p-8 text-center text-muted-foreground select-none italic text-[11px]">
                No business transactions received today.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Money Paid (Paisa Gaya) */}
        <div className="flex flex-col h-full min-h-[500px]">
          <div className="bg-slate-50 border-b border-border/80 px-5 py-3.5 flex justify-between items-center select-none">
            <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <ArrowDownRight className="h-4.5 w-4.5 text-red-500 shrink-0" /> Money Paid (Paisa Gaya)
            </h3>
            <span className="text-xs font-black text-slate-400">₹ INR</span>
          </div>

          <div className="flex-1 divide-y divide-slate-100 text-xs">
            {/* Direct Expenses */}
            {dailyExpenses.map((exp) => {
              let displayCategory = exp.category;
              let displayNotes = exp.notes ?? "";
              if (exp.notes && exp.notes.startsWith("[OTHER_CAT:")) {
                const match = exp.notes.match(/^\[OTHER_CAT:([^\]]+)\]/);
                if (match) {
                  displayCategory = match[1];
                  displayNotes = exp.notes.replace(/^\[OTHER_CAT:[^\]]+\]\s*/, "");
                }
              }
              return (
                <div key={exp.id} className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40 transition-colors">
                  <span className="font-semibold text-slate-600 capitalize">
                    {displayCategory.replace("_", " ")} {displayNotes ? `(${displayNotes})` : ""}
                  </span>
                  <span className="font-bold tabular-nums text-red-600 text-sm">{fmtCurrency(exp.amount)}</span>
                </div>
              );
            })}

            {/* Paytm outflow */}
            {aggregates.paytmOutflow > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40 transition-colors">
                <span className="font-semibold text-slate-600">Paytm Digital Account (Sales + Recovery)</span>
                <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(aggregates.paytmOutflow)}</span>
              </div>
            )}

            {/* Online UPI outflow */}
            {aggregates.onlineOutflow > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40 transition-colors">
                <span className="font-semibold text-slate-600">Online UPI / Website Prepaid</span>
                <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(aggregates.onlineOutflow)}</span>
              </div>
            )}

            {/* Cheque outflow */}
            {aggregates.chequeOutflow > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40 transition-colors">
                <span className="font-semibold text-slate-600">Bank Cheque collections</span>
                <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(aggregates.chequeOutflow)}</span>
              </div>
            )}

            {/* Udhari credit outflow */}
            {aggregates.udhariOutflow > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40 transition-colors">
                <span className="font-semibold text-slate-600">Today's Credit Sales (Udhari)</span>
                <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(aggregates.udhariOutflow)}</span>
              </div>
            )}

            {/* Commission with driver breakdown */}
            {aggregates.commissionsTotal > 0 && (
              <div className="px-5 py-3 flex flex-col hover:bg-slate-50/40 transition-colors">
                <div className="flex justify-between items-center py-0.5">
                  <span className="font-semibold text-slate-600">Route Commission Paid</span>
                  <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(aggregates.commissionsTotal)}</span>
                </div>
                
                {/* Driver listings */}
                <div className="mt-1 pl-3 border-l-2 border-slate-200/80 space-y-0.5 text-[10px] text-slate-500 font-medium">
                  {Object.values(aggregates.commissionByDriver).map((drv) => (
                    <div key={drv.name} className="flex justify-between py-0.5">
                      <span>{drv.name}</span>
                      <span className="tabular-nums">{fmtCurrency(drv.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Footer: Total Outflow (blue) + Cash Balance / Difference (green) */}
          <div className="mt-auto border-t border-border/80 select-none">
            {/* Total Paid Outflow row - blue */}
            <div className="bg-blue-50 border-b border-blue-100 px-5 py-3 flex justify-between items-center">
              <span className="text-xs font-extrabold uppercase tracking-wider text-blue-700">Total Paid Outflow</span>
              <span className="tabular-nums font-black text-sm text-blue-700">
                {fmtCurrency(aggregates.expensesTotal + aggregates.paytmOutflow + aggregates.onlineOutflow + aggregates.chequeOutflow + aggregates.udhariOutflow + aggregates.commissionsTotal)}
              </span>
            </div>
            {/* Calculated Cash Balance row - green */}
            <div className="bg-emerald-50 px-5 py-4 flex justify-between items-center shadow-sm">
              <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-700">Calculated Cash Balance</span>
              <span className="tabular-nums font-black text-base text-emerald-600">{fmtCurrency(aggregates.cashBalance)}</span>
            </div>
          </div>
        </div>

      </div>

      {/* Bottom Summary Reconciliation Card */}
      <Card className="shadow-card border bg-slate-50/50"><CardContent className="p-6">
        <h3 className="font-bold text-sm uppercase tracking-wider text-slate-800 border-b pb-3 mb-5 flex items-center gap-2 select-none">
          <Sparkles className="h-5 w-5 text-primary shrink-0" /> Daily Cash Book Summary
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center text-center md:text-left">
          <div className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total Received (Inflows)</span>
            <div className="text-2xl font-black text-emerald-600 tabular-nums">{fmtCurrency(aggregates.leftGrandTotal)}</div>
          </div>

          <div className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total Paid (Outflows)</span>
            <div className="text-2xl font-black text-red-600 tabular-nums">
              {fmtCurrency(aggregates.expensesTotal + aggregates.paytmOutflow + aggregates.onlineOutflow + aggregates.chequeOutflow + aggregates.udhariOutflow + aggregates.commissionsTotal)}
            </div>
          </div>

          <div className="space-y-1 bg-emerald-50 p-4 rounded-xl border border-emerald-200">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Closing Cash Balance (Difference)</span>
            <div className="text-2xl font-black text-emerald-600 tabular-nums mt-0.5">{fmtCurrency(aggregates.cashBalance)}</div>
          </div>

          <div className="flex md:justify-end mt-4 md:mt-0 md:col-span-3 border-t pt-4">
            <Button 
              onClick={saveCashBook} 
              disabled={busy} 
              className="h-11 shadow-sm font-bold uppercase tracking-wider text-xs px-6"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Cash Book for Today
            </Button>
          </div>
        </div>
      </CardContent></Card>

      {/* Manual Receipt Quick Add Dialog */}
      <Dialog open={isReceiptOpen} onOpenChange={setIsReceiptOpen}>
        <DialogContent className="max-w-sm bg-white border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              💰 Record Miscellaneous Inflow
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={addOtherReceipt} className="space-y-4 mt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Particular / Description</Label>
              <Input 
                required
                type="text" 
                value={receiptParticular} 
                onChange={(e) => setReceiptParticular(e.target.value)} 
                placeholder="Name change, Udhari cash receipt..." 
                className="h-11 font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Amount Received (₹)</Label>
              <Input 
                required
                type="number" 
                step="any"
                min="0.01"
                value={receiptAmount} 
                onChange={(e) => setReceiptAmount(e.target.value)} 
                placeholder="0.00" 
                className="h-11 font-bold"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsReceiptOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold h-11">
                {busy ? "Saving..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}

