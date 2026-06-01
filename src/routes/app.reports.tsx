import { createFileRoute } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { useTranslation } from "react-i18next";
import { fmtCurrency, fmtDate, todayISO } from "@/lib/format";
import { exportToExcel, exportToPDF } from "@/lib/exports";
import { getStockBalances, getStockLedger } from "@/lib/stock-store";
import { Download, FileText, Play } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export const Route = createFileRoute("/app/reports")({ component: () => <RequireAgencyUser><Page/></RequireAgencyUser> });

type Kind = "daily_summary" | "product_sales" | "payments" | "udhari" | "cashbook" | "delivery" | "stock" | "customer_ledger";

function Page() {
  const { t } = useTranslation();
  const { agency, session } = useAuth();
  const [kind, setKind] = useState<Kind>("daily_summary");
  const [from, setFrom] = useState(todayISO()); const [to, setTo] = useState(todayISO());
  const [cols, setCols] = useState<string[]>([]); const [data, setData] = useState<(string|number)[][]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!agency) return;
    (async () => {
      const { data } = await supabase.from("customers").select("id, name").eq("agency_id", agency.id).eq("is_deleted", false).order("name");
      setCustomers(data ?? []);
    })();
  }, [agency]);

  const run = async () => {
    if (!agency) return;
    if (kind === "daily_summary") {
      const [salesQ, paysQ, expQ, cashQ] = await Promise.all([
        supabase.from("sales").select("sale_date, gross_amount, payment_mode").eq("agency_id", agency.id).eq("is_deleted", false).gte("sale_date", from).lte("sale_date", to),
        supabase.from("payments").select("payment_date, amount, mode").eq("agency_id", agency.id).eq("is_deleted", false).gte("payment_date", from).lte("payment_date", to),
        supabase.from("expenses").select("expense_date, amount").eq("agency_id", agency.id).eq("is_deleted", false).gte("expense_date", from).lte("expense_date", to),
        supabase.from("cash_book_days").select("book_date, opening_cash").eq("agency_id", agency.id).gte("book_date", from).lte("book_date", to)
      ]);

      const dates = Array.from(new Set([
        ...(salesQ.data ?? []).map(s => s.sale_date),
        ...(paysQ.data ?? []).map(p => p.payment_date),
        ...(expQ.data ?? []).map(e => e.expense_date),
        ...(cashQ.data ?? []).map(c => c.book_date),
      ])).sort().reverse();

      setCols(["Date", "Gross Sales (₹)", "Cash Collections (₹)", "Online/Paytm (₹)", "Expenses Paid (₹)", "Expected Cash Drawer (₹)"]);
      setData(dates.map((dateStr) => {
        const salesOnDate = (salesQ.data ?? []).filter(s => s.sale_date === dateStr);
        const paysOnDate = (paysQ.data ?? []).filter(p => p.payment_date === dateStr);
        const expOnDate = (expQ.data ?? []).filter(e => e.expense_date === dateStr);
        const cashOnDate = (cashQ.data ?? []).find(c => c.book_date === dateStr);

        const grossSales = salesOnDate.reduce((sum, s) => sum + Number(s.gross_amount), 0);
        const cashSales = salesOnDate.filter(s => s.payment_mode === 'cash').reduce((sum, s) => sum + Number(s.gross_amount), 0);
        const cashPayments = paysOnDate.filter(p => p.mode === 'cash').reduce((sum, p) => sum + Number(p.amount), 0);
        
        const cashCollections = cashSales + cashPayments;
        const nonCashCollections = paysOnDate.filter(p => p.mode !== 'cash').reduce((sum, p) => sum + Number(p.amount), 0) + 
                             salesOnDate.filter(s => s.payment_mode !== 'cash' && s.payment_mode !== 'credit').reduce((sum, s) => sum + Number(s.gross_amount), 0);
        
        const expenses = expOnDate.reduce((sum, e) => sum + Number(e.amount), 0);
        const openingCash = Number(cashOnDate?.opening_cash ?? 0);
        const expectedCash = openingCash + cashCollections - expenses;

        return [
          fmtDate(dateStr),
          Number(grossSales),
          Number(cashCollections),
          Number(nonCashCollections),
          Number(expenses),
          Number(expectedCash)
        ];
      }));
    } else if (kind === "product_sales") {
      const { data: sales } = await supabase
        .from("sales")
        .select("quantity, gross_amount, product:products(name)")
        .eq("agency_id", agency.id)
        .eq("is_deleted", false)
        .gte("sale_date", from)
        .lte("sale_date", to);

      const prodMap: Record<string, { qty: number, rev: number }> = {};
      (sales ?? []).forEach((s: any) => {
        const pName = s.product?.name ?? "Cylinder";
        if (!prodMap[pName]) prodMap[pName] = { qty: 0, rev: 0 };
        prodMap[pName].qty += Number(s.quantity);
        prodMap[pName].rev += Number(s.gross_amount);
      });

      setCols(["Product Name", "Total Quantity Sold", "Average Rate", "Gross Revenue (₹)"]);
      setData(Object.entries(prodMap).map(([pName, val]) => [
        pName,
        val.qty,
        val.qty > 0 ? Number((val.rev / val.qty).toFixed(2)) : 0,
        Number(val.rev)
      ]));
    } else if (kind === "payments") {
      const { data: r } = await supabase
        .from("payments")
        .select("id, payment_date, amount, mode, remarks, customer:customers(name)")
        .eq("agency_id", agency.id)
        .eq("is_deleted", false)
        .gte("payment_date", from)
        .lte("payment_date", to)
        .order("payment_date", { ascending: false });

      setCols(["Receipt ID", "Payment Date", "Customer Name", "Mode", "Notes / Remarks", "Amount (₹)"]);
      setData((r ?? []).map((p: any) => [
        p.id.substring(0, 8).toUpperCase(),
        fmtDate(p.payment_date),
        p.customer?.name ?? "Direct walk-in",
        p.mode.toUpperCase(),
        p.remarks ?? "Payment recorded",
        Number(p.amount)
      ]));
    } else if (kind === "udhari") {
      const [cRes, lRes] = await Promise.all([
        (supabase.from("customers") as any)
          .select("id, name, mobile, village")
          .eq("agency_id", agency.id)
          .eq("is_deleted", false),
        (supabase.from("customer_ledger") as any)
          .select("customer_id, debit, credit")
          .eq("agency_id", agency.id)
      ]);

      const ledgerMap: Record<string, number> = {};
      (lRes.data ?? []).forEach((r: any) => {
        ledgerMap[r.customer_id] = (ledgerMap[r.customer_id] ?? 0) + Number(r.debit || 0) - Number(r.credit || 0);
      });

      const debtors = ((cRes.data ?? []) as any[])
        .map((c) => ({
          name: c.name,
          mobile: c.mobile,
          village: c.village,
          outstanding: ledgerMap[c.id] ?? 0
        }))
        .filter(c => c.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding);

      setCols(["Debtor Name", "Mobile Number", "Village / Route", "Outstanding Udhari Balance (₹)"]);
      setData(debtors.map((c: any) => [
        c.name,
        c.mobile ?? "—",
        c.village ?? "—",
        Number(c.outstanding)
      ]));
    } else if (kind === "cashbook") {
      const [cashQ, salesQ, paysQ, expQ] = await Promise.all([
        supabase.from("cash_book_days").select("book_date, opening_cash, actual_closing, notes").eq("agency_id", agency.id).gte("book_date", from).lte("book_date", to),
        supabase.from("sales").select("sale_date, gross_amount, commission_amount").eq("agency_id", agency.id).eq("payment_mode", "cash").eq("is_deleted", false).gte("sale_date", from).lte("sale_date", to),
        supabase.from("payments").select("payment_date, amount").eq("agency_id", agency.id).eq("mode", "cash").eq("is_deleted", false).gte("payment_date", from).lte("payment_date", to),
        supabase.from("expenses").select("expense_date, amount").eq("agency_id", agency.id).eq("is_deleted", false).gte("expense_date", from).lte("expense_date", to)
      ]);

      const dates = Array.from(new Set([
        ...(cashQ.data ?? []).map(c => c.book_date),
        ...(salesQ.data ?? []).map(s => s.sale_date),
        ...(paysQ.data ?? []).map(p => p.payment_date),
        ...(expQ.data ?? []).map(e => e.expense_date)
      ])).sort().reverse();

      setCols(["Date", "Opening Cash", "Cash Sales (Net)", "Cash Payments Recd", "Other Receipts", "Expenses Paid", "Expected closing", "Actual closing", "Shortage/Surplus"]);
      setData(dates.map((dateStr) => {
        const cashRow = (cashQ.data ?? []).find(c => c.book_date === dateStr);
        const cashSalesSum = (salesQ.data ?? []).filter(s => s.sale_date === dateStr).reduce((s, x) => s + Number(x.gross_amount) - Number(x.commission_amount || 0), 0);
        const cashPaymentsSum = (paysQ.data ?? []).filter(p => p.payment_date === dateStr).reduce((s, x) => s + Number(x.amount), 0);
        const expensesSum = (expQ.data ?? []).filter(e => e.expense_date === dateStr).reduce((s, x) => s + Number(x.amount), 0);

        let otherReceipts = 0;
        if (cashRow?.notes) {
          try {
            const meta = JSON.parse(cashRow.notes);
            if (meta && typeof meta === "object" && meta.other_cash_receipts != null) {
              otherReceipts = Number(meta.other_cash_receipts);
            }
          } catch (e) {}
        }

        const opening = Number(cashRow?.opening_cash ?? 0);
        const expected = opening + cashSalesSum + cashPaymentsSum + otherReceipts - expensesSum;
        const actual = cashRow?.actual_closing != null ? Number(cashRow.actual_closing) : expected;
        const diff = actual - expected;

        return [
          fmtDate(dateStr),
          Number(opening),
          Number(cashSalesSum),
          Number(cashPaymentsSum),
          Number(otherReceipts),
          Number(expensesSum),
          Number(expected),
          Number(actual),
          Number(diff)
        ];
      }));
    } else if (kind === "delivery") {
      const [boysQ, salesQ] = await Promise.all([
        supabase.from("delivery_boys").select("id, name, default_commission").eq("agency_id", agency.id).eq("is_deleted", false),
        supabase.from("sales").select("delivery_boy_id, quantity, gross_amount, commission_amount, payment_mode").eq("agency_id", agency.id).eq("is_deleted", false).gte("sale_date", from).lte("sale_date", to)
      ]);

      setCols(["Delivery Partner", "Trips (Delivered Qty)", "Commission Deducted Today", "Gross Cash Collections", "Net Remitted Cash"]);
      setData((boysQ.data ?? []).map((boy) => {
        const boySales = (salesQ.data ?? []).filter(s => s.delivery_boy_id === boy.id);

        const qty = boySales.reduce((sum, s) => sum + Number(s.quantity), 0);
        const earned = boySales.reduce((sum, s) => sum + Number(s.commission_amount), 0);
        const collections = boySales.filter(s => s.payment_mode === 'cash').reduce((sum, s) => sum + Number(s.gross_amount), 0);
        
        const netRemitted = collections - earned;

        return [
          boy.name,
          qty,
          Number(earned),
          Number(collections),
          Number(netRemitted)
        ];
      }));
    } else if (kind === "stock") {
      const { data: prods } = await supabase.from("products").select("id, name").eq("agency_id", agency.id).eq("is_deleted", false);
      const balances = getStockBalances(agency.id, prods ?? []);
      const ledger = getStockLedger(agency.id);

      setCols(["Product Name", "Opening Stock", "Purchases Logged", "Adjustments", "Transfers", "Sales Deductions", "Closing Stock Balance"]);
      setData((prods ?? []).map((p) => {
        const bal = balances[p.id] || { openingStock: 0, currentStock: 0 };
        const led = ledger.filter(l => l.productId === p.id && l.entryDate >= from && l.entryDate <= to);

        const purchases = led.filter(l => l.type === 'purchase').reduce((sum, l) => sum + Number(l.quantity), 0);
        const adjustments = led.filter(l => l.type === 'adjustment').reduce((sum, l) => sum + Number(l.quantity), 0);
        const transfers = led.filter(l => l.type === 'transfer').reduce((sum, l) => sum + Number(l.quantity), 0);
        const sales = led.filter(l => l.type === 'sale').reduce((sum, l) => sum + Number(l.quantity), 0);

        return [
          p.name,
          Number(bal.openingStock),
          Number(purchases),
          Number(adjustments),
          Number(transfers),
          Number(sales),
          Number(bal.currentStock)
        ];
      }));
    } else if (kind === "customer_ledger") {
      if (!selectedCustomerId) {
        toast.error("Please select a customer first.");
        return;
      }
      const [
        { data: sData }, 
        { data: pData },
        { data: prevSales },
        { data: prevPayments }
      ] = await Promise.all([
        supabase.from("sales").select("id, sale_date, gross_amount, payment_mode, notes, product:products(name)").eq("customer_id", selectedCustomerId).eq("is_deleted", false).gte("sale_date", from).lte("sale_date", to),
        supabase.from("payments").select("id, payment_date, amount, mode, remarks").eq("customer_id", selectedCustomerId).eq("is_deleted", false).gte("payment_date", from).lte("payment_date", to),
        supabase.from("sales").select("gross_amount").eq("customer_id", selectedCustomerId).eq("payment_mode", "credit").eq("is_deleted", false).lt("sale_date", from),
        supabase.from("payments").select("amount").eq("customer_id", selectedCustomerId).eq("is_deleted", false).lt("payment_date", from)
      ]);

      const prevSalesSum = (prevSales ?? []).reduce((sum, s) => sum + Number(s.gross_amount), 0);
      const prevPaymentsSum = (prevPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
      const openingBalance = prevSalesSum - prevPaymentsSum;

      const sItems = ((sData ?? []) as any[]).map((s) => ({
        date: s.sale_date,
        type: "Sale",
        ref: s.id.substring(0, 8).toUpperCase(),
        desc: `${s.product?.name ?? "Cylinder"} (${s.payment_mode})`,
        debit: Number(s.gross_amount),
        credit: s.payment_mode !== 'credit' ? Number(s.gross_amount) : 0,
        notes: s.notes ?? "Sale recorded"
      }));

      const pItems = ((pData ?? []) as any[]).map((p) => ({
        date: p.payment_date,
        type: "Payment",
        ref: p.id.substring(0, 8).toUpperCase(),
        desc: `Payment Received (${p.mode})`,
        debit: 0,
        credit: Number(p.amount),
        notes: p.remarks ?? "Payment recorded"
      }));

      const merged = [...sItems, ...pItems].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      let runningBalance = openingBalance;
      const rowsData = [
        ["—", "Opening Dues", "—", "Outstanding balance before " + fmtDate(from), 0, 0, Number(openingBalance)],
        ...merged.map((item) => {
          runningBalance += item.debit - item.credit;
          return [
            fmtDate(item.date),
            item.type,
            item.ref,
            item.desc,
            item.debit > 0 ? Number(item.debit) : 0,
            item.credit > 0 ? Number(item.credit) : 0,
            Number(runningBalance)
          ];
        })
      ];

      setCols(["Date", "Type", "Reference ID", "Description", "Debit (+)", "Credit (-)", "Running Balance (₹)"]);
      setData(rowsData);
    }
  };

  const title = (kind === "customer_ledger"
    ? `${customers.find(c => c.id === selectedCustomerId)?.name || "Customer"}'s Account Ledger`
    : kind === "daily_summary"
    ? "Daily Sales Register"
    : kind === "payments"
    ? "Collection Report"
    : kind === "udhari"
    ? "Udhari Register"
    : kind === "cashbook"
    ? "Cashbook"
    : kind === "delivery"
    ? "Delivery Boy Settlement Report"
    : kind === "stock"
    ? "Cylinder Stock Register"
    : kind === "product_sales"
    ? "Cylinder Sales Report"
    : t(`reports.${kind}` as never, kind)) as string;
  return (
    <div className="space-y-6 pb-8">
      <PageHeader title={t("reports.title")} />
      <Card className="shadow-soft"><CardContent className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="col-span-2 md:col-span-2">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Roster Report Sheet</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily_summary">📋 Daily Sales Register</SelectItem>
              <SelectItem value="product_sales">📈 Cylinder Sales Report</SelectItem>
              <SelectItem value="payments">💰 Collection Report</SelectItem>
              <SelectItem value="udhari">⚠️ Udhari Register</SelectItem>
              <SelectItem value="cashbook">📓 Cashbook</SelectItem>
              <SelectItem value="delivery">🚚 Delivery Boy Settlement Report</SelectItem>
              <SelectItem value="stock">📦 Cylinder Stock Register</SelectItem>
              <SelectItem value="customer_ledger">👤 Customer Ledger</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {kind === "customer_ledger" && (
          <div className="col-span-2 md:col-span-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Customer</Label>
            <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
              <SelectTrigger className="h-11 mt-1"><SelectValue placeholder="Select Customer..." /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div><Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("reports.from")}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 mt-1 text-sm" /></div>
        <div><Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("reports.to")}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 mt-1 text-sm" /></div>
        <div className="flex items-end"><Button onClick={run} className="w-full h-11 shadow-soft font-semibold"><Play className="h-4 w-4 mr-1.5" />{t("reports.run")}</Button></div>
      </CardContent></Card>
      {data.length > 0 && (
        <Card><CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="font-semibold text-sm">{title} — {data.length} rows</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Download className="h-4 w-4 mr-1.5" />Export</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportToPDF(title, cols, data, "report")}><FileText className="h-4 w-4 mr-2" />PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const formattedExcelData = data.map((row) => {
                    const obj: any = {};
                    cols.forEach((col, idx) => {
                      obj[col] = row[idx];
                    });
                    return obj;
                  });
                  exportToExcel(formattedExcelData, "report", title);
                }}><FileText className="h-4 w-4 mr-2" />Excel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted"><tr>{cols.map((c) => <th key={c} className="text-left px-3 py-2 font-semibold">{c}</th>)}</tr></thead>
              <tbody>{data.map((row, i) => (
                <tr key={i} className="border-t">{row.map((v, j) => <td key={j} className="px-3 py-2 whitespace-nowrap">{typeof v === "number" ? v.toLocaleString("en-IN") : v}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
