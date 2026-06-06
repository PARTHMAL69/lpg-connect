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
  Sparkles, Plus, Loader2, Calendar, StickyNote,
} from "lucide-react";
import * as XLSXStyle from "xlsx-js-style";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/cashbook")({ component: () => <RequireAgencyUser><Page /></RequireAgencyUser> });

/* ─── Interfaces ─── */
interface CashSaleItem {
  id: string;
  customer_name: string | null;
  product_name: string;
  quantity: number;
  rate: number;
  total: number;
  gross_amount: number;
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
  delivery_boy_id?: string | null;
  delivery_boy?: { name: string } | null;
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
  const [outstandingEntries, setOutstandingEntries] = useState<any[]>([]);

  // DB records
  const [dailySales, setDailySales] = useState<CashSaleItem[]>([]);
  const [dailyPayments, setDailyPayments] = useState<CashPaymentItem[]>([]);
  const [dailyExpenses, setDailyExpenses] = useState<CashExpenseItem[]>([]);

  // Dialog states

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
      outstanding_entries: outstandingEntries,
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
          setOutstandingEntries(Array.isArray(m.outstanding_entries) ? m.outstanding_entries : []);
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
      setPaymentInflows([]); setPaymentOutflows([]); setOutstandingEntries([]);
      setManualCashEntry(""); setDailyNote("");
    }

    // Sales
    const { data: sData } = await supabase
      .from("sales")
      .select(`id, quantity, rate, gross_amount, commission_amount, payment_mode, notes,
        customer:customers(name), product:products(name),
        delivery_boy:delivery_boys(name), delivery_boy_id`)
      .eq("agency_id", agency.id).eq("sale_date", date).eq("is_deleted", false);

    setDailySales(((sData ?? []) as any[]).map((s) => {
      let pm = s.payment_mode?.toLowerCase() || "cash";
      let prepQty = 0;
      try {
        const m = JSON.parse(s.notes ?? "{}");
        if (m.is_cheque) pm = "cheque";
        if (m.website_prepaid_qty != null) {
          prepQty = Number(m.website_prepaid_qty);
        }
      } catch (_) {}
      const quantity = Number(s.quantity);
      const rate = Number(s.rate || 0);
      const grossAmount = quantity * rate;
      return {
        id: s.id,
        customer_name: s.customer?.name ?? "Walk-in",
        product_name: s.product?.name ?? "Cylinder",
        quantity,
        rate,
        total: grossAmount,
        gross_amount: grossAmount,
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
      payment_mode: p.remarks?.startsWith("[CHEQUE]") ? "cheque" : (p.mode?.toLowerCase() || "cash"),
    })));

    // Expenses
    const { data: eData } = await (supabase.from("expenses") as any)
      .select("id, category, amount, notes, delivery_boy_id, delivery_boy:delivery_boys(name)")
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

    // Per-delivery-boy for commission, online, and prepaid website orders
    const commissionByDriver: Record<string, { name: string; amount: number; qty: number }> = {};
    const onlineByDriver: Record<string, { name: string; qty: number; amount: number }> = {};
    let onlineQtyTotal = 0;
    const prepByDriver: Record<string, { name: string; qty: number; amount: number }> = {};
    let prepQtyTotal = 0;

    // Per-customer udhari
    const udhariByCustomer: Record<string, { name: string; amount: number }> = {};

    dailySales.forEach((s) => {
      const nl = s.product_name.toLowerCase();
      const isMain = nl.includes("14.2") || nl.includes("14 kg") || nl.includes("domestic") || nl.includes("cylinder") || nl === "lpg" || nl === "gas";
      const isHome = nl.includes("home") || nl.includes("delivery") || (!!s.delivery_boy_id && !nl.includes("cnc"));
      const isCNC = !isHome;

      // Parse notes JSON
      let isSplit = false;
      let onlineAmt = 0;
      let creditAmt = 0;
      let prepQty = 0;
      try {
        const m = JSON.parse(s.notes ?? "{}");
        if (m.is_split) {
          isSplit = true;
          onlineAmt = Number(m.online_amount || 0);
          creditAmt = Number(m.credit_amount || 0);
        }
        if (m.website_prepaid_qty != null) {
          prepQty = Number(m.website_prepaid_qty);
        }
      } catch (_) {}


      // LEFT side always records the FULL sale (full qty × rate).
      // RIGHT side (prepaid, UPI, cheque, udhari) handles the non-cash breakdown.
      // Balance = leftTotal − rightNonCash = actual cash in hand.
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

      // 1. Website Prepaid (govt website prepaid orders)
      if (prepQty > 0) {
        const prepAmt = prepQty * Number(s.rate);
        const dbKey = s.delivery_boy_name ?? "Counter / Walk-in";
        if (!prepByDriver[dbKey]) prepByDriver[dbKey] = { name: dbKey, qty: 0, amount: 0 };
        prepByDriver[dbKey].qty += prepQty;
        prepByDriver[dbKey].amount += prepAmt;
        prepQtyTotal += prepQty;
      }

      // 2. UPI (online UPI or paytm) - Group both legacy online/paytm payments here. Labeled simply as UPI.
      const isOnlineOrPaytmSale = !isSplit && (s.payment_mode === "online" || s.payment_mode === "paytm");
      const effectiveOnline = isSplit ? onlineAmt : (isOnlineOrPaytmSale ? (s.gross_amount - s.commission_total) : 0);
      if (effectiveOnline > 0) {
        const qrQty = isSplit ? 0 : s.quantity; // do NOT add qty for split payment
        const dbKey = s.delivery_boy_name ?? "Counter / Walk-in";
        if (!onlineByDriver[dbKey]) onlineByDriver[dbKey] = { name: dbKey, qty: 0, amount: 0 };
        onlineByDriver[dbKey].qty += qrQty;
        onlineByDriver[dbKey].amount += effectiveOnline;
        onlineQtyTotal += qrQty;
      }

      // Udhari per customer
      const effectiveCredit = isSplit ? creditAmt : (s.payment_mode === "credit" ? (s.gross_amount - s.commission_total) : 0);
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

    // Mode outflows from sales (net of delivery boy commission for cashbook balance adjustments)
    const prepSales = Object.values(prepByDriver).reduce((s, d) => s + d.amount, 0);
    const upiSales = Object.values(onlineByDriver).reduce((s, d) => s + d.amount, 0);
    const chequeSales = dailySales.filter(s => s.payment_mode === "cheque").reduce((a, r) => a + (r.gross_amount - r.commission_total), 0);
    const udhariSales = Object.values(udhariByCustomer).reduce((s, c) => s + c.amount, 0);

    const paytmRecoveries = dailyPayments.filter(p => p.payment_mode === "paytm").reduce((a, r) => a + r.amount, 0);
    const onlineRecoveries = dailyPayments.filter(p => p.payment_mode === "online").reduce((a, r) => a + r.amount, 0);
    const chequeRecoveries = dailyPayments.filter(p => p.payment_mode === "cheque").reduce((a, r) => a + r.amount, 0);

    const prepOutflow = prepSales;
    const upiOutflow = upiSales + paytmRecoveries + onlineRecoveries;
    const chequeOutflow = chequeSales + chequeRecoveries;
    const udhariOutflow = udhariSales;

    const otherProductSalesSum = Object.values(productSalesTotals).reduce((s, r) => s + r.total, 0);
    const leftGrandTotal = openingCash + homeTotal + cncTotal + otherProductSalesSum + collectionsTotal + otherInflowsSum + pendingBillsTotal + paymentInflowsTotal;

    const expensesTotal = dailyExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const commissionsTotal = Object.values(commissionByDriver).reduce((s, d) => s + d.amount, 0);
    const magilBillsTotal = magilBills.reduce((s, b) => s + b.amount, 0);
    const paymentOutflowsTotal = paymentOutflows.reduce((s, p) => s + p.amount, 0);
    const outstandingTotal = outstandingEntries.reduce((s, o) => s + o.amount, 0);

    const totalOutflows = expensesTotal + prepOutflow + upiOutflow + chequeOutflow + udhariOutflow + commissionsTotal + magilBillsTotal + paymentOutflowsTotal + outstandingTotal;
    const cashBalance = leftGrandTotal - totalOutflows;
    const manualNum = manualCashEntry === "" ? null : Number(manualCashEntry);
    const cashDifference = manualNum != null ? manualNum - Math.abs(cashBalance) : null;

    return {
      openingCash, homeTotal, homeQty, cncTotal, cncQty,
      productSalesTotals, collectionsTotal, otherInflowsSum,
      pendingBillsTotal, paymentInflowsTotal,
      leftGrandTotal, expensesTotal, commissionsTotal,
      commissionByDriver, onlineByDriver, onlineQtyTotal,
      prepOutflow, prepByDriver, prepQtyTotal,
      udhariByCustomer, udhariOutflow, upiOutflow,
      chequeOutflow, magilBillsTotal, paymentOutflowsTotal,
      outstandingTotal, outstandingEntries,
      totalOutflows, cashBalance, cashDifference,
    };
  }, [dailySales, dailyPayments, dailyExpenses, opening, manualCashEntry,
    otherReceiptsList, pendingBills, magilBills, paymentInflows, paymentOutflows, outstandingEntries]);

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
      outstanding_entries: outstandingEntries,
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
    if (!qty || !rate) { toast.error("Please enter quantity and rate."); return; }
    const label = pendingLabel.trim() || "Pending Bill";
    const item: BillItem = { id: newId(), label, qty, rate, amount: qty * rate };
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
    if (!qty || !rate) { toast.error("Please enter quantity and rate."); return; }
    const label = magilLabel.trim() || "Magil Bill";
    const item: BillItem = { id: newId(), label, qty, rate, amount: qty * rate };
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

  /* ─── Professional Excel Export (colorful, side-by-side, equal rows, bordered) ─── */
  const doExcelExport = () => {
    const wb = XLSXStyle.utils.book_new();
    const ws: any = {};

    // ── Color palette ──
    const C = {
      titleBg:   "1A3C5E",   // dark navy
      titleFg:   "FFFFFF",
      hdrBg:     "2E75B6",   // blue
      hdrFg:     "FFFFFF",
      totRecBg:  "1F7A4D",   // dark green
      totRecFg:  "FFFFFF",
      totPaidBg: "1F7A4D",
      totPaidFg: "FFFFFF",
      sumHdrBg:  "1A3C5E",
      sumHdrFg:  "FFFFFF",
      sumBalBg:  "C6EFCE",   // light green
      sumBalFg:  "375623",
      sumBalYelBg: "FFF2CC", // light yellow
      sumBalYelFg: "7F6000", // dark yellow
      sumDiffBg: "FFC7CE",   // light red
      sumDiffFg: "9C0006",
      altRowBg:  "EBF3FB",   // very light blue
      subRowBg:  "F5F5F5",
      borderCol: "BFBFBF",
    };

    const border = {
      top:    { style: "thin", color: { rgb: C.borderCol } },
      bottom: { style: "thin", color: { rgb: C.borderCol } },
      left:   { style: "thin", color: { rgb: C.borderCol } },
      right:  { style: "thin", color: { rgb: C.borderCol } },
    };

    const thickBorder = {
      top:    { style: "medium", color: { rgb: "1A3C5E" } },
      bottom: { style: "medium", color: { rgb: "1A3C5E" } },
      left:   { style: "medium", color: { rgb: "1A3C5E" } },
      right:  { style: "medium", color: { rgb: "1A3C5E" } },
    };

    // Helper: write a styled cell
    const W = (
      row: number, col: number, v: any,
      opts: {
        bold?: boolean; italic?: boolean; sz?: number;
        fg?: string; bg?: string; align?: string;
        border?: any; numFmt?: string; color?: string;
      } = {}
    ) => {
      const addr = XLSXStyle.utils.encode_cell({ r: row, c: col });
      const isNum = typeof v === "number";
      ws[addr] = {
        v,
        t: isNum ? "n" : "s",
        s: {
          font: {
            bold: opts.bold ?? false,
            italic: opts.italic ?? false,
            sz: opts.sz ?? 10,
            color: { rgb: opts.fg ?? opts.color ?? "000000" },
            name: "Calibri",
          },
          fill: opts.bg ? { fgColor: { rgb: opts.bg }, patternType: "solid" } : undefined,
          alignment: {
            horizontal: opts.align ?? (isNum ? "right" : "left"),
            vertical: "center",
            wrapText: false,
          },
          border: opts.border ?? border,
          numFmt: opts.numFmt ?? (isNum ? "#,##0.00" : "@"),
        },
      };
    };

    // Helper: blank bordered cell
    const BLANK = (row: number, col: number, bg?: string) => {
      const addr = XLSXStyle.utils.encode_cell({ r: row, c: col });
      ws[addr] = {
        v: "", t: "s",
        s: {
          fill: bg ? { fgColor: { rgb: bg }, patternType: "solid" } : undefined,
          border,
        },
      };
    };

    let row = 0;

    // ── ROW 0: Title ──
    W(row, 0, `Daily Cash Book — ${fmtDate(date)}`, { bold: true, sz: 13, fg: C.titleFg, bg: C.titleBg, align: "left", border: thickBorder });
    BLANK(row, 1, C.titleBg); BLANK(row, 2, C.titleBg); BLANK(row, 3, C.titleBg);
    W(row, 4, `Agency Cash Report — ${fmtDate(date)}`, { bold: true, sz: 13, fg: C.titleFg, bg: C.titleBg, align: "left", border: thickBorder });
    BLANK(row, 5, C.titleBg); BLANK(row, 6, C.titleBg);
    row++;

    // ── ROW 1: blank separator ──
    for (let c = 0; c < 7; c++) BLANK(row, c);
    row++;

    // ── ROW 2: Column headers ──
    W(row, 0, "PAYMENT RECEIVED", { bold: true, sz: 11, fg: C.hdrFg, bg: C.hdrBg, align: "left", border: thickBorder });
    W(row, 1, "Qty",        { bold: true, sz: 10, fg: C.hdrFg, bg: C.hdrBg, align: "center", border: thickBorder });
    W(row, 2, "Amount (₹)",{ bold: true, sz: 10, fg: C.hdrFg, bg: C.hdrBg, align: "right",  border: thickBorder });
    BLANK(row, 3);
    W(row, 4, "MONEY PAID / OUTFLOW",       { bold: true, sz: 11, fg: C.hdrFg, bg: C.hdrBg, align: "left", border: thickBorder });
    W(row, 5, "Qty",        { bold: true, sz: 10, fg: C.hdrFg, bg: C.hdrBg, align: "center", border: thickBorder });
    W(row, 6, "Amount (₹)",{ bold: true, sz: 10, fg: C.hdrFg, bg: C.hdrBg, align: "right",  border: thickBorder });
    const dataStartRow = row + 1;
    row++;

    // ── Build left & right data arrays ──
    type XRow = { label: string; qty: number | ""; amt: number; sub?: boolean };
    const left: XRow[] = [];
    const right: XRow[] = [];

    // LEFT side
    left.push({ label: "Opening Cash Balance", qty: "", amt: agg.openingCash });
    Object.entries(agg.productSalesTotals).forEach(([n, s]) => left.push({ label: `${n} Sales`, qty: s.quantity, amt: s.total }));
    if (agg.collectionsTotal > 0) {
      left.push({ label: "Credit Recovery / Outstanding Collections", qty: "", amt: agg.collectionsTotal });
      dailyPayments.forEach(p => left.push({ label: `  - ${p.customer_name} (${p.payment_mode})`, qty: "", amt: p.amount, sub: true }));
    }

    otherReceiptsList.forEach(r => left.push({ label: r.particular, qty: "", amt: r.amount }));
    pendingBills.forEach(b => left.push({ label: `Pending — ${b.label} (${b.qty}×₹${b.rate})`, qty: b.qty, amt: b.amount }));
    paymentInflows.forEach(p => left.push({ label: p.particular + ((p as any).note ? ` (${(p as any).note})` : ""), qty: "", amt: p.amount }));
    if (agg.homeTotal > 0) left.push({ label: "14 KG Home Delivery Sales", qty: agg.homeQty, amt: agg.homeTotal });
    if (agg.cncTotal > 0)  left.push({ label: "14 KG CNC Sales",           qty: agg.cncQty,  amt: agg.cncTotal });

    // RIGHT side (NO Calculated Cash Balance)
    // 1. Expenses (single entry)
    dailyExpenses.forEach(e => {
      let cat = e.category, note = e.notes ?? "";
      let workerName = "";
      if (note.startsWith("[OTHER_CAT:")) {
        const m = note.match(/^\[OTHER_CAT:([^\]]+)\]/);
        if (m) { cat = m[1]; note = note.replace(/^\[OTHER_CAT:[^\]]+\]\s*/, ""); }
      }
      if (e.delivery_boy?.name) {
        workerName = e.delivery_boy.name;
      } else if (note.startsWith("[WORKER:")) {
        const m = note.match(/^\[WORKER:([^\]]+)\]/);
        if (m) { workerName = m[1]; }
      }
      if (note.startsWith("[WORKER:")) {
        note = note.replace(/^\[WORKER:[^\]]+\]\s*/, "");
      }
      const label = workerName ? `${cat.replace("_", " ")} (${workerName})` : cat.replace("_", " ");
      right.push({ label: `${label}${note ? ` (${note})` : ""}`, qty: "", amt: Number(e.amount) });
    });

    // 2. Payment Outflows (single entry)
    paymentOutflows.forEach(p => right.push({ label: p.particular + ((p as any).note ? ` (${(p as any).note})` : ""), qty: "", amt: p.amount }));

    // 3. Magil Bills (single entry)
    magilBills.forEach(b => right.push({ label: `Magil — ${b.label} (${b.qty}×₹${b.rate})`, qty: b.qty, amt: b.amount }));

    // 4. Cheque (group)
    if (agg.chequeOutflow > 0) right.push({ label: "Cheque", qty: "", amt: agg.chequeOutflow });

    // 5. Udhari (group)
    if (agg.udhariOutflow > 0) {
      right.push({ label: "Udhari", qty: "", amt: agg.udhariOutflow });
      Object.values(agg.udhariByCustomer).forEach(c => right.push({ label: `  - ${c.name}`, qty: "", amt: c.amount, sub: true }));
    }

    // 6. Outstanding (group)
    if (agg.outstandingTotal > 0) {
      right.push({ label: "Outstanding (Loans/Udhari Given)", qty: "", amt: agg.outstandingTotal });
      agg.outstandingEntries.forEach(o => right.push({ label: `  - ${o.customer_name}${o.note ? ` (${o.note})` : ""}`, qty: "", amt: o.amount, sub: true }));
    }

    // 7. UPI / Paytm (group)
    if (agg.upiOutflow > 0) {
      right.push({ label: "UPI / Paytm", qty: agg.onlineQtyTotal, amt: agg.upiOutflow });
      Object.values(agg.onlineByDriver).forEach(d => right.push({ label: `  - ${d.name}`, qty: d.qty, amt: d.amount, sub: true }));
    }

    // 8. Website Prepaid (group)
    if (agg.prepQtyTotal > 0) {
      right.push({ label: "Website Prepaid", qty: agg.prepQtyTotal, amt: agg.prepOutflow });
      Object.values(agg.prepByDriver).forEach(d => right.push({ label: `  - ${d.name}`, qty: d.qty, amt: d.amount, sub: true }));
    }

    // 9. Route Commission Paid (group)
    if (agg.commissionsTotal > 0) {
      right.push({ label: "Route Commission Paid", qty: "", amt: agg.commissionsTotal });
      Object.values(agg.commissionByDriver).forEach(d => right.push({ label: `  - ${d.name}`, qty: d.qty, amt: d.amount, sub: true }));
    }

    // Pad both sides to equal length (leaving space for the TOTAL row)
    const maxData = Math.max(left.length, right.length);
    while (left.length  < maxData) left.push({ label: "", qty: "", amt: 0 });
    while (right.length < maxData) right.push({ label: "", qty: "", amt: 0 });

    // Write data rows (alternating row colors)
    for (let i = 0; i < maxData; i++) {
      const l = left[i];
      const r2 = right[i];
      const isAlt = i % 2 === 1;
      const rowBg = isAlt ? C.altRowBg : undefined;

      // LEFT
      if (l.label) {
        const subBg = l.sub ? C.subRowBg : rowBg;
        W(row, 0, l.label, { italic: l.sub, bg: subBg });
        if (l.qty !== "") W(row, 1, l.qty, { align: "center", bg: subBg });
        else BLANK(row, 1, subBg);
        W(row, 2, l.amt || 0, { bg: subBg });
      } else {
        BLANK(row, 0, rowBg); BLANK(row, 1, rowBg); BLANK(row, 2, rowBg);
      }

      BLANK(row, 3); // spacer

      // RIGHT
      if (r2.label) {
        const subBg = r2.sub ? C.subRowBg : rowBg;
        W(row, 4, r2.label, { italic: r2.sub, bg: subBg });
        if (r2.qty !== "") W(row, 5, r2.qty, { align: "center", bg: subBg });
        else BLANK(row, 5, subBg);
        W(row, 6, r2.amt || 0, { bg: subBg });
      } else {
        BLANK(row, 4, rowBg); BLANK(row, 5, rowBg); BLANK(row, 6, rowBg);
      }

      row++;
    }

    // ── TOTAL ROW ──
    W(row, 0, "TOTAL RECEIVED", { bold: true, sz: 11, fg: C.totRecFg, bg: C.totRecBg, border: thickBorder });
    BLANK(row, 1, C.totRecBg);
    W(row, 2, agg.leftGrandTotal, { bold: true, sz: 11, fg: C.totRecFg, bg: C.totRecBg, border: thickBorder });
    BLANK(row, 3);
    W(row, 4, "TOTAL PAID OUTFLOW", { bold: true, sz: 11, fg: C.totPaidFg, bg: C.totPaidBg, border: thickBorder });
    BLANK(row, 5, C.totPaidBg);
    W(row, 6, agg.totalOutflows, { bold: true, sz: 11, fg: C.totPaidFg, bg: C.totPaidBg, border: thickBorder });
    row++;

    // blank spacer
    for (let c = 0; c < 7; c++) BLANK(row, c);
    row++;

    // ── SUMMARY SECTION ──
    W(row, 0, "SUMMARY", { bold: true, sz: 11, fg: C.sumHdrFg, bg: C.sumHdrBg, border: thickBorder });
    for (let c = 1; c < 7; c++) BLANK(row, c, C.sumHdrBg);
    row++;

    // Summary rows
    W(row, 0, "Total Received (Inflows)", { bold: false });
    BLANK(row, 1); W(row, 2, agg.leftGrandTotal, { bold: true }); row++;

    W(row, 0, "Total Paid (Outflows)", { bold: false });
    BLANK(row, 1); W(row, 2, agg.totalOutflows, { bold: true }); row++;

    const isBalZero = agg.cashBalance === 0;
    const isBalPos = agg.cashBalance > 0;
    const balBgExcel = isBalZero ? C.sumBalYelBg : isBalPos ? C.sumBalBg : C.sumDiffBg;
    const balFgExcel = isBalZero ? C.sumBalYelFg : isBalPos ? C.sumBalFg : C.sumDiffFg;
    W(row, 0, "Calculated Cash Balance",  { bold: true, fg: balFgExcel, bg: balBgExcel, border: thickBorder });
    BLANK(row, 1, balBgExcel);
    W(row, 2, agg.cashBalance, { bold: true, fg: balFgExcel, bg: balBgExcel, border: thickBorder });
    row++;

    if (agg.cashDifference !== null) {
      W(row, 0, "Manual Cash Entry (Physical Count)"); BLANK(row, 1); W(row, 2, Number(manualCashEntry)); row++;
      const isBalanced = Math.abs(agg.cashDifference) < 0.01;
      const isSurplus = agg.cashDifference > 0;
      const diffBg = isBalanced ? C.sumBalYelBg : isSurplus ? C.sumBalBg : C.sumDiffBg;
      const diffFg = isBalanced ? C.sumBalYelFg : isSurplus ? C.sumBalFg : C.sumDiffFg;
      const diffLabel = isBalanced ? "Cash Difference (Balanced)" : isSurplus ? "Cash Difference (Surplus)" : "Cash Difference (Shortage)";
      W(row, 0, diffLabel, { bold: true, fg: diffFg, bg: diffBg, border: thickBorder });
      BLANK(row, 1, diffBg);
      W(row, 2, agg.cashDifference, { bold: true, fg: diffFg, bg: diffBg, border: thickBorder });
      row++;
    }

    if (dailyNote.trim()) {
      row++;
      W(row, 0, `Note: ${dailyNote}`, { italic: true, fg: "555555" }); row++;
    }

    // Col widths
    ws["!cols"] = [
      { wch: 40 }, { wch: 7 }, { wch: 15 }, { wch: 2 },
      { wch: 40 }, { wch: 7 }, { wch: 15 },
    ];

    // Row heights (header rows taller)
    ws["!rows"] = Array.from({ length: row + 2 }, (_, i) => ({
      hpt: i === 0 ? 22 : i === 2 ? 18 : 16,
    }));

    ws["!ref"] = XLSXStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row + 1, c: 6 } });

    XLSXStyle.utils.book_append_sheet(wb, ws, "Cash Book");
    XLSXStyle.writeFile(wb, `cashbook_${date}.xlsx`);
  };

  /* ─── Professional PDF Export (two-column, printout quality) ─── */
  const doPdfExport = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as any;
    const PW = 297, PH = 210;
    const ML = 10, MR = 10, MT = 12;
    const colW = (PW - ML - MR - 8) / 2; // width of each column block
    const col2X = ML + colW + 8;           // X start of right column
    const labelW = colW - 22 - 18;        // label portion
    const qtyW = 18, amtW = 22;

    // ── Colors ──
    const NAVY  = [26, 60, 94]  as [number,number,number];
    const BLUE  = [46,117,182]  as [number,number,number];
    const GREEN = [31,122,77]   as [number,number,number];
    const WHITE = [255,255,255] as [number,number,number];
    const LGRAY = [245,245,245] as [number,number,number];
    const LBLU  = [235,243,251] as [number,number,number];
    const LGRN  = [198,239,206] as [number,number,number];
    const LRED  = [255,199,206] as [number,number,number];

    const fillRect = (x: number, y: number, w: number, h: number, rgb: [number,number,number]) => {
      doc.setFillColor(...rgb); doc.rect(x, y, w, h, "F");
    };
    const drawRect = (x: number, y: number, w: number, h: number, rgb: [number,number,number]) => {
      doc.setDrawColor(...rgb); doc.rect(x, y, w, h, "S");
    };
    const text = (s: string, x: number, y: number, opts?: any) => doc.text(s, x, y, opts);

    // ── Page Title ──
    fillRect(ML, MT, PW - ML - MR, 9, NAVY);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...WHITE);
    text(`Daily Cash Book — ${fmtDate(date)}`, ML + 3, MT + 6);
    doc.setFontSize(10);
    text(`Agency Cash Report`, PW - MR - 50, MT + 6);

    let y = MT + 13;

    // ── Column Header Row ──
    const hdrH = 7;
    fillRect(ML, y, colW, hdrH, BLUE);
    fillRect(col2X, y, colW, hdrH, BLUE);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...WHITE);
    text("PAYMENT RECEIVED", ML + 2, y + 5);
    text("Qty",       ML + labelW + 4,       y + 5, { align: "right" });
    text("Amount (₹)",ML + labelW + qtyW + amtW - 1, y + 5, { align: "right" });
    text("MONEY PAID / OUTFLOW", col2X + 2, y + 5);
    text("Qty",       col2X + labelW + 4,       y + 5, { align: "right" });
    text("Amount (₹)",col2X + labelW + qtyW + amtW - 1, y + 5, { align: "right" });
    y += hdrH;

    // ── Build data rows ──
    type PRow = { label: string; qty: string; amt: string; sub?: boolean; isTot?: boolean };
    const lRows: PRow[] = [];
    const rRows: PRow[] = [];
    const fmt = (n: number) => n === 0 && !n ? "" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    lRows.push({ label: "Opening Cash Balance", qty: "", amt: fmt(agg.openingCash) });
    Object.entries(agg.productSalesTotals).forEach(([n, s]) => lRows.push({ label: `${n} Sales`, qty: String(s.quantity), amt: fmt(s.total) }));
    if (agg.collectionsTotal > 0) {
      lRows.push({ label: "Credit Recovery / Outstanding Collections", qty: "", amt: fmt(agg.collectionsTotal) });
      dailyPayments.forEach(p => lRows.push({ label: `  - ${p.customer_name} (${p.payment_mode})`, qty: "", amt: fmt(p.amount), sub: true }));
    }

    otherReceiptsList.forEach(r => lRows.push({ label: r.particular, qty: "", amt: fmt(r.amount) }));
    pendingBills.forEach(b => lRows.push({ label: `Pending — ${b.label} (${b.qty}×₹${b.rate})`, qty: String(b.qty), amt: fmt(b.amount) }));
    paymentInflows.forEach(p => lRows.push({ label: p.particular + ((p as any).note ? ` (${(p as any).note})` : ""), qty: "", amt: fmt(p.amount) }));
    if (agg.homeTotal > 0) lRows.push({ label: "14 KG Home Delivery Sales", qty: String(agg.homeQty), amt: fmt(agg.homeTotal) });
    if (agg.cncTotal > 0)  lRows.push({ label: "14 KG CNC Sales",           qty: String(agg.cncQty),  amt: fmt(agg.cncTotal) });

    dailyExpenses.forEach(e => {
      let cat = e.category, note = e.notes ?? "";
      let workerName = "";
      if (note.startsWith("[OTHER_CAT:")) {
        const m = note.match(/^\[OTHER_CAT:([^\]]+)\]/);
        if (m) { cat = m[1]; note = note.replace(/^\[OTHER_CAT:[^\]]+\]\s*/, ""); }
      }
      if (e.delivery_boy?.name) {
        workerName = e.delivery_boy.name;
      } else if (note.startsWith("[WORKER:")) {
        const m = note.match(/^\[WORKER:([^\]]+)\]/);
        if (m) { workerName = m[1]; }
      }
      if (note.startsWith("[WORKER:")) {
        note = note.replace(/^\[WORKER:[^\]]+\]\s*/, "");
      }
      const label = workerName ? `${cat.replace("_", " ")} (${workerName})` : cat.replace("_", " ");
      rRows.push({ label: `${label}${note ? ` (${note})` : ""}`, qty: "", amt: fmt(Number(e.amount)) });
    });

    // 2. Payment Outflows (single entry)
    paymentOutflows.forEach(p => rRows.push({ label: p.particular + ((p as any).note ? ` (${(p as any).note})` : ""), qty: "", amt: fmt(p.amount) }));

    // 3. Magil Bills (single entry)
    magilBills.forEach(b => rRows.push({ label: `Magil — ${b.label} (${b.qty}×₹${b.rate})`, qty: String(b.qty), amt: fmt(b.amount) }));

    // 4. Cheque (group)
    if (agg.chequeOutflow > 0) rRows.push({ label: "Cheque", qty: "", amt: fmt(agg.chequeOutflow) });

    // 5. Udhari (group)
    if (agg.udhariOutflow > 0) {
      rRows.push({ label: "Udhari", qty: "", amt: fmt(agg.udhariOutflow) });
      Object.values(agg.udhariByCustomer).forEach(c => rRows.push({ label: `  - ${c.name}`, qty: "", amt: fmt(c.amount), sub: true }));
    }

    // 6. Outstanding (group)
    if (agg.outstandingTotal > 0) {
      rRows.push({ label: "Outstanding (Loans/Udhari Given)", qty: "", amt: fmt(agg.outstandingTotal) });
      agg.outstandingEntries.forEach(o => rRows.push({ label: `  - ${o.customer_name}${o.note ? ` (${o.note})` : ""}`, qty: "", amt: fmt(o.amount), sub: true }));
    }

    // 7. UPI / Paytm (group)
    if (agg.upiOutflow > 0) {
      rRows.push({ label: "UPI / Paytm", qty: String(agg.onlineQtyTotal), amt: fmt(agg.upiOutflow) });
      Object.values(agg.onlineByDriver).forEach(d => rRows.push({ label: `  - ${d.name}`, qty: String(d.qty), amt: fmt(d.amount), sub: true }));
    }

    // 8. Website Prepaid (group)
    if (agg.prepQtyTotal > 0) {
      rRows.push({ label: "Website Prepaid", qty: String(agg.prepQtyTotal), amt: fmt(agg.prepOutflow) });
      Object.values(agg.prepByDriver).forEach(d => rRows.push({ label: `  - ${d.name}`, qty: String(d.qty), amt: fmt(d.amount), sub: true }));
    }

    // 9. Route Commission Paid (group)
    if (agg.commissionsTotal > 0) {
      rRows.push({ label: "Route Commission Paid", qty: "", amt: fmt(agg.commissionsTotal) });
      Object.values(agg.commissionByDriver).forEach(d => rRows.push({ label: `  - ${d.name}`, qty: String(d.qty), amt: fmt(d.amount), sub: true }));
    }

    const maxData = Math.max(lRows.length, rRows.length);
    while (lRows.length < maxData) lRows.push({ label: "", qty: "", amt: "" });
    while (rRows.length < maxData) rRows.push({ label: "", qty: "", amt: "" });

    const rowH = 6.2;
    const drawRow = (
      row: PRow, xBase: number, yy: number, alt: boolean
    ) => {
      const bg = row.label === "" ? WHITE : row.sub ? LGRAY : alt ? LBLU : WHITE;
      fillRect(xBase, yy, colW, rowH, bg);
      drawRect( xBase, yy, colW, rowH, [200,200,200]);

      if (!row.label) return;
      doc.setFont("helvetica", row.sub ? "italic" : "normal");
      doc.setFontSize(8); doc.setTextColor(30, 30, 30);
      const lbl = doc.splitTextToSize(row.label, labelW - 2);
      text(lbl[0], xBase + 2, yy + 4);
      if (row.qty) { doc.setFont("helvetica", "normal"); text(row.qty, xBase + labelW + 4, yy + 4, { align: "right" }); }
      if (row.amt) { doc.setFont("helvetica", row.sub ? "italic" : "normal"); text(row.amt, xBase + labelW + qtyW + amtW - 1, yy + 4, { align: "right" }); }
    };

    for (let i = 0; i < maxData; i++) {
      // New page check
      if (y + rowH > PH - 20) {
        doc.addPage();
        y = MT;
        // re-draw mini headers
        fillRect(ML, y, colW, hdrH, BLUE); fillRect(col2X, y, colW, hdrH, BLUE);
        doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...WHITE);
        text("PAYMENT RECEIVED", ML + 2, y + 5);
        text("MONEY PAID / OUTFLOW", col2X + 2, y + 5);
        y += hdrH;
      }
      drawRow(lRows[i], ML,    y, i % 2 === 1);
      drawRow(rRows[i], col2X, y, i % 2 === 1);
      y += rowH;
    }

    // ── Total Row ──
    const totH = 7;
    fillRect(ML,    y, colW, totH, GREEN); drawRect(ML,    y, colW, totH, GREEN);
    fillRect(col2X, y, colW, totH, GREEN); drawRect(col2X, y, colW, totH, GREEN);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...WHITE);
    text("TOTAL RECEIVED",  ML + 2,    y + 5);
    text(fmt(agg.leftGrandTotal), ML + labelW + qtyW + amtW - 1, y + 5, { align: "right" });
    text("TOTAL PAID OUTFLOW", col2X + 2, y + 5);
    text(fmt(agg.totalOutflows), col2X + labelW + qtyW + amtW - 1, y + 5, { align: "right" });
    y += totH + 4;

    // ── Summary Section ──
    if (y + 30 > PH - 10) { doc.addPage(); y = MT; }
    const sw = (PW - ML - MR) / 2; // summary table width
    fillRect(ML, y, sw, 7, NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...WHITE);
    text("DAILY SUMMARY", ML + 3, y + 5); y += 7;

    const sumRow = (label: string, val: string, bg: [number,number,number], bold = false, textColor: [number,number,number] = [30,30,30]) => {
      fillRect(ML, y, sw, 6.5, bg); drawRect(ML, y, sw, 6.5, [180,180,180]);
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(8.5); doc.setTextColor(...textColor);
      text(label, ML + 3, y + 4.5);
      text(val, ML + sw - 3, y + 4.5, { align: "right" });
      y += 6.5;
    };

    sumRow("Total Received (Inflows)",  fmt(agg.leftGrandTotal), WHITE);
    sumRow("Total Paid (Outflows)",     fmt(agg.totalOutflows),  LGRAY);
    const balBg = agg.cashBalance === 0 ? [255,251,230] as [number,number,number] : agg.cashBalance > 0 ? LGRN : LRED;
    const balFg = (agg.cashBalance === 0 ? [212,136,6] : agg.cashBalance > 0 ? [31,122,77] : [156,0,6]) as [number, number, number];
    sumRow("Calculated Cash Balance",   fmt(agg.cashBalance),    balBg, true, balFg);
    if (agg.cashDifference !== null) {
      sumRow("Manual Cash Count",       fmt(Number(manualCashEntry)), WHITE);
      const isBalanced = Math.abs(agg.cashDifference) < 0.01;
      const isSurplus = agg.cashDifference > 0;
      const diffBg = isBalanced ? [255,251,230] as [number,number,number] : isSurplus ? LGRN : LRED;
      const diffFg = (isBalanced ? [212,136,6] : isSurplus ? [31,122,77] : [156,0,6]) as [number, number, number];
      const diffLabel = isBalanced ? "Cash Difference (Balanced)" : isSurplus ? "Cash Difference (Surplus)" : "Cash Difference (Shortage)";
      sumRow(diffLabel, fmt(Math.abs(agg.cashDifference)), diffBg, true, diffFg);
    }
    if (dailyNote.trim()) {
      y += 3;
      doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(80,80,80);
      text(`Note: ${dailyNote}`, ML, y);
    }

    // ── Footer on each page ──
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(140,140,140);
      text(`GasFlow LPG Agency — Confidential`, ML, PH - 5);
      text(`Page ${p} of ${totalPages} | Printed: ${new Date().toLocaleString()}`, PW - MR, PH - 5, { align: "right" });
      doc.setDrawColor(200,200,200); doc.line(ML, PH - 8, PW - MR, PH - 8);
    }

    doc.save(`cashbook_${date}.pdf`);
  };

  const balanceColors = useMemo(() => {
    const bal = agg.cashBalance;
    if (bal > 0) {
      return {
        bg: "bg-emerald-50 border-emerald-200/80",
        text: "text-emerald-600",
        label: "text-emerald-700",
      };
    } else if (bal < 0) {
      return {
        bg: "bg-red-50 border-red-200/80",
        text: "text-red-600",
        label: "text-red-700",
      };
    } else {
      return {
        bg: "bg-amber-50 border-amber-200/80",
        text: "text-amber-600",
        label: "text-amber-700",
      };
    }
  }, [agg.cashBalance]);

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
              <DropdownMenuItem onClick={() => doPdfExport()}><FileText className="h-4 w-4 mr-2 text-primary" />PDF Ledger</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExcelExport()}><FileText className="h-4 w-4 mr-2 text-emerald-600" />Excel (Side-by-Side)</DropdownMenuItem>
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
          <div className="bg-slate-50 border-b border-border/80 px-5 py-3 flex justify-between items-center select-none h-12">
            <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <ArrowUpRight className="h-4.5 w-4.5 text-emerald-500 shrink-0" /> Payment Received
            </h3>
            <span className="text-xs font-black text-slate-400">₹ INR</span>
          </div>

          <div className="flex-1 divide-y divide-slate-100 text-xs">
            {/* Opening Cash Balance (Manual input) */}
            <div className="px-5 py-3 flex justify-between items-center bg-slate-50/40 hover:bg-slate-50/60 transition-colors">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Opening Cash Balance
              </span>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-medium">₹</span>
                <Input
                  id="opening-cash-input" type="number" step="any" min="0"
                  value={opening} onChange={(e) => setOpening(e.target.value)}
                  onBlur={onOpeningBlur}
                  className="h-8 w-28 font-bold text-right text-xs text-primary focus-visible:ring-primary bg-white shadow-soft"
                />
              </div>
            </div>

            {/* Other Products */}
            {Object.entries(agg.productSalesTotals).map(([pName, stats]) => (
              <div key={pName} className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40">
                <span className="font-semibold text-slate-600">{pName} Sales <span className="text-slate-400 font-normal">({stats.quantity} units)</span></span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(stats.total)}</span>
              </div>
            ))}

            {/* Collections */}
            {agg.collectionsTotal > 0 && (
              <div className="px-5 py-3 flex flex-col hover:bg-slate-50/40">
                <div className="flex justify-between items-center py-0.5">
                  <span className="font-semibold text-slate-600">Credit Recovery / Outstanding Collections</span>
                  <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(agg.collectionsTotal)}</span>
                </div>
                <div className="mt-1 pl-3 border-l-2 border-slate-200/80 space-y-0.5 text-[10px] text-slate-500 font-medium">
                  {dailyPayments.map((p) => (
                    <div key={p.id} className="flex justify-between py-0.5">
                      <span>{p.customer_name} <span className="text-slate-400 capitalize">({p.payment_mode})</span></span>
                      <span className="tabular-nums">{fmtCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
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
            {paymentInflows.map((item: any) => (
              <div key={item.id} className="px-5 py-3 flex justify-between items-center hover:bg-slate-50/40 group">
                <span className="font-semibold text-slate-600 flex flex-col gap-0.5 min-w-0">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-black uppercase bg-blue-100 text-blue-700 px-1 rounded shrink-0">Inflow</span>
                    <span className="break-all">{item.particular}</span>
                  </span>
                  {item.note && <span className="text-[10px] text-slate-400 font-normal ml-0 sm:ml-11 break-all">{item.note}</span>}
                </span>
                <span className="font-bold tabular-nums text-emerald-600 text-sm shrink-0 ml-2">{fmtCurrency(item.amount)}</span>
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

            {/* Home Delivery — shown last */}
            {agg.homeTotal > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40">
                <span className="font-semibold text-slate-600">14 KG Home Delivery Sales <span className="text-slate-400 font-normal">({agg.homeQty} units)</span></span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(agg.homeTotal)}</span>
              </div>
            )}

            {/* CNC — shown last */}
            {agg.cncTotal > 0 && (
              <div className="px-5 py-3.5 flex justify-between items-center hover:bg-slate-50/40">
                <span className="font-semibold text-slate-600">14 KG CNC Sales <span className="text-slate-400 font-normal">({agg.cncQty} units)</span></span>
                <span className="font-bold tabular-nums text-slate-800 text-sm">{fmtCurrency(agg.cncTotal)}</span>
              </div>
            )}

            {dailySales.length === 0 && otherReceiptsList.length === 0 && pendingBills.length === 0 && (
              <div className="p-8 text-center text-muted-foreground italic text-[11px]">No transactions received today.</div>
            )}
          </div>

          {/* Left action buttons */}
          <div className="border-t border-border/80 px-5 py-3 flex gap-2">
            <Button type="button" size="sm" variant="outline"
              onClick={() => setIsPendingOpen(true)}
              className="h-8 text-xs font-semibold text-amber-700 border-amber-200 hover:bg-amber-50 gap-1">
              <Plus className="h-3.5 w-3.5" /> Pending Bill
            </Button>
          </div>
        </div>

        {/* RIGHT: Money Paid */}
        <div className="flex flex-col min-h-[520px]">
          <div className="bg-slate-50 border-b border-border/80 px-5 py-3 flex justify-between items-center select-none h-12">
            <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <ArrowDownRight className="h-4.5 w-4.5 text-red-500 shrink-0" /> Money Paid / Outflow
            </h3>
            <span className="text-xs font-black text-slate-400">₹ INR</span>
          </div>

          <div className="flex-1 divide-y divide-slate-100 text-xs">
            {/* Expenses */}
            {dailyExpenses.map((exp) => {
              let cat = exp.category, note = exp.notes ?? "";
              let workerName = "";
              if (note.startsWith("[OTHER_CAT:")) {
                const m = note.match(/^\[OTHER_CAT:([^\]]+)\]/);
                if (m) { cat = m[1]; note = note.replace(/^\[OTHER_CAT:[^\]]+\]\s*/, ""); }
              }
              if (exp.delivery_boy?.name) {
                workerName = exp.delivery_boy.name;
              } else if (note.startsWith("[WORKER:")) {
                const m = note.match(/^\[WORKER:([^\]]+)\]/);
                if (m) { workerName = m[1]; }
              }
              if (note.startsWith("[WORKER:")) {
                note = note.replace(/^\[WORKER:[^\]]+\]\s*/, "");
              }
              const displayLabel = workerName ? `${cat.replace("_", " ")} (${workerName})` : cat.replace("_", " ");
              return (
                <div key={exp.id} className="px-5 py-2 flex justify-between items-center hover:bg-slate-50/40">
                  <span className="font-semibold text-slate-600 capitalize">
                    {displayLabel}
                    {note ? <span className="text-slate-400 font-normal ml-1">({note})</span> : ""}
                  </span>
                  <span className="font-bold tabular-nums text-red-600 text-sm">{fmtCurrency(Number(exp.amount))}</span>
                </div>
              );
            })}

            {/* Payment Outflows (from dedicated page) */}
            {paymentOutflows.map((item: any) => (
              <div key={item.id} className="px-5 py-2 flex justify-between items-center hover:bg-slate-50/40 group">
                <span className="font-semibold text-slate-600 flex flex-col gap-0.5 min-w-0">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-black uppercase bg-orange-100 text-orange-700 px-1 rounded shrink-0">Outflow</span>
                    <span className="break-all">{item.particular}</span>
                  </span>
                  {item.note && <span className="text-[10px] text-slate-400 font-normal ml-0 sm:ml-14 break-all">{item.note}</span>}
                </span>
                <span className="font-bold tabular-nums text-red-600 text-sm shrink-0 ml-2">{fmtCurrency(item.amount)}</span>
              </div>
            ))}

            {/* Magil Bills */}
            {magilBills.map((b) => (
              <div key={b.id} className="px-5 py-2 flex justify-between items-center hover:bg-slate-50/40 group">
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

            {/* Cheque */}
            {agg.chequeOutflow > 0 && (
              <div className="px-5 py-2 flex justify-between items-center hover:bg-slate-50/40">
                <span className="font-semibold text-slate-600">Cheque</span>
                <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(agg.chequeOutflow)}</span>
              </div>
            )}

            {/* Udhari with per-customer breakdown */}
            {agg.udhariOutflow > 0 && (
              <div className="px-5 py-2 flex flex-col hover:bg-slate-50/40">
                <div className="flex justify-between items-center py-0.5">
                  <span className="font-semibold text-slate-600">Udhari</span>
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

            {/* Outstanding manual entries */}
            {outstandingEntries.map((item: any) => (
              <div key={item.id} className="px-5 py-2 flex justify-between items-center hover:bg-slate-50/40 group">
                <span className="font-semibold text-slate-600 flex flex-col gap-0.5 min-w-0">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-black uppercase bg-orange-100 text-orange-700 px-1 rounded shrink-0">Outstanding</span>
                    <span className="break-all">{item.customer_name}</span>
                  </span>
                  {item.note && <span className="text-[10px] text-slate-400 font-normal ml-0 sm:ml-14 break-all">{item.note}</span>}
                </span>
                <span className="font-bold tabular-nums text-red-600 text-sm shrink-0 ml-2">{fmtCurrency(item.amount)}</span>
              </div>
            ))}

            {/* UPI / Paytm */}
            {agg.upiOutflow > 0 && (
              <div className="px-5 py-2.5 flex flex-col hover:bg-slate-50/40">
                <div className="flex justify-between items-center py-0.5">
                  <span className="font-semibold text-slate-600">UPI / Paytm <span className="text-slate-400 font-normal">({agg.onlineQtyTotal} units)</span></span>
                  <span className="font-bold tabular-nums text-slate-700 text-sm">{fmtCurrency(agg.upiOutflow)}</span>
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

            {/* Website Prepaid */}
            {agg.prepQtyTotal > 0 && (
              <div className="px-5 py-2.5 flex flex-col hover:bg-slate-50/40">
                <div className="flex justify-between items-center py-0.5">
                  <span className="font-semibold text-slate-600">Website Prepaid <span className="text-slate-400 font-normal">({agg.prepQtyTotal} units)</span></span>
                  <span className="font-bold tabular-nums text-red-600 text-sm">{fmtCurrency(agg.prepOutflow)}</span>
                </div>
                <div className="mt-1 pl-3 border-l-2 border-slate-200/80 space-y-0.5 text-[10px] text-slate-500 font-medium">
                  {Object.values(agg.prepByDriver).map((d) => (
                    <div key={d.name} className="flex justify-between py-0.5">
                      <span>{d.name} <span className="text-slate-400">({d.qty} units)</span></span>
                      <span className="tabular-nums">{fmtCurrency(d.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Commission with qty per driver */}
            {agg.commissionsTotal > 0 && (
              <div className="px-5 py-2.5 flex flex-col hover:bg-slate-50/40">
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
            <div className={cn("px-5 py-4 flex justify-between items-center border-t", balanceColors.bg)}>
              <span className={cn("text-xs font-extrabold uppercase tracking-wider", balanceColors.label)}>Calculated Cash Balance</span>
              <span className={cn("tabular-nums font-black text-base", balanceColors.text)}>{fmtCurrency(agg.cashBalance)}</span>
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

        <Card className={cn(
          "border shadow-soft",
          agg.cashDifference === null
            ? "bg-slate-50 border-slate-200"
            : Math.abs(agg.cashDifference) < 0.01
            ? "bg-amber-50 border-amber-200/80"
            : agg.cashDifference > 0
            ? "bg-emerald-50 border-emerald-200/80"
            : "bg-red-50 border-red-200/80"
        )}>
          <CardContent className="p-4 space-y-1">
            <div className={cn(
              "text-xs font-bold uppercase tracking-wider",
              agg.cashDifference === null
                ? "text-slate-600"
                : Math.abs(agg.cashDifference) < 0.01
                ? "text-amber-700"
                : agg.cashDifference > 0
                ? "text-emerald-700"
                : "text-red-700"
            )}>
              {agg.cashDifference === null ? "Difference (Manual − Calculated)" : Math.abs(agg.cashDifference) < 0.01 ? "✅ Balanced" : agg.cashDifference > 0 ? "✅ Cash Surplus (Excess)" : "⚠️ Cash Shortage"}
            </div>
            {agg.cashDifference === null ? (
              <div className="text-sm text-muted-foreground italic">Enter manual cash count to see difference</div>
            ) : (
              <>
                <div className={cn(
                  "text-2xl font-black tabular-nums mt-1",
                  Math.abs(agg.cashDifference) < 0.01
                    ? "text-amber-600"
                    : agg.cashDifference > 0
                    ? "text-emerald-600"
                    : "text-red-600"
                )}>
                  {fmtCurrency(Math.abs(agg.cashDifference))}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {Math.abs(agg.cashDifference) < 0.01 ? "Cashbook is perfectly balanced." :
                    agg.cashDifference > 0 ? `Surplus: ₹${Math.abs(agg.cashDifference).toFixed(2)} more cash in hand than calculated` :
                    `Shortage: ₹${Math.abs(agg.cashDifference).toFixed(2)} less cash in hand than calculated`}
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
            <div className={cn("space-y-1 p-4 rounded-xl border", balanceColors.bg)}>
              <span className={cn("text-xs font-bold uppercase tracking-wider", balanceColors.label)}>Closing Cash Balance</span>
              <div className={cn("text-2xl font-black tabular-nums mt-0.5", balanceColors.text)}>{fmtCurrency(agg.cashBalance)}</div>
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



      {/* Pending Bill */}
      <Dialog open={isPendingOpen} onOpenChange={setIsPendingOpen}>
        <DialogContent className="max-w-sm bg-white rounded-2xl shadow-xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">📋 Add Pending Bill</DialogTitle>
          </DialogHeader>
          <form onSubmit={addPendingBill} className="space-y-4 mt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Description / Label</Label>
              <Input value={pendingLabel} onChange={(e) => setPendingLabel(e.target.value)} placeholder="e.g. Pending cylinders (optional)" className="h-11" />
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
          </DialogHeader>
          <form onSubmit={addMagilBill} className="space-y-4 mt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Description / Label</Label>
              <Input value={magilLabel} onChange={(e) => setMagilLabel(e.target.value)} placeholder="e.g. Magil cylinders (optional)" className="h-11" />
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
