import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/auth.server";
import * as XLSXStyle from "xlsx-js-style";

/** Standard date formatter helpers */
function fmtDate(iso: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch (_) {
    return iso;
  }
}

/** Sends an email via Resend's REST API using the provided key */
export async function sendBackupEmail({
  emails,
  subject,
  htmlContent,
  attachmentBase64,
  filename,
}: {
  emails: string[];
  subject: string;
  htmlContent: string;
  attachmentBase64?: string;
  filename?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY || "re_SJrF19qB_J8LT93VGsQdPPR1gnTy8ArnN";
  const fromEmail = process.env.RESEND_FROM_EMAIL || "LPG Backup System <onboarding@resend.dev>";
  
  const payload: any = {
    from: fromEmail,
    to: emails,
    subject: subject,
    html: htmlContent,
  };

  if (attachmentBase64 && filename) {
    payload.attachments = [
      {
        filename: filename,
        content: attachmentBase64,
      },
    ];
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[Backup Email] Resend API error:", text);
    throw new Error(`Resend email sending failed: ${text}`);
  }

  return await res.json();
}

/** Compiles cash book data, calculates aggregates, and returns XLSX workbook */
export async function compileDailyCashBookWorkbook(admin: any, agencyId: string, date: string) {
  // 1. Fetch cash_book_days record
  const { data: bookData } = await admin
    .from("cash_book_days")
    .select("opening_cash, actual_closing, notes")
    .eq("agency_id", agencyId)
    .eq("book_date", date)
    .maybeSingle();

  let opening = "0";
  let otherReceiptsList: any[] = [];
  let pendingBills: any[] = [];
  let magilBills: any[] = [];
  let paymentInflows: any[] = [];
  let paymentOutflows: any[] = [];
  let outstandingEntries: any[] = [];
  let manualCashEntry = "";
  let dailyNote = "";

  if (bookData) {
    opening = String(bookData.opening_cash ?? 0);
    if (bookData.notes) {
      try {
        const m = JSON.parse(bookData.notes);
        otherReceiptsList = Array.isArray(m.other_receipts) ? m.other_receipts : [];
        pendingBills = Array.isArray(m.pending_bills) ? m.pending_bills : [];
        magilBills = Array.isArray(m.magil_bills) ? m.magil_bills : [];
        paymentInflows = Array.isArray(m.payment_inflows) ? m.payment_inflows : [];
        paymentOutflows = Array.isArray(m.payment_outflows) ? m.payment_outflows : [];
        outstandingEntries = Array.isArray(m.outstanding_entries) ? m.outstanding_entries : [];
        manualCashEntry = m.manual_cash_entry != null ? String(m.manual_cash_entry) : "";
        dailyNote = m.daily_note ?? "";
      } catch (_) {}
    }
  } else {
    // yesterday's closing
    const yesterday = new Date(new Date(date).getTime() - 86400000).toISOString().slice(0, 10);
    const { data: prev } = await admin
      .from("cash_book_days")
      .select("notes")
      .eq("agency_id", agencyId)
      .eq("book_date", yesterday)
      .maybeSingle();
    let oc = 0;
    if (prev?.notes) {
      try { oc = JSON.parse(prev.notes)?.calculated_closing ?? 0; } catch (_) {}
    }
    opening = String(oc);
  }

  // 2. Fetch sales
  const { data: sData } = await admin
    .from("sales")
    .select(`id, quantity, rate, gross_amount, commission_amount, payment_mode, notes,
      customer:customers(name), product:products(name),
      delivery_boy:delivery_boys(name), delivery_boy_id`)
    .eq("agency_id", agencyId).eq("sale_date", date).eq("is_deleted", false);

  const dailySales = ((sData ?? []) as any[]).map((s) => {
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
  });

  // 3. Fetch payments
  const { data: pData } = await admin
    .from("payments")
    .select("id, amount, mode, remarks, customer:customers(name)")
    .eq("agency_id", agencyId).eq("payment_date", date).eq("is_deleted", false);

  const dailyPayments = ((pData ?? []) as any[]).map((p: any) => ({
    id: p.id,
    customer_name: p.customer?.name ?? "—",
    amount: Number(p.amount),
    payment_mode: p.remarks?.startsWith("[CHEQUE]") ? "cheque" : (p.mode?.toLowerCase() || "cash"),
  }));

  // 4. Fetch expenses
  const { data: eData } = await admin
    .from("expenses")
    .select("id, category, amount, notes, delivery_boy_id, delivery_boy:delivery_boys(name)")
    .eq("agency_id", agencyId).eq("expense_date", date).eq("is_deleted", false);
  const dailyExpenses = (eData ?? []) as any[];

  // 5. Run aggregation
  const openingCash = Number(opening || 0);
  let homeTotal = 0, homeQty = 0, cncTotal = 0, cncQty = 0;
  const productSalesTotals: Record<string, { quantity: number; total: number }> = {};
  const commissionByDriver: Record<string, { name: string; amount: number; qty: number }> = {};
  const onlineByDriver: Record<string, { name: string; qty: number; amount: number }> = {};
  let onlineQtyTotal = 0;
  const prepByDriver: Record<string, { name: string; qty: number; amount: number }> = {};
  let prepQtyTotal = 0;
  const chequeByCustomer: Record<string, { name: string; amount: number }> = {};
  const udhariByCustomer: Record<string, { name: string; amount: number }> = {};

  dailySales.forEach((s) => {
    const nl = s.product_name.toLowerCase();
    const isMain = nl.includes("14.2") || nl.includes("14 kg") || nl.includes("domestic") || nl.includes("cylinder") || nl === "lpg" || nl === "gas";
    const isHome = nl.includes("home") || nl.includes("delivery") || (!!s.delivery_boy_id && !nl.includes("cnc"));
    const isCNC = !isHome;

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

    if (isMain) {
      if (isCNC) { cncTotal += s.total; cncQty += s.quantity; }
      else { homeTotal += s.total; homeQty += s.quantity; }
    } else {
      if (!productSalesTotals[s.product_name]) productSalesTotals[s.product_name] = { quantity: 0, total: 0 };
      productSalesTotals[s.product_name].quantity += s.quantity;
      productSalesTotals[s.product_name].total += s.total;
    }

    if (s.commission_total > 0 && s.delivery_boy_name) {
      const n = s.delivery_boy_name;
      if (!commissionByDriver[n]) commissionByDriver[n] = { name: n, amount: 0, qty: 0 };
      commissionByDriver[n].amount += s.commission_total;
      commissionByDriver[n].qty += s.quantity;
    }

    if (prepQty > 0) {
      const prepAmt = prepQty * Number(s.rate);
      const dbKey = s.delivery_boy_name ?? "Counter / Walk-in";
      if (!prepByDriver[dbKey]) prepByDriver[dbKey] = { name: dbKey, qty: 0, amount: 0 };
      prepByDriver[dbKey].qty += prepQty;
      prepByDriver[dbKey].amount += prepAmt;
      prepQtyTotal += prepQty;
    }

    const isOnlineOrPaytmSale = !isSplit && (s.payment_mode === "online" || s.payment_mode === "paytm");
    const effectiveOnline = isSplit ? onlineAmt : (isOnlineOrPaytmSale ? (s.gross_amount - s.commission_total) : 0);
    if (effectiveOnline > 0) {
      const qrQty = isSplit ? 0 : s.quantity;
      const dbKey = s.delivery_boy_name ?? "Counter / Walk-in";
      if (!onlineByDriver[dbKey]) onlineByDriver[dbKey] = { name: dbKey, qty: 0, amount: 0 };
      onlineByDriver[dbKey].qty += qrQty;
      onlineByDriver[dbKey].amount += effectiveOnline;
      onlineQtyTotal += qrQty;
    }

    const effectiveCredit = isSplit ? creditAmt : (s.payment_mode === "credit" ? (s.gross_amount - s.commission_total) : 0);
    if (effectiveCredit > 0) {
      const cn = s.customer_name ?? "Unknown";
      if (!udhariByCustomer[cn]) udhariByCustomer[cn] = { name: cn, amount: 0 };
      udhariByCustomer[cn].amount += effectiveCredit;
    }

    if (s.payment_mode === "cheque" && !isSplit) {
      const cn = s.customer_name ?? "Walk-in";
      if (!chequeByCustomer[cn]) chequeByCustomer[cn] = { name: cn, amount: 0 };
      chequeByCustomer[cn].amount += (s.gross_amount - s.commission_total);
    }
  });

  dailyPayments.forEach((p) => {
    if (p.payment_mode === "cheque") {
      const cn = p.customer_name ?? "—";
      if (!chequeByCustomer[cn]) chequeByCustomer[cn] = { name: cn, amount: 0 };
      chequeByCustomer[cn].amount += p.amount;
    }
  });

  let inflowOnlineSum = 0;
  let inflowCreditSum = 0;
  let inflowChequeSum = 0;
  const onlineInflowRows: Array<{ name: string; amount: number }> = [];
  const udhariInflowRows: Array<{ name: string; amount: number }> = [];

  paymentInflows.forEach((p: any) => {
    if (p.payment_type === "cheque") {
      inflowChequeSum += p.amount;
      const cn = p.particular || "Cheque Inflow";
      if (!chequeByCustomer[cn]) chequeByCustomer[cn] = { name: cn, amount: 0 };
      chequeByCustomer[cn].amount += p.amount;
    } else if (p.payment_type === "upi" || p.payment_type === "online") {
      inflowOnlineSum += p.amount;
      onlineInflowRows.push({
        name: `${p.particular || "UPI Inflow"} (${p.payment_type === "upi" ? "UPI" : "Online"})`,
        amount: p.amount,
      });
    } else if (p.payment_type === "split") {
      const onlinePart = Number(p.split_online || 0);
      const creditPart = Number(p.split_credit || 0);
      
      if (onlinePart > 0) {
        inflowOnlineSum += onlinePart;
        onlineInflowRows.push({
          name: `${p.particular || "Split Inflow"} (Online)`,
          amount: onlinePart,
        });
      }
      if (creditPart > 0) {
        inflowCreditSum += creditPart;
        udhariInflowRows.push({
          name: `${p.particular || "Split Inflow"} (Udhari)`,
          amount: creditPart,
        });
      }
    }
  });

  const collectionsTotal = dailyPayments.reduce((s, p) => s + p.amount, 0);
  const otherInflowsSum = otherReceiptsList.reduce((s, r) => s + r.amount, 0);
  const pendingBillsTotal = pendingBills.reduce((s, b) => s + b.amount, 0);
  const paymentInflowsTotal = paymentInflows.reduce((s, p) => s + p.amount, 0);

  const prepSales = Object.values(prepByDriver).reduce((s, d) => s + d.amount, 0);
  const upiSales = Object.values(onlineByDriver).reduce((s, d) => s + d.amount, 0);
  const chequeSales = dailySales.filter(s => s.payment_mode === "cheque").reduce((a, r) => a + (r.gross_amount - r.commission_total), 0);
  const udhariSales = Object.values(udhariByCustomer).reduce((s, c) => s + c.amount, 0);

  const paytmRecoveries = dailyPayments.filter(p => p.payment_mode === "paytm").reduce((a, r) => a + r.amount, 0);
  const onlineRecoveries = dailyPayments.filter(p => p.payment_mode === "online").reduce((a, r) => a + r.amount, 0);
  const chequeRecoveries = dailyPayments.filter(p => p.payment_mode === "cheque").reduce((a, r) => a + r.amount, 0);

  const prepOutflow = prepSales;
  const upiOutflow = upiSales + paytmRecoveries + onlineRecoveries + inflowOnlineSum;
  const chequeOutflow = chequeSales + chequeRecoveries + inflowChequeSum;
  const udhariOutflow = udhariSales + inflowCreditSum;

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

  // 6. Build styled sheet
  const wb = XLSXStyle.utils.book_new();
  const ws: any = {};

  const C = {
    titleBg:   "1A3C5E",
    titleFg:   "FFFFFF",
    hdrBg:     "2E75B6",
    hdrFg:     "FFFFFF",
    totRecBg:  "1F7A4D",
    totRecFg:  "FFFFFF",
    totPaidBg: "1F7A4D",
    totPaidFg: "FFFFFF",
    sumHdrBg:  "1A3C5E",
    sumHdrFg:  "FFFFFF",
    sumBalBg:  "C6EFCE",
    sumBalFg:  "375623",
    sumBalYelBg: "FFF2CC",
    sumBalYelFg: "7F6000",
    sumDiffBg: "FFC7CE",
    sumDiffFg: "9C0006",
    altRowBg:  "EBF3FB",
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

  W(row, 0, `Daily Cash Book — ${fmtDate(date)}`, { bold: true, sz: 13, fg: C.titleFg, bg: C.titleBg, align: "left", border: thickBorder });
  BLANK(row, 1, C.titleBg); BLANK(row, 2, C.titleBg); BLANK(row, 3, C.titleBg);
  W(row, 4, `Agency Cash Report — ${fmtDate(date)}`, { bold: true, sz: 13, fg: C.titleFg, bg: C.titleBg, align: "left", border: thickBorder });
  BLANK(row, 5, C.titleBg); BLANK(row, 6, C.titleBg);
  row++;

  for (let c = 0; c < 7; c++) BLANK(row, c);
  row++;

  W(row, 0, "PAYMENT RECEIVED", { bold: true, sz: 11, fg: C.hdrFg, bg: C.hdrBg, align: "left", border: thickBorder });
  W(row, 1, "Qty",        { bold: true, sz: 10, fg: C.hdrFg, bg: C.hdrBg, align: "center", border: thickBorder });
  W(row, 2, "Amount (₹)",{ bold: true, sz: 10, fg: C.hdrFg, bg: C.hdrBg, align: "right",  border: thickBorder });
  BLANK(row, 3);
  W(row, 4, "MONEY PAID / OUTFLOW",       { bold: true, sz: 11, fg: C.hdrFg, bg: C.hdrBg, align: "left", border: thickBorder });
  W(row, 5, "Qty",        { bold: true, sz: 10, fg: C.hdrFg, bg: C.hdrBg, align: "center", border: thickBorder });
  W(row, 6, "Amount (₹)",{ bold: true, sz: 10, fg: C.hdrFg, bg: C.hdrBg, align: "right",  border: thickBorder });
  row++;

  type XRow = { label: string; qty: number | ""; amt: number; sub?: boolean };
  const left: XRow[] = [];
  const right: XRow[] = [];

  left.push({ label: "Opening Cash Balance", qty: "", amt: openingCash });
  Object.entries(productSalesTotals).forEach(([n, s]) => left.push({ label: `${n} Sales`, qty: s.quantity, amt: s.total }));
  if (collectionsTotal > 0) {
    left.push({ label: "Credit Recovery / Outstanding Collections", qty: "", amt: collectionsTotal });
    dailyPayments.forEach(p => left.push({ label: `  - ${p.customer_name} (${p.payment_mode})`, qty: "", amt: p.amount, sub: true }));
  }

  otherReceiptsList.forEach(r => left.push({ label: r.particular, qty: "", amt: r.amount }));
  pendingBills.forEach(b => left.push({ label: `Pending — ${b.label} (${b.qty}×₹${b.rate})`, qty: b.qty, amt: b.amount }));
  paymentInflows.forEach(p => left.push({ label: p.particular + (p.note ? ` (${p.note})` : ""), qty: "", amt: p.amount }));
  if (homeTotal > 0) left.push({ label: "14 KG Home Delivery Sales", qty: homeQty, amt: homeTotal });
  if (cncTotal > 0)  left.push({ label: "14 KG CNC Sales",           qty: cncQty,  amt: cncTotal });

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

  paymentOutflows.forEach(p => right.push({ label: p.particular + (p.note ? ` (${p.note})` : ""), qty: "", amt: p.amount }));
  magilBills.forEach(b => right.push({ label: `Magil — ${b.label} (${b.qty}×₹${b.rate})`, qty: b.qty, amt: b.amount }));

  if (chequeOutflow > 0) {
    right.push({ label: "Cheque", qty: "", amt: chequeOutflow });
    Object.values(chequeByCustomer).forEach(c => right.push({ label: `  - ${c.name}`, qty: "", amt: c.amount, sub: true }));
  }

  if (udhariOutflow > 0) {
    right.push({ label: "Udhari", qty: "", amt: udhariOutflow });
    Object.values(udhariByCustomer).forEach(c => right.push({ label: `  - ${c.name}`, qty: "", amt: c.amount, sub: true }));
    udhariInflowRows.forEach(r => right.push({ label: `  - ${r.name}`, qty: "", amt: r.amount, sub: true }));
  }

  if (outstandingTotal > 0) {
    right.push({ label: "Outstanding (Loans/Udhari Given)", qty: "", amt: outstandingTotal });
    outstandingEntries.forEach(o => right.push({ label: `  - ${o.customer_name}${o.note ? ` (${o.note})` : ""}`, qty: "", amt: o.amount, sub: true }));
  }

  if (upiOutflow > 0) {
    right.push({ label: "UPI / Paytm", qty: onlineQtyTotal, amt: upiOutflow });
    Object.values(onlineByDriver).forEach(d => right.push({ label: `  - ${d.name}`, qty: d.qty, amt: d.amount, sub: true }));
    onlineInflowRows.forEach(r => right.push({ label: `  - ${r.name}`, qty: "", amt: r.amount, sub: true }));
  }

  if (prepQtyTotal > 0) {
    right.push({ label: "Website Prepaid", qty: prepQtyTotal, amt: prepOutflow });
    Object.values(prepByDriver).forEach(d => right.push({ label: `  - ${d.name}`, qty: d.qty, amt: d.amount, sub: true }));
  }

  if (commissionsTotal > 0) {
    right.push({ label: "Route Commission Paid", qty: "", amt: commissionsTotal });
    Object.values(commissionByDriver).forEach(d => right.push({ label: `  - ${d.name}`, qty: d.qty, amt: d.amount, sub: true }));
  }

  const maxData = Math.max(left.length, right.length);
  while (left.length  < maxData) left.push({ label: "", qty: "", amt: 0 });
  while (right.length < maxData) right.push({ label: "", qty: "", amt: 0 });

  const cleanQtyExcel = (q: any) => {
    if (q === 0 || q === "0" || q === "") return "";
    return q;
  };

  for (let i = 0; i < maxData; i++) {
    const l = left[i];
    const r2 = right[i];
    const isAlt = i % 2 === 1;
    const rowBg = isAlt ? C.altRowBg : undefined;

    if (l.label) {
      const subBg = l.sub ? C.subRowBg : rowBg;
      W(row, 0, l.label, { italic: l.sub, bg: subBg });
      const qtyVal = cleanQtyExcel(l.qty);
      if (qtyVal !== "") W(row, 1, qtyVal, { align: "center", bg: subBg });
      else BLANK(row, 1, subBg);
      W(row, 2, l.amt || 0, { bg: subBg });
    } else {
      BLANK(row, 0, rowBg); BLANK(row, 1, rowBg); BLANK(row, 2, rowBg);
    }

    BLANK(row, 3);

    if (r2.label) {
      const subBg = r2.sub ? C.subRowBg : rowBg;
      W(row, 4, r2.label, { italic: r2.sub, bg: subBg });
      const qtyVal = cleanQtyExcel(r2.qty);
      if (qtyVal !== "") W(row, 5, qtyVal, { align: "center", bg: subBg });
      else BLANK(row, 5, subBg);
      W(row, 6, r2.amt || 0, { bg: subBg });
    } else {
      BLANK(row, 4, rowBg); BLANK(row, 5, rowBg); BLANK(row, 6, rowBg);
    }

    row++;
  }

  W(row, 0, "TOTAL RECEIVED", { bold: true, sz: 11, fg: C.totRecFg, bg: C.totRecBg, border: thickBorder });
  BLANK(row, 1, C.totRecBg);
  W(row, 2, leftGrandTotal, { bold: true, sz: 11, fg: C.totRecFg, bg: C.totRecBg, border: thickBorder });
  BLANK(row, 3);
  W(row, 4, "TOTAL PAID OUTFLOW", { bold: true, sz: 11, fg: C.totPaidFg, bg: C.totPaidBg, border: thickBorder });
  BLANK(row, 5, C.totPaidBg);
  W(row, 6, totalOutflows, { bold: true, sz: 11, fg: C.totPaidFg, bg: C.totPaidBg, border: thickBorder });
  row++;

  for (let c = 0; c < 7; c++) BLANK(row, c);
  row++;

  W(row, 0, "SUMMARY", { bold: true, sz: 11, fg: C.sumHdrFg, bg: C.sumHdrBg, border: thickBorder });
  for (let c = 1; c < 7; c++) BLANK(row, c, C.sumHdrBg);
  row++;

  W(row, 0, "Total Received (Inflows)", { bold: false });
  BLANK(row, 1); W(row, 2, leftGrandTotal, { bold: true }); row++;

  W(row, 0, "Total Paid (Outflows)", { bold: false });
  BLANK(row, 1); W(row, 2, totalOutflows, { bold: true }); row++;

  const isBalZero = cashBalance === 0;
  const isBalPos = cashBalance > 0;
  const balBgExcel = isBalZero ? C.sumBalYelBg : isBalPos ? C.sumBalBg : C.sumDiffBg;
  const balFgExcel = isBalZero ? C.sumBalYelFg : isBalPos ? C.sumBalFg : C.sumDiffFg;
  W(row, 0, "Calculated Cash Balance",  { bold: true, fg: balFgExcel, bg: balBgExcel, border: thickBorder });
  BLANK(row, 1, balBgExcel);
  W(row, 2, cashBalance, { bold: true, fg: balFgExcel, bg: balBgExcel, border: thickBorder });
  row++;

  if (cashDifference !== null) {
    W(row, 0, "Manual Cash Entry (Physical Count)"); BLANK(row, 1); W(row, 2, Number(manualCashEntry)); row++;
    const isBalanced = Math.abs(cashDifference) < 0.01;
    const isSurplus = cashDifference > 0;
    const diffBg = isBalanced ? C.sumBalYelBg : isSurplus ? C.sumBalBg : C.sumDiffBg;
    const diffFg = isBalanced ? C.sumBalYelFg : isSurplus ? C.sumBalFg : C.sumDiffFg;
    const diffLabel = isBalanced ? "Cash Difference (Balanced)" : isSurplus ? "Cash Difference (Surplus)" : "Cash Difference (Shortage)";
    W(row, 0, diffLabel, { bold: true, fg: diffFg, bg: diffBg, border: thickBorder });
    BLANK(row, 1, diffBg);
    W(row, 2, cashDifference, { bold: true, fg: diffFg, bg: diffBg, border: thickBorder });
    row++;
  }

  if (dailyNote.trim()) {
    row++;
    W(row, 0, `Note: ${dailyNote}`, { italic: true, fg: "555555" }); row++;
  }

  ws["!cols"] = [
    { wch: 40 }, { wch: 7 }, { wch: 15 }, { wch: 2 },
    { wch: 40 }, { wch: 7 }, { wch: 15 },
  ];

  ws["!rows"] = Array.from({ length: row + 2 }, (_, i) => ({
    hpt: i === 0 ? 22 : i === 2 ? 18 : 16,
  }));

  ws["!ref"] = XLSXStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row + 1, c: 6 } });

  XLSXStyle.utils.book_append_sheet(wb, ws, "Cash Book");

  return {
    wb,
    metrics: {
      leftGrandTotal,
      totalOutflows,
      cashBalance,
      cashDifference,
    }
  };
}

