import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Search, IndianRupee, Eye, PlusCircle, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { fmtCurrency, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/app/udhari")({
  head: () => ({ meta: [{ title: "Udhari Ledger — GasFlow" }] }),
  component: UdhariPage,
});

function UdhariPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agency, session } = useAuth();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [villageFilter, setVillageFilter] = useState("all");
  const [payTarget, setPayTarget] = useState<{ id: string; name: string; outstanding: number } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState<"cash" | "online" | "paytm">("cash");
  const [payRemarks, setPayRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  // 1. Fetch customers with positive outstanding balance
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["udhari-customers", agency?.id],
    queryFn: async () => {
      if (!agency?.id) return [];
      const { data, error } = await (supabase.from("customers") as any)
        .select("id, name, mobile, village, consumer_number, outstanding:outstanding_balance")
        .eq("agency_id", agency.id)
        .eq("is_deleted", false)
        .gt("outstanding_balance", 0)
        .order("outstanding_balance", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        ...c,
        outstanding: Number(c.outstanding)
      }));
    },
    enabled: !!agency?.id,
  });

  // Calculate unique villages for filter
  const villages = Array.from(new Set(customers.map((c: any) => c.village).filter(Boolean))) as string[];

  // Filtered list
  const filtered = customers.filter((c: any) => {
    const matchesQ = 
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      (c.mobile && c.mobile.includes(q)) ||
      (c.consumer_number && c.consumer_number.toLowerCase().includes(q.toLowerCase())) ||
      (c.village && c.village.toLowerCase().includes(q.toLowerCase()));
    
    const matchesVillage = villageFilter === "all" || c.village === villageFilter;

    return matchesQ && matchesVillage;
  });

  // Total aggregate outstanding
  const totalOutstanding = customers.reduce((acc: number, curr: any) => acc + curr.outstanding, 0);

  // 2. Mutation to record quick payment
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
      const { error } = await (supabase.from("payments") as any).insert({
        agency_id: agency.id,
        customer_id: payTarget.id,
        amount,
        mode: payMode,
        remarks: payRemarks || "Payment against outstanding (Quick)",
        payment_date: new Date().toISOString().slice(0, 10),
        created_by: session?.user?.id,
      });

      if (error) throw error;

      toast.success(`Received ${fmtCurrency(amount)} from ${payTarget.name}`);
      qc.invalidateQueries({ queryKey: ["udhari-customers"] });
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
      <div className="flex items-center justify-between flex-wrap gap-4">
        <PageHeader title="Udhari Ledger" subtitle="Monitor and collect outstanding customer dues" />
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-red-100/50 bg-gradient-to-br from-red-500/5 to-transparent">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total Outstanding Dues</div>
              <div className="text-3xl font-extrabold text-destructive tracking-tight tabular-nums mt-1">
                {fmtCurrency(totalOutstanding)}
              </div>
            </div>
            <div className="h-12 w-12 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center border border-destructive/20 shadow-sm">
              <IndianRupee className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Pending Customers</div>
              <div className="text-3xl font-extrabold tracking-tight mt-1 tabular-nums">
                {customers.length}
              </div>
            </div>
            <div className="h-12 w-12 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20 shadow-sm">
              <AlertCircle className="h-6 w-6 animate-pulse" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Filtered Customers</div>
              <div className="text-3xl font-extrabold tracking-tight mt-1 tabular-nums">
                {filtered.length}
              </div>
            </div>
            <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-sm">
              <Search className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="shadow-sm">
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            <SelectTrigger className="h-11">
              <SelectValue placeholder="Filter by Village" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Villages</SelectItem>
              {villages.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Outstanding Dues Ledger Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading ledger records...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              No outstanding accounts match the active search criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b bg-muted/40 font-bold text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="p-4 pl-6">Customer Details</th>
                    <th className="p-4">Mobile</th>
                    <th className="p-4">Village</th>
                    <th className="p-4 text-right">Outstanding Amount</th>
                    <th className="p-4 text-center pr-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((c: any) => (
                    <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-4 pl-6">
                        <div className="font-bold text-foreground">{c.name}</div>
                        {c.consumer_number && (
                          <div className="text-xs text-muted-foreground mt-0.5 font-semibold">
                            CUS NO: {c.consumer_number}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-sm font-semibold text-muted-foreground">
                        {c.mobile || "—"}
                      </td>
                      <td className="p-4 text-sm font-semibold text-muted-foreground">
                        {c.village || "—"}
                      </td>
                      <td className="p-4 text-right font-extrabold text-destructive tabular-nums">
                        {fmtCurrency(c.outstanding)}
                      </td>
                      <td className="p-4 text-center pr-6 flex items-center justify-center gap-2">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => setPayTarget(c)}
                          className="h-9 hover:border-emerald-500 hover:text-emerald-500"
                        >
                          <PlusCircle className="h-4 w-4 mr-1.5" /> Record Pay
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate({ to: "/app/customers/$id", params: { id: c.id } })}
                          className="h-9"
                        >
                          <Eye className="h-4 w-4 mr-1.5" /> View Ledger
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record Payment Dialog */}
      <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IndianRupee className="h-5 w-5 text-emerald-500" />
              Collect Payment — {payTarget?.name}
            </DialogTitle>
          </DialogHeader>

          {payTarget && (
            <form onSubmit={handlePayment} className="space-y-4">
              <div className="p-3 bg-red-500/5 border border-red-100 rounded-lg text-center">
                <div className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Current Outstanding Dues</div>
                <div className="text-2xl font-extrabold text-destructive mt-1 tabular-nums">
                  {fmtCurrency(payTarget.outstanding)}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="amount">Payment Amount (INR)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 1000"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="h-11 font-bold text-foreground text-lg"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mode">Payment Mode</Label>
                <Select value={payMode} onValueChange={(v: any) => setPayMode(v)}>
                  <SelectTrigger className="h-11 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="online">Online Transfer (UPI/Bank)</SelectItem>
                    <SelectItem value="paytm">PayTM Wallet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="remarks">Remarks / Description</Label>
                <Input
                  id="remarks"
                  placeholder="Payment against outstanding"
                  value={payRemarks}
                  onChange={(e) => setPayRemarks(e.target.value)}
                  className="h-11"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button 
                  type="button" 
                  variant="ghost" 
                  onClick={() => setPayTarget(null)}
                  className="h-11 font-semibold"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={busy} 
                  className="h-11 font-bold bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98]"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Collecting...
                    </>
                  ) : (
                    "Record Receipt"
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
