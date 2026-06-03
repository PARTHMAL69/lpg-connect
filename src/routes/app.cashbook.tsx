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
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fmtCurrency, fmtDate, todayISO } from "@/lib/format";
import {
  ArrowUpRight, ArrowDownRight, Printer, Download, FileText,
  Sparkles, Plus, Loader2, Calendar, StickyNote, AlertCircle,
} from "lucide-react";
import { exportToPDF } from "@/lib/exports";
import * as XLSX from "xlsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export const Route = createFileRoute("/app/cashbook")({ component: () => <RequireAgencyUser><Page /></RequireAgencyUser> });

/* ─── Interfaces ─── */
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
interface OtherReceiptItem { id: string; particular: string; amount: number; }
interface BillItem { id: string; label: string; qty: number; rate: number; amount: number; }

/* ─── helpers ─── */
function newId() { return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7); }

function Page() {
  const { t } = useTranslation();
  const { agency } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [opening, setOpening] = useState("0");
  const [manualCashEntry, setManualCashEntry] = useState("");
  const [dailyNote, setDailyNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Stored lists (from notes JSON)
  const [otherReceiptsList, setOtherReceiptsList] = useState<OtherReceiptItem[]>([]);
  const [pendingBills, setPendingBills] = useState<BillItem[]>([]);
  const [magilBills, setMagilBills] = useState<BillItem[]>([]);
  const [paymentInflows, setPaymentInflows] = useState<OtherReceiptItem[]>([]);
  const [paymentOutflows, setPaymentOutflows] = useState<OtherReceiptItem[]>([]);

  // DB records
  const [dailySales, setDailySales] = useState<CashSaleItem[]>([]);
  const [dailyPayments, setDailyPayments] = useState<CashPaymentItem[]>([]);
  const [dailyExpenses, setDailyExpenses] = useState<CashExpenseItem[]>([]);

  // Dialog states
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [receiptParticular, setReceiptParticular] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");

  const [isPendingOpen, setIsPendingOpen] = useState(false);
  const [pendingLabel, setPendingLabel] = useState("");
  const [pendingQty, setPendingQty] = useState("");
  const [pendingRate, setPendingRate] = useState("");

  const [isMagilOpen, setIsMagilOpen] = useState(false);
  const [magilLabel, setMagilLabel] = useState("");
  const [magilQty, setMagilQty] = useState("");
  const [magilRate, setMagilRate] = useState("");

  /* ─── Helpers to build complete notes payload ─── */
  const buildNotes = (overrides: Record<string, any> = {}) => {
    const base = {
      other_receipts: otherReceiptsList,
      other_cash_receipts: otherReceiptsList.reduce((s, r) => s + r.amount, 0),
      pending_bills: pendingBills,
      magil_bills: magilBills,
      payment_inflows: paymentInflows,
      payment_outflows: paymentOutflows,
      manual_cash_entry: manualCashEntry === "" ? null : Number(manualCashEntry),
      daily_note: dailyNote,
      calculated_closing: 0, // will be overwritten after balance calc
    };
    return JSON.stringify({ ...base, ...overrides });
  };

  /* ─── Load ─── */
  const load = async () => {
    if (!agency) return;

    const { data: bookData } = await supabase
      .from("cash_book_days")
      .select("opening_cash, actual_closing, notes")
      .eq("agency_id", agency.id)
      .eq("book_date", date)
      .maybeSingle();

    if (bookData) {
      setOpening(String(bookData.opening_cash ?? 0));
      if (bookData.notes) {
        try {
          const m = JSON.parse(bookData.notes);
          setOtherReceiptsList(Array.isArray(m.other_receipts) ? m.other_receipts : []);
          setPendingBills(Array.isArray(m.pending_bills) ? m.pending_bills : []);
          setMagilBills(Array.isArray(m.magil_bills) ? m.magil_bills : []);
          setPaymentInflows(Array.isArray(m.payment_inflows) ? m.payment_inflows : []);
          setPaymentOutflows(Array.isArray(m.payment_outflows) ? m.payment_outflows : []);
          setManualCashEntry(m.manual_cash_entry != null ? String(m.manual_cash_entry) : "");
          setDailyNote(m.daily_note ?? "");
        } catch (_) {}
      }
    } else {
      // Fallback: yesterday's calculated closing as opening
      const yesterday = new Date(new Date(date).getTime() - 86400000).toISOString().slice(0, 10);
      const { data: prev } = await supabase
        .from("cash_book_days")
        .select("notes")
        .eq("agency_id", agency.id)
        .eq("book_date", yesterday)
        .maybeSingle();
      let oc = 0;
      if (prev?.notes) {
        try { oc = JSON.parse(prev.notes)?.calculated_closing ?? 0; } catch (_) {}
      }
      setOpening(String(oc));
      setOtherReceiptsList([]); setPendingBills([]); setMagilBills([]);
      setPaymentInflows([]); setPaymentOutflows([]);
      setManualCashEntry(""); setDailyNote("");
    }

    // Sales
    const { data: sData } = await supabase
      .from("sales")
      .select(`id, quantity, gross_amount, commission_amount, payment_mode, notes,
        customer:customers(name), product:products(name),
        delivery_boy:delivery_boys(name), delivery_boy_id`)
      .eq("agency_id", agency.id).eq("sale_date", date).eq("is_deleted", false);

    setDailySales(((sData ?? []) as any[]).map((s) => {
      let pm = s.payment_mode;
      try { const m = JSON.parse(s.notes ?? "{}"); if (m.is_cheque) pm = "cheque"; } catch (_) {}
      return {
        id: s.id,
        customer_name: s.customer?.name ?? "Walk-in",
        product_name: s.product?.name ?? "Cylinder",
        quantity: Number(s.quantity),
        total: Number(s.gross_amount),
        payment_mode: pm,
        commission_total: Number(s.commission_amount || 0),
        notes: s.notes,
        delivery_boy_id: s.delivery_boy_id,
        delivery_boy_name: s.delivery_boy?.name ?? null,
      };
    }));

    // Payments
    const { data: pData } = await (supabase.from("payments") as any)
      .select("id, amount, mode, remarks, customer:customers(name)")
      .eq("agency_id", agency.id).eq("payment_date", date).eq("is_deleted", false);

    setDailyPayments(((pData ?? []) as any[]).map((p: any) => ({
      id: p.id,
      customer_name: p.customer?.name ?? "—",
      amount: Number(p.amount),
      payment_mode: p.remarks?.startsWith("[CHEQUE]") ? "cheque" : p.mode,
    })));

    // Expenses
    const { data: eData } = await (supabase.from("expenses") as any)
      .select("id, category, amount, notes")
      .eq("agency_id", agency.id).eq("expense_date", date).eq("is_deleted", false);
    setDailyExpenses((eData ?? []) as CashExpenseItem[]);
  };

  useEffect(() => { void load(); }, [agency, date]);

  /* ─── Aggregates ─── */
  const agg = useMemo(() => {
    const openingCash = Number(opening || 0);

    // Group domestic 14kg sales by home/CNC
    let homeTotal = 0, homeQty = 0, cncTotal = 0, cncQty = 0;
    const productSalesTotals: Record<string, { quantity: number; total: number }> = {};

    // Per-delivery-boy for commission and online
    const commissionByDriver: Record<string, { name: string; amount: number; qty: number }> = {};
    const onlineByDriver: Record<string, { name: string; qty: number; amount: number }> = {};
    let onlineQtyTotal = 0;

    // Per-customer udhari
    const udhariByCustomer: Record<string, { name: string; amount: number }> = {};

    dailySales.forEach((s) => {
      const nl = s.product_name.toLowerCase();
      const isMain = nl.includes("14.2") || nl.includes("domestic") || nl.includes("cylinder") || nl === "lpg" || nl === "gas";
      const isCNC = !s.delivery_boy_id || nl.includes("cnc");

      if (isMain) {
        if (isCNC) { cncTotal += s.total; cncQty += s.quantity; }
        else { homeTotal += s.total; homeQty += s.quantity; }
      } else {
        if (!productSalesTotals[s.product_name]) productSalesTotals[s.product_name] = { quantity: 0, total: 0 };
        productSalesTotals[s.product_name].quantity += s.quantity;
        productSalesTotals[s.product_name].total += s.total;
      }

      // Commission per driver with qty
      if (s.commission_total > 0 && s.delivery_boy_name) {
        const n = s.delivery_boy_name;
        if (!commissionByDriver[n]) commissionByDriver[n] = { name: n, amount: 0, qty: 0 };
        commissionByDriver[n].amount += s.commission_total;
        commissionByDriver[n].qty += s.quantity;
      }

      // Online/website per delivery boy
      let isSplit = false, onlineAmt = 0, creditAmt = 0;
      try {
        const m = JSON.parse(s.notes ?? "{}");
        if (m.is_split) { isSplit = true; onlineAmt = Number(m.online_amount || 0); creditAmt = Number(m.credit_amount || 0); }
      } catch (_) {}

      const isOnlineSale = !isSplit && s.payment_mode === "online";
      const effectiveOnline = isSplit ? onlineAmt : (isOnlineSale ? s.total : 0);
      if (effectiveOnline > 0) {
        const dbKey = s.delivery_boy_name ?? "Counter / Walk-in";
        if (!onlineByDriver[dbKey]) onlineByDriver[dbKey] = { name: dbKey, qty: 0, amount: 0 };
        onlineByDriver[dbKey].qty += s.quantity;
        onlineByDriver[dbKey].amount += effectiveOnline;
        onlineQtyTotal += s.quantity;
      }

      // Udhari per customer
      const effectiveCredit = isSplit ? creditAmt : (s.payment_mode === "credit" ? s.total : 0);
      if (effectiveCredit > 0) {
        const cn = s.customer_name ?? "Unknown";
        if (!udhariByCustomer[cn]) udhariByCustomer[cn] = { name: cn, amount: 0 };
        udhariByCustomer[cn].amount += effectiveCredit;
      }
    });

    const collectionsTotal = dailyPayments.reduce((s, p) => s + p.amount, 0);
    const otherInflowsSum = otherReceiptsList.reduce((s, r) => s + r.amount, 0);
    const pendingBillsTotal = pendingBills.reduce((s, b) => s + b.amount, 0);
    const paymentInflowsTotal = paymentInflows.reduce((s, p) => s + p.amount, 0);

    const otherProductSalesSum = Object.values(productSalesTotals).reduce((s, r) => s + r.total, 0);
    const leftGrandTotal = openingCash + homeTotal + cncTotal + otherProductSalesSum + collectionsTotal + otherInflowsSum + pendingBillsTotal + paymentInflowsTotal;

    const expensesTotal = dailyExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const commissionsTotal = Object.values(commissionByDriver).reduce((s, d) => s + d.amount, 0);

    // Mode outflows from sales
    const paytmSales = dailySales.filter(s => s.payment_mode === "paytm").reduce((a, r) => a + r.total, 0);
    const onlineSales = Object.values(onlineByDriver).reduce((s, d) => s + d.amount, 0);
    const chequeSales = dailySales.filter(s => s.payment_mode === "cheque").reduce((a, r) => a + r.total, 0);
    const udhariSales = Object.values(udhariByCustomer).reduce((s, c) => s + c.amount, 0);

    const paytmRecoveries = dailyPayments.filter(p => p.payment_mode === "paytm").reduce((a, r) => a + r.amount, 0);
    const onlineRecoveries = dailyPayments.filter(p => p.payment_mode === "online").reduce((a, r) => a + r.amount, 0);
    const chequeRecoveries = dailyPayments.filter(p => p.payment_mode === "cheque").reduce((a, r) => a + r.amount, 0);

    const paytmOutflow = paytmSales + paytmRecoveries;
    const onlineOutflow = onlineSales + onlineRecoveries;
    const chequeOutflow = chequeSales + chequeRecoveries;
    const udhariOutflow = udhariSales;
    const magilBillsTotal = magilBills.reduce((s, b) => s + b.amount, 0);
    const paymentOutflowsTotal = paymentOutflows.reduce((s, p) => s + p.amount, 0);

    const totalOutflows = expensesTotal + paytmOutflow + onlineOutflow + chequeOutflow + udhariOutflow + commissionsTotal + magilBillsTotal + paymentOutflowsTotal;
    const cashBalance = leftGrandTotal - totalOutflows;
    const manualNum = manualCashEntry === "" ? null : Number(manualCashEntry);
    const cashDifference = manualNum != null ? cashBalance - manualNum : null;

    return {
      openingCash, homeTotal, homeQty, cncTotal, cncQty,
      productSalesTotals, collectionsTotal, otherInflowsSum,
      pendingBillsTotal, paymentInflowsTotal,
      leftGrandTotal, expensesTotal, commissionsTotal,
      commissionByDriver, onlineByDriver, onlineQtyTotal,
      udhariByCustomer, udhariOutflow, paytmOutflow, onlineOutflow,
      chequeOutflow, magilBillsTotal, paymentOutflowsTotal,
      totalOutflows, cashBalance, cashDifference,
    };
  }, [dailySales, dailyPayments, dailyExpenses, opening, manualCashEntry,
    otherReceiptsList, pendingBills, magilBills, paymentInflows, paymentOutflows]);

  /* ─── Persist helper ─── */
  const persist = async (patches: Record<string, any> = {}) => {
    if (!agency) return;
    const merged = {
      other_receipts: otherReceiptsList,
      other_cash_receipts: otherReceiptsList.reduce((s, r) => s + r.amount, 0),
      pending_bills: pendingBills,
      magil_bills: magilBills,
      payment_inflows: paymentInflows,
      payment_outflows: paymentOutflows,
      manual_cash_entry: manualCashEntry === "" ? null : Number(manualCashEntry),
      daily_note: dailyNote,
      calculated_closing: agg.cashBalance,
      ...patches,
    };
    const { error } = await supabase.from("cash_book_days").upsert({
      agency_id: agency.id,
      book_date: date,
      opening_cash: Number(opening || 0),
      actual_closing: null,
      notes: JSON.stringify(merged),
    }, { onConflict: "agency_id,book_date" });
    if (error) toast.error(error.message);
  };

  /* ─── Add Pending Bill ─── */
  const addPendingBill = async (e: FormEvent) => {
    e.preventDefault();
    const qty = Number(pendingQty), rate = Number(pendingRate);
    if (!pendingLabel.trim() || !qty || !rate) { toast.error("Fill in label, qty and rate."); return; }
    const item: BillItem = { id: newId(), label: pendingLabel.trim(), qty, rate, amount: qty * rate };
    const updated = [...pendingBills, item];
    setPendingBills(updated);
    await persist({ pending_bills: updated });
    toast.success("Pending Bill added.");
    setIsPendingOpen(false); setPendingLabel(""); setPendingQty(""); setPendingRate("");
  };

  const deletePendingBill = async (id: string) => {
    const updated = pendingBills.filter(b => b.id !== id);
    setPendingBills(updated);
    await persist({ pending_bills: updated });
  };

  /* ─── Add Magil Bill ─── */
  const addMagilBill = async (e: FormEvent) => {
    e.preventDefault();
    const qty = Number(magilQty), rate = Number(magilRate);
    if (!magilLabel.trim() || !qty || !rate) { toast.error("Fill in label, qty and rate."); return; }
    const item: BillItem = { id: newId(), label: magilLabel.trim(), qty, rate, amount: qty * rate };
    const updated = [...magilBills, item];
    setMagilBills(updated);
    await persist({ magil_bills: updated });
    toast.success("Magil Bill added.");
    setIsMagilOpen(false); setMagilLabel(""); setMagilQty(""); setMagilRate("");
  };

  const deleteMagilBill = async (id: string) => {
    const updated = magilBills.filter(b => b.id !== id);
    setMagilBills(updated);
    await persist({ magil_bills: updated });
  };

  /* ─── Add Other Receipt (misc inflow) ─── */
  const addOtherReceipt = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(receiptAmount);
    if (!receiptParticular.trim() || !amount) { toast.error("Enter description and amount."); return; }
    const item: OtherReceiptItem = { id: newId(), particular: receiptParticular.trim(), amount };
    const updated = [...otherReceiptsList, item];
    setOtherReceiptsList(updated);
    await persist({ other_receipts: updated, other_cash_receipts: updated.reduce((s, r) => s + r.amount, 0) });
    toast.success("Inflow recorded.");
    setIsReceiptOpen(false); setReceiptParticular(""); setReceiptAmount("");
  };

  const deleteOtherReceipt = async (id: string) => {
    const updated = otherReceiptsList.filter(r => r.id !== id);
    setOtherReceiptsList(updated);
    await persist({ other_receipts: updated, other_cash_receipts: updated.reduce((s, r) => s + r.amount, 0) });
  };

  /* ─── Save Cash Book ─── */
  const saveCashBook = async (e: FormEvent) => {
    e.preventDefault();
    if (!agency) return;
    setBusy(true);
    await persist({ calculated_closing: agg.cashBalance });
    toast.success("Cash Book saved.");
    setBusy(false);
  };

  /* ─── Professional Excel Export (side-by-side) ─── */
  const doExcelExport = () => {
    const wb = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = {};

    const R = (row: number, col: number, v: any, bold = false, right = false, numFmt?: string) => {
      const addr = XLSX.utils.encode_cell({ r: row, c: col });
      ws[addr] = { v, t: typeof v === "number" ? "n" : "s", s: { font: { bold }, alignment: { horizontal: right ? "right" : "left" }, numFmt: numFmt ?? (typeof v === "number" ? "#,##0.00" : "@") } };
    };

    let row = 0;

    // Title row
    R(row, 0, `Daily Cash Book — ${fmtDate(date)}`, true);
    R(row, 4, `Agency Report`, true);
    row += 2;

    // Column headers
    R(row, 0, "PAYMENT RECEIVED (Paisa Aaya)", true);
    R(row, 1, "Qty", true, true);
    R(row, 2, "Amount (₹)", true, true);
    R(row, 4, "MONEY PAID (Paisa Gaya)", true);
    R(row, 5, "Qty", true, true);
    R(row, 6, "Amount (₹)", true, true);
    row++;

    // Build left & right data arrays
    type LRow = { label: string; qty: number | string; amt: number };
    const left: LRow[] = [];
    const right: LRow[] = [];

    // LEFT
    left.push({ label: "Opening Cash Balance", qty: "", amt: agg.openingCash });
    if (agg.homeTotal > 0) left.push({ label: "14 KG Home Delivery Sales", qty: agg.homeQty, amt: agg.homeTotal });
    if (agg.cncTotal > 0) left.push({ label: "14 KG CNC Counter Sales", qty: agg.cncQty, amt: agg.cncTotal });
    Object.entries(agg.productSalesTotals).forEach(([n, s]) => left.push({ label: `${n} Sales`, qty: s.quantity, amt: s.total }));
    if (agg.collectionsTotal > 0) left.push({ label: "Outstanding Customer Collections", qty: "", amt: agg.collectionsTotal });
    otherReceiptsList.forEach(r => left.push({ label: r.particular, qty: "", amt: r.amount }));
    pendingBills.forEach(b => left.push({ label: `Pending — ${b.label} (${b.qty} × ₹${b.rate})`, qty: b.qty, amt: b.amount }));
    paymentInflows.forEach(p => left.push({ label: p.particular, qty: "", amt: p.amount }));
    left.push({ label: "TOTAL RECEIVED", qty: "", amt: agg.leftGrandTotal });

    // RIGHT
    dailyExpenses.forEach(e => {
      let cat = e.category, note = e.notes ?? "";
      if (note.startsWith("[OTHER_CAT:")) { const m = note.match(/^\[OTHER_CAT:([^\]]+)\]/); if (m) { cat = m[1]; note = note.replace(/^\[OTHER_CAT:[^\]]+\]\s*/, ""); } }
      right.push({ label: `${cat.replace("_", " ")}${note ? ` (${note})` : ""}`, qty: "", amt: Number(e.amount) });
    });
    if (agg.paytmOutflow > 0) right.push({ label: "Paytm Digital Account (Sales + Recovery)", qty: "", amt: agg.paytmOutflow });
    if (agg.onlineOutflow > 0) {
      right.push({ label: "Website Prepaid", qty: agg.onlineQtyTotal, amt: agg.onlineOutflow });
      Object.values(agg.onlineByDriver).forEach(d => right.push({ label: `  └ ${d.name}`, qty: d.qty, amt: d.amount }));
    }
    if (agg.chequeOutflow > 0) right.push({ label: "Bank Cheque Collections", qty: "", amt: agg.chequeOutflow });
    if (agg.udhariOutflow > 0) {
      right.push({ label: "Today's Credit Sales (Udhari)", qty: "", amt: agg.udhariOutflow });
      Object.values(agg.udhariByCustomer).forEach(c => right.push({ label: `  └ ${c.name}`, qty: "", amt: c.amount }));
    }
    if (agg.commissionsTotal > 0) {
      right.push({ label: "Route Commission Paid", qty: "", amt: agg.commissionsTotal });
      Object.values(agg.commissionByDriver).forEach(d => right.push({ label: `  └ ${d.name}`, qty: d.qty, amt: d.amount }));
    }
    magilBills.forEach(b => right.push({ label: `Magil — ${b.label} (${b.qty} × ₹${b.rate})`, qty: b.qty, amt: b.amount }));
    paymentOutflows.forEach(p => right.push({ label: p.particular, qty: "", amt: p.amount }));
    right.push({ label: "TOTAL PAID OUTFLOW", qty: "", amt: agg.totalOutflows });
    right.push({ label: "CALCULATED CASH BALANCE", qty: "", amt: agg.cashBalance });

    // Write rows
    const maxRows = Math.max(left.length, right.length);
    for (let i = 0; i < maxRows; i++) {
      const l = left[i];
      const r2 = right[i];
      if (l) {
        const isTot = l.label.startsWith("TOTAL");
        R(row, 0, l.label, isTot);
        if (l.qty !== "") R(row, 1, l.qty, isTot, true);
        R(row, 2, l.amt, isTot, true);
      }
      if (r2) {
        const isTot = r2.label.startsWith("TOTAL") || r2.label.startsWith("CALCULATED");
        R(row, 4, r2.label, isTot);
        if (r2.qty !== "") R(row, 5, r2.qty, isTot, true);
        R(row, 6, r2.amt, isTot, true);
      }
      row++;
    }

    row += 2;
    R(row, 0, "SUMMARY", true); row++;
    R(row, 0, "Total Received (Inflows)"); R(row, 2, agg.leftGrandTotal, false, true); row++;
    R(row, 0, "Total Paid (Outflows)"); R(row, 2, agg.totalOutflows, false, true); row++;
    R(row, 0, "Calculated Cash Balance", true); R(row, 2, agg.cashBalance, true, true); row++;
    if (agg.cashDifference !== null) {
      R(row, 0, "Manual Cash Entry"); R(row, 2, Number(manualCashEntry), false, true); row++;
      R(row, 0, "Difference (Calc − Manual)", true); R(row, 2, agg.cashDifference, true, true); row++;
    }
    if (dailyNote) { row++; R(row, 0, `Daily Note: ${dailyNote}`); }

    // Col widths
    ws["!cols"] = [
      { wch: 42 }, { wch: 7 }, { wch: 14 }, { wch: 2 },
      { wch: 42 }, { wch: 7 }, { wch: 14 },
    ];
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row + 2, c: 6 } });

    XLSX.utils.book_append_sheet(wb, ws, "Cash Book");
    XLSX.writeFile(wb, `cashbook_${date}.xlsx`);
  };

  const doExport = (kind: "pdf" | "xlsx") => {
    if (kind === "xlsx") { doExcelExport(); return; }
    const cols = ["Section", "Particulars", "Qty", "Amount (INR)"];
    const rows: any[][] = [
      ["Received", "Opening Cash", "", fmtCurrency(agg.openingCash)],
      ...(agg.homeTotal > 0 ? [["Received", "14KG Home Delivery", agg.homeQty, fmtCurrency(agg.homeTotal)]] : []),
      ...(agg.cncTotal > 0 ? [["Received", "14KG CNC Counter", agg.cncQty, fmtCurrency(agg.cncTotal)]] : []),
      ...Object.entries(agg.productSalesTotals).map(([n, s]) => ["Received", `${n} Sales`, s.quantity, fmtCurrency(s.total)]),
      ...(agg.collectionsTotal > 0 ? [["Received", "Customer Collections", "", fmtCurrency(agg.collectionsTotal)]] : []),
      ...otherReceiptsList.map(r => ["Received", r.particular, "", fmtCurrency(r.amount)]),
      ...pendingBills.map(b => ["Received", `Pending — ${b.label}`, b.qty, fmtCurrency(b.amount)]),
      ...paymentInflows.map(p => ["Received", p.particular, "", fmtCurrency(p.amount)]),
      ...dailyExpenses.map(e => {
        let cat = e.category; if (e.notes?.startsWith("[OTHER_CAT:")) { const m = e.notes.match(/^\[OTHER_CAT:([^\]]+)\]/); if (m) cat = m[1]; }
        return ["Paid", cat, "", fmtCurrency(Number(e.amount))];
      }),
      ...(agg.paytmOutflow > 0 ? [["Paid", "Paytm Digital", "", fmtCurrency(agg.paytmOutflow)]] : []),
      ...(agg.onlineOutflow > 0 ? [["Paid", "Website Prepaid", agg.onlineQtyTotal, fmtCurrency(agg.onlineOutflow)]] : []),
      ...(agg.chequeOutflow > 0 ? [["Paid", "Bank Cheque", "", fmtCurrency(agg.chequeOutflow)]] : []),
      ...(agg.udhariOutflow > 0 ? [["Paid", "Udhari Credit Sales", "", fmtCurrency(agg.udhariOutflow)]] : []),
      ...(agg.commissionsTotal > 0 ? [["Paid", "Route Commission", "", fmtCurrency(agg.commissionsTotal)]] : []),
      ...magilBills.map(b => ["Paid", `Magil — ${b.label}`, b.qty, fmtCurrency(b.amount)]),
      ...paymentOutflows.map(p => ["Paid", p.particular, "", fmtCurrency(p.amount)]),
      ["Balance", "Calculated Cash Balance", "", fmtCurrency(agg.cashBalance)],
    ];
    exportToPDF(`Daily Double-Entry Ledger — ${fmtDate(date)}`, cols, rows, `double_ledger_${date}`);
  };

  /* ─── Opening cash blur persist ─── */
  const onOpeningBlur = async () => { await persist({}); };

  /* ─── Note blur persist ─── */
  const onNoteBlur = async () => { await persist({ daily_note: dailyNote }); };

  /* ─── Manual cash entry blur persist ─── */
  const onManualBlur = async () => { await persist({ manual_cash_entry: manualCashEntry === "" ? null : Number(manualCashEntry) }); };

  /* ──────────────────────────────────────────────────────────── JSX ─── */
  return (
    <div className="space-y-6 pb-10">
      <PageHeader title="Daily Cash Book" actions={
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11">
                <Download className="h-4.5 w-4.5 mr-1.5" />{t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("pdf")}><FileText className="h-4 w-4 mr-2 text-primary" />PDF Ledger</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx")}><FileText className="h-4 w-4 mr-2 text-emerald-600" />Excel (Side-by-Side)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" className="h-11 gap-1.5" onClick={() => window.print()}>
            <Printer className="h-4.5 w-4.5" /> Print Ledger
          </Button>
        </div>
      } />

      {/* Date picker */}
      <Card className="shadow-soft bg-muted/20 border">
        <CardContent className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary shrink-0" />
            <div>
              <h3 className="font-semibold text-sm">Select Distributorship Date</h3>
              <p className="text-xs text-muted-foreground">Double-entry ledger for: <strong className="text-foreground">{fmtDate(date)}</strong></p>
            </div>
          </div>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 text-sm font-semibold w-full sm:max-w-xs" />
        </CardContent>
      </Card>

      {/* ── Dual-Column Ledger Table ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 items-start border rounded-xl overflow-hidden shadow-soft bg-white">

        {/* LEFT: Payment Received */}
        <div className="flex flex-col border-r border-border/80 min-h-[520px]">
          {/* Header */}
          <div className="bg-slate-50 border-b border-border/80 px-5 py-2.5 flex justify-between items-center select-none">
            <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <ArrowUpRight className="h-4.5 w-4.5 text-emerald-500 shrink-0" /> Payment Received (Paisa Aaya)
            </h3>
            <div className="flex items-center gap-2">
              <Label htmlFor="opening-cash-input" className="text-[10px] font-bold text-slate-600 uppercase">Opening Cash:</Label>
              <Input
                id="opening-cash-input" type="number" step="any" min="0"
                value={opening} onChange={(e) => setOpening(e.target.value)}
                onBlur={onOpeningBlur}
                className="h-8 w-24 font-bold text-right text-xs text-primary focus-visible:ring-primary"
              />
            </div>
          </div>

          <div className="flex-1 divide-y divide-slate-100 text-xs">
            {/* Home Delivery */}
            {agg.homeTotal > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40">
                <span className="font-semibold text-slate-600">14 KG Home Delivery Sales <span className="text-slate-400 font-normal">({agg.homeQty} units)</span></span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(agg.homeTotal)}</span>
              </div>
            )}

            {/* CNC */}
            {agg.cncTotal > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40">
                <span className="font-semibold text-slate-600">14 KG CNC Sales <span className="text-slate-400 font-normal">({agg.cncQty} units)</span></span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(agg.cncTotal)}</span>
              </div>
            )}

            {/* Other Products */}
            {Object.entries(agg.productSalesTotals).map(([pName, stats]) => (
              <div key={pName} className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40">
                <span className="font-semibold text-slate-600">{pName} Sales <span className="text-slate-400 font-normal">({stats.quantity} units)</span></span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(stats.total)}</span>
              </div>
            ))}

            {/* Collections */}
            {agg.collectionsTotal > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40">
                <span className="font-semibold text-slate-600">Outstanding Customer Collections <span className="text-slate-400 font-normal">(Credit Recovery)</span></span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(agg.collectionsTotal)}</span>
              </div>
            )}

            {/* Other Manual Inflows (misc) */}
            {otherReceiptsList.map((item) => (
              <div key={item.id} className="px-5 py-3 flex justify-between items-center hover:bg-slate-50/40 group">
                <span className="font-semibold text-slate-600 flex items-center gap-1.5">
                  {item.particular}
                  <button type="button" onClick={() => deleteOtherReceipt(item.id)}
                    className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 font-bold ml-1.5 text-[10px]" title="Delete">✕</button>
                </span>
                <span className="font-bold tabular-nums text-emerald-600 text-sm">{fmtCurrency(item.amount)}</span>
              </div>
            ))}

            {/* Payment Inflows (from dedicated page) */}
            {paymentInflows.map((item) => (
              <div key={item.id} className="px-5 py-3 flex justify-between items-center hover:bg-slate-50/40 group">
                <span className="font-semibold text-slate-600 flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase bg-blue-100 text-blue-700 px-1 rounded">Inflow</span>
                  {item.particular}
                </span>
                <span className="font-bold tabular-nums text-emerald-600 text-sm">{fmtCurrency(item.amount)}</span>
              </div>
            ))}

            {/* Pending Bills */}
            {pendingBills.map((b) => (
              <div key={b.id} className="px-5 py-3 flex justify-between items-center hover:bg-slate-50/40 group">
                <span className="font-semibold text-slate-600 flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase bg-amber-100 text-amber-700 px-1 rounded">Pending</span>
                  {b.label}
                  <span className="text-slate-400 font-normal">({b.qty} × ₹{b.rate})</span>
                  <button type="button" onClick={() => deletePendingBill(b.id)}
                    className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 font-bold ml-1.5 text-[10px]" title="Delete">✕</button>
                </span>
                <span className="font-bold tabular-nums text-emerald-600 text-sm">{fmtCurrency(b.amount)}</span>
              </div>
            ))}

            {dailySales.length === 0 && otherReceiptsList.length === 0 && pendingBills.length === 0 && (
              <div className="p-8 text-center text-muted-foreground italic text-[11px]">No transactions received today.</div>
            )}
          </div>

          {/* Left action buttons */}
          <div className="border-t border-border/80 px-5 py-3 flex gap-2">
            <Button type="button" size="sm" variant="outline"
              onClick={() => setIsReceiptOpen(true)}
              className="h-8 text-xs font-semibold text-emerald-700 border-emerald-200 hover:bg-emerald-50 gap-1">
              <Plus className="h-3.5 w-3.5" /> Other Inflow
            </Button>
            <Button type="button" size="sm" variant="outline"
              onClick={() => setIsPendingOpen(true)}
              className="h-8 text-xs font-semibold text-amber-700 border-amber-200 hover:bg-amber-50 gap-1">
              <Plus className="h-3.5 w-3.5" /> Pending Bill
            </Button>
          </div>
        </div>

        {/* RIGHT: Money Paid */}
        <div className="flex flex-col min-h-[520px]">
          <div className="bg-slate-50 border-b border-border/80 px-5 py-3.5 flex justify-between items-center select-none">
            <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <ArrowDownRight className="h-4.5 w-4.5 text-red-500 shrink-0" /> Money Paid (Paisa Gaya)
            </h3>
            <span className="text-xs font-black text-slate-400">₹ INR</span>
          </div>

          <div className="flex-1 divide-y divide-slate-100 text-xs">
            {/* Expenses */}
            {dailyExpenses.map((exp) => {
              let cat = exp.category, note = exp.notes ?? "";
              if (note.startsWith("[OTHER_CAT:")) {
                const m = note.match(/^\[OTHER_CAT:([^\]]+)\]/);
                if (m) { cat = m[1]; note = note.replace(/^\[OTHER_CAT:[^\]]+\]\s*/, ""); }
              }
              return (
                <div key={exp.id} className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40">
                  <span className="font-semibold text-slate-600 capitalize">{cat.replace("_", " ")}{note ? ` (${note})` : ""}</span>
                  <span className="font-bold tabular-nums text-red-600 text-sm">{fmtCurrency(Number(exp.amount))}</span>
                </div>
              );
            })}

            {/* Paytm */}
            {agg.paytmOutflow > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40">
                <span className="font-semibold text-slate-600">Paytm Digital Account <span className="text-slate-400 font-normal">(Sales + Recovery)</span></span>
                <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(agg.paytmOutflow)}</span>
              </div>
            )}

            {/* Website Prepaid (renamed, with per-delivery-boy breakdown) */}
            {agg.onlineOutflow > 0 && (
              <div className="px-5 py-3 flex flex-col hover:bg-slate-50/40">
                <div className="flex justify-between items-center py-0.5">
                  <span className="font-semibold text-slate-600">Website Prepaid <span className="text-slate-400 font-normal">({agg.onlineQtyTotal} units)</span></span>
                  <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(agg.onlineOutflow)}</span>
                </div>
                <div className="mt-1 pl-3 border-l-2 border-slate-200/80 space-y-0.5 text-[10px] text-slate-500 font-medium">
                  {Object.values(agg.onlineByDriver).map((d) => (
                    <div key={d.name} className="flex justify-between py-0.5">
                      <span>{d.name} <span className="text-slate-400">({d.qty} units)</span></span>
                      <span className="tabular-nums">{fmtCurrency(d.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cheque */}
            {agg.chequeOutflow > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40">
                <span className="font-semibold text-slate-600">Bank Cheque Collections</span>
                <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(agg.chequeOutflow)}</span>
              </div>
            )}

            {/* Udhari with per-customer breakdown */}
            {agg.udhariOutflow > 0 && (
              <div className="px-5 py-3 flex flex-col hover:bg-slate-50/40">
                <div className="flex justify-between items-center py-0.5">
                  <span className="font-semibold text-slate-600">Today's Credit Sales <span className="text-slate-400 font-normal">(Udhari)</span></span>
                  <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(agg.udhariOutflow)}</span>
                </div>
                <div className="mt-1 pl-3 border-l-2 border-slate-200/80 space-y-0.5 text-[10px] text-slate-500 font-medium">
                  {Object.values(agg.udhariByCustomer).map((c) => (
                    <div key={c.name} className="flex justify-between py-0.5">
                      <span>{c.name}</span>
                      <span className="tabular-nums">{fmtCurrency(c.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Commission with qty per driver */}
            {agg.commissionsTotal > 0 && (
              <div className="px-5 py-3 flex flex-col hover:bg-slate-50/40">
                <div className="flex justify-between items-center py-0.5">
                  <span className="font-semibold text-slate-600">Route Commission Paid</span>
                  <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(agg.commissionsTotal)}</span>
                </div>
                <div className="mt-1 pl-3 border-l-2 border-slate-200/80 space-y-0.5 text-[10px] text-slate-500 font-medium">
                  {Object.values(agg.commissionByDriver).map((d) => (
                    <div key={d.name} className="flex justify-between py-0.5">
                      <span>{d.name} <span className="text-slate-400">({d.qty} units)</span></span>
                      <span className="tabular-nums">{fmtCurrency(d.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment Outflows (from dedicated page) */}
            {paymentOutflows.map((item) => (
              <div key={item.id} className="px-5 py-3 flex justify-between items-center hover:bg-slate-50/40 group">
                <span className="font-semibold text-slate-600 flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase bg-orange-100 text-orange-700 px-1 rounded">Outflow</span>
                  {item.particular}
                </span>
                <span className="font-bold tabular-nums text-red-600 text-sm">{fmtCurrency(item.amount)}</span>
              </div>
            ))}

            {/* Magil Bills */}
            {magilBills.map((b) => (
              <div key={b.id} className="px-5 py-3 flex justify-between items-center hover:bg-slate-50/40 group">
                <span className="font-semibold text-slate-600 flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase bg-purple-100 text-purple-700 px-1 rounded">Magil</span>
                  {b.label}
                  <span className="text-slate-400 font-normal">({b.qty} × ₹{b.rate})</span>
                  <button type="button" onClick={() => deleteMagilBill(b.id)}
                    className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 font-bold ml-1.5 text-[10px]" title="Delete">✕</button>
                </span>
                <span className="font-bold tabular-nums text-red-600 text-sm">{fmtCurrency(b.amount)}</span>
              </div>
            ))}

            {dailyExpenses.length === 0 && agg.totalOutflows === 0 && (
              <div className="p-8 text-center text-muted-foreground italic text-[11px]">No payments recorded today.</div>
            )}
          </div>

          {/* Right action buttons */}
          <div className="border-t border-border/80 px-5 py-3 flex gap-2">
            <Button type="button" size="sm" variant="outline"
              onClick={() => setIsMagilOpen(true)}
              className="h-8 text-xs font-semibold text-purple-700 border-purple-200 hover:bg-purple-50 gap-1">
              <Plus className="h-3.5 w-3.5" /> Magil Bill
            </Button>
          </div>

          {/* Right Footer: Total Outflow (blue) + Cash Balance (green) */}
          <div className="mt-auto border-t border-border/80 select-none">
            <div className="bg-blue-50 border-b border-blue-100 px-5 py-3 flex justify-between items-center">
              <span className="text-xs font-extrabold uppercase tracking-wider text-blue-700">Total Paid Outflow</span>
              <span className="tabular-nums font-black text-sm text-blue-700">{fmtCurrency(agg.totalOutflows)}</span>
            </div>
            <div className="bg-emerald-50 px-5 py-4 flex justify-between items-center">
              <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-700">Calculated Cash Balance</span>
              <span className="tabular-nums font-black text-base text-emerald-600">{fmtCurrency(agg.cashBalance)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Manual Cash Entry + Difference ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border shadow-soft">
          <CardContent className="p-4 space-y-2">
            <Label className="text-xs font-bold uppercase text-slate-600">Manual Cash Count (Physical Cash in Hand)</Label>
            <Input
              type="number" step="any" placeholder="Enter manual cash count..."
              value={manualCashEntry}
              onChange={(e) => setManualCashEntry(e.target.value)}
              onBlur={onManualBlur}
              className="h-11 font-bold text-slate-800 text-base"
            />
          </CardContent>
        </Card>

        <Card className={`border shadow-soft ${agg.cashDifference === null ? "bg-slate-50" : Math.abs(agg.cashDifference) < 0.01 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-300"}`}>
          <CardContent className="p-4 space-y-1">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
              {agg.cashDifference === null ? "Difference (Calculated − Manual)" : Math.abs(agg.cashDifference) < 0.01 ? "✅ Balanced" : "⚠️ Cash Difference"}
            </div>
            {agg.cashDifference === null ? (
              <div className="text-sm text-muted-foreground italic">Enter manual cash count to see difference</div>
            ) : (
              <>
                <div className={`text-2xl font-black tabular-nums mt-1 ${Math.abs(agg.cashDifference) < 0.01 ? "text-emerald-600" : "text-red-600"}`}>
                  {fmtCurrency(agg.cashDifference)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {Math.abs(agg.cashDifference) < 0.01 ? "Cashbook is perfectly balanced." :
                    agg.cashDifference > 0 ? `Excess: ₹${agg.cashDifference.toFixed(2)} more than counted` : `Short: ₹${Math.abs(agg.cashDifference).toFixed(2)} less than calculated`}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Daily Note ── */}
      <Card className="border shadow-soft">
        <CardContent className="p-4 space-y-2">
          <Label className="text-xs font-bold uppercase text-slate-600 flex items-center gap-1.5">
            <StickyNote className="h-3.5 w-3.5" /> Daily Note (optional)
          </Label>
          <Textarea
            placeholder="Add any daily notes, remarks, or observations here..."
            value={dailyNote}
            onChange={(e) => setDailyNote(e.target.value)}
            onBlur={onNoteBlur}
            rows={3}
            className="resize-none text-sm"
          />
        </CardContent>
      </Card>

      {/* ── Bottom Summary ── */}
      <Card className="shadow-card border bg-slate-50/50">
        <CardContent className="p-6">
          <h3 className="font-bold text-sm uppercase tracking-wider text-slate-800 border-b pb-3 mb-5 flex items-center gap-2 select-none">
            <Sparkles className="h-5 w-5 text-primary shrink-0" /> Daily Cash Book Summary
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center text-center md:text-left">
            <div className="space-y-1">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total Received (Inflows)</span>
              <div className="text-2xl font-black text-emerald-600 tabular-nums">{fmtCurrency(agg.leftGrandTotal)}</div>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total Paid (Outflows)</span>
              <div className="text-2xl font-black text-red-600 tabular-nums">{fmtCurrency(agg.totalOutflows)}</div>
            </div>
            <div className="space-y-1 bg-emerald-50 p-4 rounded-xl border border-emerald-200">
              <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Closing Cash Balance</span>
              <div className="text-2xl font-black text-emerald-600 tabular-nums mt-0.5">{fmtCurrency(agg.cashBalance)}</div>
            </div>
            <div className="flex md:justify-end mt-4 md:mt-0 md:col-span-3 border-t pt-4">
              <Button onClick={saveCashBook} disabled={busy} className="h-11 shadow-sm font-bold uppercase tracking-wider text-xs px-6">
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Cash Book for Today
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Dialogs ── */}

      {/* Other Inflow */}
      <Dialog open={isReceiptOpen} onOpenChange={setIsReceiptOpen}>
        <DialogContent className="max-w-sm bg-white rounded-2xl shadow-xl p-6">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-lg font-bold">💰 Record Miscellaneous Inflow</DialogTitle></DialogHeader>
          <form onSubmit={addOtherReceipt} className="space-y-4 mt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Particular / Description</Label>
              <Input required value={receiptParticular} onChange={(e) => setReceiptParticular(e.target.value)} placeholder="Name change, Udhari cash receipt..." className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Amount (₹)</Label>
              <Input required type="number" step="any" min="0.01" value={receiptAmount} onChange={(e) => setReceiptAmount(e.target.value)} placeholder="0.00" className="h-11 font-bold" />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsReceiptOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-11">Record Payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Pending Bill */}
      <Dialog open={isPendingOpen} onOpenChange={setIsPendingOpen}>
        <DialogContent className="max-w-sm bg-white rounded-2xl shadow-xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">📋 Add Pending Bill</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">Pending = Qty × Rate → added to Payment Received</p>
          </DialogHeader>
          <form onSubmit={addPendingBill} className="space-y-4 mt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Description / Label</Label>
              <Input required value={pendingLabel} onChange={(e) => setPendingLabel(e.target.value)} placeholder="e.g. Pending cylinders" className="h-11" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground uppercase">Qty</Label>
                <Input required type="number" step="any" min="1" value={pendingQty} onChange={(e) => setPendingQty(e.target.value)} placeholder="0" className="h-11 font-bold" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground uppercase">Rate (₹)</Label>
                <Input required type="number" step="any" min="0.01" value={pendingRate} onChange={(e) => setPendingRate(e.target.value)} placeholder="0.00" className="h-11 font-bold" />
              </div>
            </div>
            {pendingQty && pendingRate && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <div className="text-xs text-amber-700 font-bold uppercase">Pending Amount</div>
                <div className="text-xl font-black text-amber-700 mt-0.5">{fmtCurrency(Number(pendingQty) * Number(pendingRate))}</div>
              </div>
            )}
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsPendingOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-amber-600 hover:bg-amber-500 text-white font-bold h-11">Add Pending Bill</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Magil Bill */}
      <Dialog open={isMagilOpen} onOpenChange={setIsMagilOpen}>
        <DialogContent className="max-w-sm bg-white rounded-2xl shadow-xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">🧾 Add Magil Bill</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">Magil = Qty × Rate → added to Money Paid</p>
          </DialogHeader>
          <form onSubmit={addMagilBill} className="space-y-4 mt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Description / Label</Label>
              <Input required value={magilLabel} onChange={(e) => setMagilLabel(e.target.value)} placeholder="e.g. Magil cylinders" className="h-11" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground uppercase">Qty</Label>
                <Input required type="number" step="any" min="1" value={magilQty} onChange={(e) => setMagilQty(e.target.value)} placeholder="0" className="h-11 font-bold" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground uppercase">Rate (₹)</Label>
                <Input required type="number" step="any" min="0.01" value={magilRate} onChange={(e) => setMagilRate(e.target.value)} placeholder="0.00" className="h-11 font-bold" />
              </div>
            </div>
            {magilQty && magilRate && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-center">
                <div className="text-xs text-purple-700 font-bold uppercase">Magil Bill Amount</div>
                <div className="text-xl font-black text-purple-700 mt-0.5">{fmtCurrency(Number(magilQty) * Number(magilRate))}</div>
              </div>
            )}
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsMagilOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white font-bold h-11">Add Magil Bill</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}