/** Saves backup email settings (bypasses RLS since RLS blocks non-platform admins from updating agencies table) */
export const saveBackupSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        emails: z.array(z.string().email().trim()).max(3, "Maximum of 3 email addresses allowed"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();
    
    // 1. Get user agency info
    const { data: au } = await admin
      .from("agency_users")
      .select("agency_id")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!au || !au.agency_id) {
      throw new Error("Unauthorized: User has no associated agency");
    }


    // 3. Update the agencies table
    const { error: updateErr } = await admin
      .from("agencies")
      .update({ backup_emails: data.emails })
      .eq("id", au.agency_id);

    if (updateErr) {
      throw new Error(`Failed to save settings: ${updateErr.message}`);
    }

    // 4. If email array is not empty, automatically trigger a test backup email!
    if (data.emails.length > 0) {
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        
        // Fetch agency name
        const { data: agency } = await admin
          .from("agencies")
          .select("name")
          .eq("id", au.agency_id)
          .maybeSingle();

        const agencyName = agency?.name ?? "LPG Agency";
        
        // Generate daily cash book report sheet
        const { wb, metrics } = await compileDailyCashBookWorkbook(admin, au.agency_id, todayStr);
        const buf = XLSXStyle.write(wb, { type: "buffer", bookType: "xlsx" });
        const base64 = buf.toString("base64");

        const subject = `Daily Accounts Report (Configuration Test) - ${agencyName}`;
        const html = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03); background-color: #ffffff;">
            <div style="background: linear-gradient(135deg, #1e3c5e 0%, #12253a 100%); padding: 30px 24px; text-align: center; color: #ffffff;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">Daily Accounts Report</h1>
              <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.85;">${agencyName}</p>
            </div>
            <div style="padding: 24px; color: #334155;">
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #475569;">
                Hello, your backup email settings for <strong>${agencyName}</strong> have been configured successfully. This test email confirms that your email address is ready to receive daily ledger summaries.
              </p>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <h3 style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #1e293b;">Configuration Summary</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                  <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 0; color: #64748b;">Configured On:</td>
                    <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #0f172a;">${fmtDate(todayStr)}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 0; color: #64748b;">Total Received:</td>
                    <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #16a34a;">₹${metrics.leftGrandTotal.toFixed(2)}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 0; color: #64748b;">Total Paid Outflows:</td>
                    <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #dc2626;">₹${metrics.totalOutflows.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0 0 0; font-weight: bold; color: #1e293b; font-size: 15px;">Calculated Balance:</td>
                    <td style="padding: 10px 0 0 0; text-align: right; font-weight: bold; color: #1e3c5e; font-size: 15px;">₹${metrics.cashBalance.toFixed(2)}</td>
                  </tr>
                </table>
              </div>
              <div style="border-left: 4px solid #1e3c5e; background-color: #eff6ff; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #1e40af;">
                  <strong>Attachment:</strong> A fully styled daily Excel report containing your Cash Book, Sales Log, and Udhari Ledger is attached below.
                </p>
              </div>
              <p style="margin: 0; font-size: 13px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                Every day at 9:30 PM, your daily backup will be sent automatically.
              </p>
            </div>
          </div>
        `;

        await sendBackupEmail({
          emails: data.emails,
          subject: subject,
          htmlContent: html,
          attachmentBase64: base64,
          filename: `cashbook_${todayStr}.xlsx`,
        });
      } catch (e: any) {
        console.error("Auto-send backup test email failed:", e);
        // Do not crash the save setting result if only sending the email failed
      }
    }

    return { ok: true };
  });

/** Triggers a backup email immediately for the logged-in agency */
export const sendManualBackupEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();

    // 1. Fetch user agency and emails
    const { data: au } = await admin
      .from("agency_users")
      .select("agency_id, agencies(name, backup_emails)")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!au || !au.agency_id) {
      throw new Error("Unauthorized: User has no associated agency");
    }

    const agency = au.agencies as any;
    const emails = agency?.backup_emails as string[];
    const agencyName = agency?.name ?? "LPG Agency";

    if (!emails || emails.length === 0) {
      throw new Error("No backup emails configured. Please configure at least one email address first.");
    }

    const targetDate = data?.date || new Date().toISOString().slice(0, 10);

    // 2. Generate daily cash book report sheet
    const { wb, metrics } = await compileDailyCashBookWorkbook(admin, au.agency_id, targetDate);
    const buf = XLSXStyle.write(wb, { type: "buffer", bookType: "xlsx" });
    const base64 = buf.toString("base64");

    const subject = `Daily Accounts Report - ${agencyName} - ${fmtDate(targetDate)}`;
    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03); background-color: #ffffff;">
        <div style="background: linear-gradient(135deg, #1e3c5e 0%, #12253a 100%); padding: 30px 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">Daily Accounts Report</h1>
          <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.85;">${agencyName}</p>
        </div>
        <div style="padding: 24px; color: #334155;">
          <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #475569;">
            Please find the manual on-demand accounts report for <strong>${agencyName}</strong> generated for the date of <strong>${fmtDate(targetDate)}</strong>.
          </p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <h3 style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #1e293b;">Report Details</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 0; color: #64748b;">Report Date:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #0f172a;">${fmtDate(targetDate)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 0; color: #64748b;">Total Inflows:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #16a34a;">₹${metrics.leftGrandTotal.toFixed(2)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 0; color: #64748b;">Total Paid Outflows:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #dc2626;">₹${metrics.totalOutflows.toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0 0 0; font-weight: bold; color: #1e293b; font-size: 15px;">Net Cash Balance:</td>
                <td style="padding: 10px 0 0 0; text-align: right; font-weight: bold; color: #1e3c5e; font-size: 15px;">₹${metrics.cashBalance.toFixed(2)}</td>
              </tr>
            </table>
          </div>
          <div style="border-left: 4px solid #1e3c5e; background-color: #eff6ff; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #1e40af;">
              <strong>Attachment:</strong> A fully detailed, formatted Excel worksheet (containing the Cash Book, Sales Log, and Udhari Ledger) is attached to this email.
            </p>
          </div>
          <p style="margin: 0; font-size: 13px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 16px;">
            This backup was requested on-demand. Do not reply to this email.
          </p>
        </div>
      </div>
    `;

    await sendBackupEmail({
      emails: emails,
      subject: subject,
      htmlContent: html,
      attachmentBase64: base64,
      filename: `cashbook_${targetDate}.xlsx`,
    });

    return { ok: true };
  });
