import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, IndianRupee, Eye, PlusCircle, AlertCircle, Loader2, Calendar, TrendingDown } from "lucide-react";
import { fmtCurrency, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/app/udhari")({
  head: () => ({ meta: [{ title: "Udhari Ledger — GasFlow" }] }),
  component: UdhariPage,
});

type Bucket = "current" | "b30" | "b60" | "b90" | "b90plus";

interface UdhariCustomer {
  id: string;
  name: string;
  mobile: string | null;
  village: string | null;
  consumer_number: string | null;
  outstanding: number;
  oldestUnpaidDate: string | null;
  lastPaymentDate: string | null;
  ageDays: number;
  bucket: Bucket;
  buckets: { current: number; b30: number; b60: number; b90: number; b90plus: number };
  hasMismatch?: boolean;
  dbOutstanding?: number;
}

function daysBetween(a: Date, b: Date) {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function bucketForAge(days: number): Bucket {
  if (days <= 0) return "current";
  if (days <= 30) return "b30";
  if (days <= 60) return "b60";
  if (days <= 90) return "b90";
  return "b90plus";
}

function UdhariPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agency, session } = useAuth();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [villageFilter, setVillageFilter] = useState("all");
  const [bucketFilter, setBucketFilter] = useState<"all" | Bucket>("all");
  const [payTarget, setPayTarget] = useState<UdhariCustomer | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState<"cash" | "online" | "paytm" | "cheque">("cash");
  const [payRemarks, setPayRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  // Fetch outstanding customers + their full ledger to compute FIFO aging
  const { data: customers = [], isLoading } = useQuery<UdhariCustomer[]>({
    queryKey: ["udhari-aging", agency?.id],
    queryFn: async () => {
      if (!agency?.id) return [];

      // Query ALL active customers instead of only gt("outstanding_balance", 0) to avoid missing records with stale values
      const { data: cData, error: cErr } = await (supabase.from("customers") as any)
        .select("id, name, mobile, village, consumer_number, outstanding_balance")
        .eq("agency_id", agency.id)
        .eq("is_deleted", false);
      if (cErr) throw cErr;
      const custs = (cData ?? []) as any[];
      if (custs.length === 0) return [];

      const ids = custs.map((c) => c.id);
      const { data: ledger, error: lErr } = await (supabase.from("customer_ledger") as any)
        .select("customer_id, entry_date, debit, credit, kind")
        .in("customer_id", ids)
        .order("entry_date", { ascending: true });
      if (lErr) throw lErr;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const byCust: Record<string, any[]> = {};
      (ledger ?? []).forEach((r: any) => {
        (byCust[r.customer_id] ||= []).push(r);
      });

      return custs
        .map((c): UdhariCustomer => {
          const entries = byCust[c.id] ?? [];
          // FIFO: collect debits in order, drain by chronological credits.
          const debits: { date: string; remaining: number }[] = [];
          let totalCredit = 0;
          let lastPaymentDate: string | null = null;
          for (const e of entries) {
            const debit = Number(e.debit || 0);
            const credit = Number(e.credit || 0);
            if (debit > 0) debits.push({ date: e.entry_date, remaining: debit });
            if (credit > 0) {
              totalCredit += credit;
              lastPaymentDate = e.entry_date;
            }
          }
          let remainingCredit = totalCredit;
          for (const d of debits) {
            if (remainingCredit <= 0) break;
            const take = Math.min(d.remaining, remainingCredit);
            d.remaining -= take;
            remainingCredit -= take;
          }
          const buckets = { current: 0, b30: 0, b60: 0, b90: 0, b90plus: 0 };
          let oldestUnpaidDate: string | null = null;
          for (const d of debits) {
            if (d.remaining <= 0.005) continue;
            if (!oldestUnpaidDate) oldestUnpaidDate = d.date;
            const age = daysBetween(today, new Date(d.date));
            buckets[bucketForAge(age)] += d.remaining;
          }

          // Authoritative customer ledger balance calculation: SUM(debit) - SUM(credit)
          const totalDebits = entries.reduce((a, r) => a + Number(r.debit || 0), 0);
          const totalCredits = entries.reduce((a, r) => a + Number(r.credit || 0), 0);
          const outstanding = totalDebits - totalCredits;
          
          const cached = Number(c.outstanding_balance || 0);
          const isMismatch = Math.abs(outstanding - cached) > 0.01;

          const ageDays = oldestUnpaidDate ? daysBetween(today, new Date(oldestUnpaidDate)) : 0;
          return {
            id: c.id,
            name: c.name,
            mobile: c.mobile,
            village: c.village,
            consumer_number: c.consumer_number,
            outstanding,
            oldestUnpaidDate,
            lastPaymentDate,
            ageDays,
            bucket: bucketForAge(ageDays),
            buckets,
            hasMismatch: isMismatch,
            dbOutstanding: cached
          };
        })
        .filter((c: any) => c.outstanding > 0) // Only display active debtor accounts with positive ledger balance
        .sort((a, b) => b.ageDays - a.ageDays || b.outstanding - a.outstanding);
    },
    enabled: !!agency?.id,
  });

  const villages = Array.from(new Set(customers.map((c) => c.village).filter(Boolean))) as string[];

  const hasAnyMismatch = useMemo(() => customers.some((c: any) => c.hasMismatch), [customers]);

  const aging = useMemo(() => {
    const sum = { current: 0, b30: 0, b60: 0, b90: 0, b90plus: 0, total: 0 };
    for (const c of customers) {
      sum.current += c.buckets.current;
      sum.b30 += c.buckets.b30;
      sum.b60 += c.buckets.b60;
      sum.b90 += c.buckets.b90;
      sum.b90plus += c.buckets.b90plus;
      sum.total += c.outstanding;
    }
    return sum;
  }, [customers]);

  const filtered = customers.filter((c) => {
    const ql = q.toLowerCase();
    const matchesQ =
      !q ||
      c.name.toLowerCase().includes(ql) ||
      (c.mobile && c.mobile.includes(q)) ||
      (c.consumer_number && c.consumer_number.toLowerCase().includes(ql)) ||
      (c.village && c.village.toLowerCase().includes(ql));
    const matchesVillage = villageFilter === "all" || c.village === villageFilter;
    const matchesBucket = bucketFilter === "all" || c.bucket === bucketFilter;
    return matchesQ && matchesVillage && matchesBucket;
  });

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget || !agency?.id) return;
    const amount = Number(payAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid amount.");
      return;
    }
    setBusy(true);
    try {
      const dbMode = payMode === "cheque" ? "online" : payMode;
      const dbRemarks = payMode === "cheque" ? `[CHEQUE]${payRemarks.trim() ? " " + payRemarks.trim() : ""}` : (payRemarks || "Payment against outstanding (Quick)");

      const { error } = await (supabase.from("payments") as any).insert({
        agency_id: agency.id,
        customer_id: payTarget.id,
        amount,
        mode: dbMode,
        remarks: dbRemarks,
        payment_date: new Date().toISOString().slice(0, 10),
        created_by: session?.user?.id,
      });
      if (error) throw error;
      toast.success(`Received ${fmtCurrency(amount)} from ${payTarget.name}`);
      qc.invalidateQueries({ queryKey: ["udhari-aging"] });
      qc.invalidateQueries({ queryKey: ["customer-ledger"] });
      setPayTarget(null);
      setPayAmount("");
      setPayRemarks("");
    } catch (err: any) {
      toast.error(err.message || "Failed to record payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in select-none">
      <PageHeader title={t("nav.udhari")} subtitle="Outstanding dues, aging analysis & collection priority" />



      {/* Aging buckets */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <AgingCard label="Current / Today" amount={aging.current} tone="muted" onClick={() => setBucketFilter("current")} active={bucketFilter === "current"} />
        <AgingCard label="0–30 Days" amount={aging.b30} tone="info" onClick={() => setBucketFilter("b30")} active={bucketFilter === "b30"} />
        <AgingCard label="31–60 Days" amount={aging.b60} tone="warning" onClick={() => setBucketFilter("b60")} active={bucketFilter === "b60"} />
        <AgingCard label="61–90 Days" amount={aging.b90} tone="orange" onClick={() => setBucketFilter("b90")} active={bucketFilter === "b90"} />
        <AgingCard label="90+ Days" amount={aging.b90plus} tone="danger" onClick={() => setBucketFilter("b90plus")} active={bucketFilter === "b90plus"} />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-red-100/50 bg-gradient-to-br from-red-500/5 to-transparent">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total Outstanding</div>
              <div className="text-3xl font-extrabold text-destructive tabular-nums mt-1">{fmtCurrency(aging.total)}</div>
            </div>
            <div className="h-12 w-12 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center border border-destructive/20">
              <IndianRupee className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Customers with Outstanding Balance</div>
              <div className="text-3xl font-extrabold mt-1 tabular-nums">{customers.length}</div>
            </div>
            <div className="h-12 w-12 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
              <AlertCircle className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Long Pending Outstanding</div>
              <div className="text-3xl font-extrabold mt-1 tabular-nums text-orange-600">
                {fmtCurrency(aging.b90 + aging.b90plus)}
              </div>
            </div>
            <div className="h-12 w-12 rounded-xl bg-orange-500/10 text-orange-600 flex items-center justify-center border border-orange-500/20">
              <TrendingDown className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="shadow-sm">
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="relative col-span-2">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, mobile, consumer number..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-11 pl-10"
            />
          </div>
          <Select value={villageFilter} onValueChange={setVillageFilter}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Filter by Village" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Villages</SelectItem>
              {villages.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={bucketFilter} onValueChange={(v: any) => setBucketFilter(v)}>
            <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Aging Buckets</SelectItem>
              <SelectItem value="current">Current / Today</SelectItem>
              <SelectItem value="b30">0–30 Days</SelectItem>
              <SelectItem value="b60">31–60 Days</SelectItem>
              <SelectItem value="b90">61–90 Days</SelectItem>
              <SelectItem value="b90plus">90+ Days</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Customer list */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading ledger records...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">No outstanding accounts match the active filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b bg-muted/40 font-bold text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="p-4 pl-6">Customer</th>
                    <th className="p-4">Village</th>
                    <th className="p-4 text-center">Aging</th>
                    <th className="p-4">Oldest Debt</th>
                    <th className="p-4">Last Payment</th>
                    <th className="p-4 text-right">Outstanding</th>
                    <th className="p-4 text-center pr-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((c) => {
                    const isPriority = c.ageDays > 60;
                    return (
                      <tr 
                        key={c.id} 
                        className={`transition-colors border-l-4 ${
                          isPriority 
                            ? "bg-destructive/5 hover:bg-destructive/10 border-l-destructive" 
                            : "hover:bg-muted/30 border-l-transparent"
                        }`}
                      >
                        <td className="p-4 pl-6">
                          <div className="flex items-center flex-wrap gap-1.5">
                            <span className="font-bold text-foreground">{c.name}</span>
                            {isPriority && (
                              <span className="bg-destructive/15 text-destructive border border-destructive/25 text-[8px] font-black uppercase px-1.5 py-0.5 rounded animate-pulse">
                                🚨 Priority
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 font-medium">
                            {c.mobile ?? "—"}{c.consumer_number ? ` · ${c.consumer_number}` : ""}
                          </div>
                        </td>
                      <td className="p-4 text-sm text-muted-foreground">{c.village || "—"}</td>
                      <td className="p-4 text-center"><BucketBadge bucket={c.bucket} days={c.ageDays} /></td>
                      <td className="p-4 text-xs text-muted-foreground whitespace-nowrap">
                        {c.oldestUnpaidDate ? (
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {fmtDate(c.oldestUnpaidDate)}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="p-4 text-xs text-muted-foreground whitespace-nowrap">
                        {c.lastPaymentDate ? fmtDate(c.lastPaymentDate) : <span className="text-destructive font-semibold">Never</span>}
                      </td>
                      <td className="p-4 text-right font-extrabold text-destructive tabular-nums">
                        <div className="flex items-center gap-1.5 justify-end">

                          <span>{fmtCurrency(c.outstanding)}</span>
                        </div>
                      </td>
                      <td className="p-4 text-center pr-6">
                        <div className="flex items-center justify-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setPayTarget(c)} className="h-9 hover:border-emerald-500 hover:text-emerald-600">
                            <PlusCircle className="h-4 w-4 mr-1.5" /> Receive Payment
                          </Button>
                          <Button size="sm" variant="outline" asChild className="h-9">
                            <Link to="/app/customers/$id" params={{ id: c.id }}>
                              <Eye className="h-4 w-4 mr-1.5" /> View Statement
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
 
      {/* Payment dialog */}
      <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
        <DialogContent className="max-w-md bg-white border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IndianRupee className="h-5 w-5 text-emerald-500" />
              Receive Payment — {payTarget?.name}
            </DialogTitle>
          </DialogHeader>
          {payTarget && (
            <form onSubmit={handlePayment} className="space-y-4">
              <div className="p-3 bg-red-500/5 border border-red-100 rounded-lg text-center">
                <div className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Current Outstanding</div>
                <div className="text-2xl font-extrabold text-destructive mt-1 tabular-nums">{fmtCurrency(payTarget.outstanding)}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Oldest debt {payTarget.oldestUnpaidDate ? `${payTarget.ageDays} days ago (${fmtDate(payTarget.oldestUnpaidDate)})` : "—"}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="amount">Payment Amount (INR)</Label>
                <Input 
                  id="amount" 
                  type="number" 
                  step="0.01" 
                  min="0.01"
                  required 
                  placeholder="e.g. 1000"
                  value={payAmount} 
                  onChange={(e) => setPayAmount(e.target.value)}
                  onBlur={(e) => {
                    const val = Math.max(0.01, parseFloat(e.target.value) || 0.01);
                    setPayAmount(String(val));
                  }}
                  className="h-11 font-bold text-lg" 
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mode">Payment Mode</Label>
                <Select value={payMode} onValueChange={(v: any) => setPayMode(v)}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="online">Online (UPI/Bank)</SelectItem>
                    <SelectItem value="paytm">Paytm</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="remarks">Remarks</Label>
                <Input id="remarks" placeholder="Payment against outstanding"
                  value={payRemarks} onChange={(e) => setPayRemarks(e.target.value)} className="h-11" />
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="ghost" onClick={() => setPayTarget(null)} className="h-11">Cancel</Button>
                <Button type="submit" disabled={busy} className="h-11 font-bold bg-emerald-600 hover:bg-emerald-500">
                  {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...</> : "Record Receipt"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgingCard({ label, amount, tone, onClick, active }: {
  label: string; amount: number; tone: "muted" | "info" | "warning" | "orange" | "danger";
  onClick: () => void; active: boolean;
}) {
  const tones: Record<string, string> = {
    muted: "border-slate-200 hover:border-slate-300",
    info: "border-blue-200/60 hover:border-blue-400 bg-blue-50/30",
    warning: "border-amber-200/60 hover:border-amber-400 bg-amber-50/30",
    orange: "border-orange-200/60 hover:border-orange-400 bg-orange-50/30",
    danger: "border-red-200/60 hover:border-red-400 bg-red-50/30",
  };
  const valTone: Record<string, string> = {
    muted: "text-foreground", info: "text-blue-700",
    warning: "text-amber-700", orange: "text-orange-700", danger: "text-destructive",
  };
  return (
    <button onClick={onClick} type="button"
      className={`text-left rounded-xl border-2 p-4 transition-all ${tones[tone]} ${active ? "ring-2 ring-primary ring-offset-1" : ""}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-extrabold mt-1.5 tabular-nums ${valTone[tone]}`}>{fmtCurrency(amount)}</div>
    </button>
  );
}

function BucketBadge({ bucket, days }: { bucket: Bucket; days: number }) {
  const map: Record<Bucket, { label: string; cls: string }> = {
    current: { label: "Today", cls: "bg-slate-100 text-slate-700 border-slate-200" },
    b30: { label: `${days}d`, cls: "bg-blue-50 text-blue-700 border-blue-200" },
    b60: { label: `${days}d`, cls: "bg-amber-50 text-amber-700 border-amber-200" },
    b90: { label: `${days}d`, cls: "bg-orange-50 text-orange-700 border-orange-200" },
    b90plus: { label: `${days}d`, cls: "bg-red-50 text-red-700 border-red-200" },
  };
  const m = map[bucket];
  return <span className={`inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-1 rounded border ${m.cls}`}>{m.label}</span>;
}
