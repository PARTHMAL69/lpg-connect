import { createFileRoute } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { PageHeader } from "@/components/page-header";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fmtCurrency, fmtDate, todayISO } from "@/lib/format";
import { Calendar, Plus, Trash2, Coins, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { recordManualOutstanding, deleteManualOutstanding } from "@/lib/api/ledger.functions";

export const Route = createFileRoute("/app/outstanding")({
  component: () => <RequireAgencyUser><OutstandingPage /></RequireAgencyUser>,
  head: () => ({ meta: [{ title: "Outstanding — GasFlow" }] }),
});

interface OutstandingItem {
  id: string;
  customer_name: string;
  amount: number;
  note: string;
  date: string;
}

interface CustomerOption {
  id: string;
  name: string;
  mobile: string | null;
  village: string | null;
}

function newId() { return "out-udhar-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7); }

function OutstandingPage() {
  const { agency } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [items, setItems] = useState<OutstandingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Customer list for dropdown
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  // Dialog
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  // Load customers list
  useEffect(() => {
    if (!agency) return;
    (supabase.from("customers") as any)
      .select("id, name, mobile, village")
      .eq("agency_id", agency.id)
      .eq("is_deleted", false)
      .order("name")
      .then(({ data }: { data: CustomerOption[] | null }) => setCustomers(data ?? []));
  }, [agency]);

  const customerOptions = customers.map(c => ({
    value: c.id,
    label: c.name,
    sublabel: [c.mobile, c.village].filter(Boolean).join(" · ") || undefined,
  }));

  const loadItems = async () => {
    if (!agency) return;
    setLoading(true);
    const { data } = await supabase
      .from("cash_book_days")
      .select("notes")
      .eq("agency_id", agency.id)
      .eq("book_date", date)
      .maybeSingle();
    if (data?.notes) {
      try {
        const m = JSON.parse(data.notes);
        setItems(Array.isArray(m.outstanding_entries) ? m.outstanding_entries : []);
      } catch (_) { setItems([]); }
    } else {
      setItems([]);
    }
    setLoading(false);
  };

  useEffect(() => { void loadItems(); }, [agency, date]);

  const saveItems = async (updated: OutstandingItem[]) => {
    if (!agency) return;
    const { data: existing } = await supabase
      .from("cash_book_days")
      .select("notes, opening_cash")
      .eq("agency_id", agency.id)
      .eq("book_date", date)
      .maybeSingle();

    let meta: Record<string, any> = {};
    try { if (existing?.notes) meta = JSON.parse(existing.notes); } catch (_) {}
    meta.outstanding_entries = updated;

    const { error } = await supabase.from("cash_book_days").upsert({
      agency_id: agency.id,
      book_date: date,
      opening_cash: existing?.opening_cash ?? 0,
      notes: JSON.stringify(meta),
    }, { onConflict: "agency_id,book_date" });

    if (error) toast.error(error.message);
  };

  const addItem = async (e: FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!customerName.trim() || !amt || amt <= 0) { toast.error("Enter customer name and amount."); return; }
    if (!agency) return;
    setBusy(true);

    try {
      const result = await recordManualOutstanding({
        data: {
          customerName: customerName.trim(),
          selectedCustomerId: selectedCustomerId,
          amount: amt,
          note: note.trim(),
          date,
        }
      });

      const item: OutstandingItem = {
        id: result.itemId,
        customer_name: result.customerName,
        amount: amt,
        note: note.trim(),
        date,
      };

      const updated = [...items, item];
      setItems(updated);
      await saveItems(updated);

      qc.invalidateQueries({ queryKey: ["udhari-aging"] });
      qc.invalidateQueries({ queryKey: ["customer-ledger"] });

      // Reload customers dropdown so the new customer appears immediately next time
      const { data: custData } = await (supabase.from("customers") as any)
        .select("id, name, mobile, village")
        .eq("agency_id", agency.id)
        .eq("is_deleted", false)
        .order("name");
      if (custData) setCustomers(custData);

      toast.success("Outstanding entry recorded successfully.");
      setIsOpen(false); setCustomerName(""); setAmount(""); setNote(""); setSelectedCustomerId(null);
    } catch (err: any) {
      toast.error("Failed to update credit book: " + (err.message || "Operation failed"));
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (id: string) => {
    setBusy(true);
    try {
      await deleteManualOutstanding({ data: { referenceId: id } });
      qc.invalidateQueries({ queryKey: ["udhari-aging"] });
      qc.invalidateQueries({ queryKey: ["customer-ledger"] });
    } catch (err: any) {
      toast.error("Failed to update credit book: " + (err.message || "Operation failed"));
    }

    const updated = items.filter(i => i.id !== id);
    setItems(updated);
    await saveItems(updated);
    toast.success("Entry removed.");
    setBusy(false);
  };

  const total = items.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outstanding"
        subtitle="Record money / udhari given to individuals — these appear in the Cashbook paid side"
        actions={
          <Button onClick={() => setIsOpen(true)} className="h-11 gap-2 bg-primary hover:bg-primary/90 text-white font-bold">
            <Plus className="h-4.5 w-4.5" /> Add Outstanding
          </Button>
        }
      />

      {/* Date picker */}
      <Card className="shadow-soft bg-muted/20">
        <CardContent className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary shrink-0" />
            <div>
              <h3 className="font-semibold text-sm">Distributorship Date</h3>
              <p className="text-xs text-muted-foreground">Showing entries for: <strong className="text-foreground">{fmtDate(date)}</strong></p>
            </div>
          </div>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 text-sm font-semibold w-full sm:max-w-xs" />
        </CardContent>
      </Card>

      {/* List */}
      <Card className="shadow-soft">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading...
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Coins className="h-10 w-10 mx-auto mb-3 opacity-20 text-primary" />
              <p className="font-medium">No outstanding entries recorded for {fmtDate(date)}</p>
              <p className="text-xs mt-1">Click "Add Outstanding" to record any manual money or udhari given.</p>
            </div>
          ) : (
            <>
              <div className="divide-y">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-6 py-4 hover:bg-muted/20 group transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                        <Coins className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-800">{item.customer_name}</div>
                        {item.note && <div className="text-xs text-slate-500 mt-0.5">{item.note}</div>}
                        <div className="text-xs text-muted-foreground mt-0.5">{fmtDate(date)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-black text-red-600 tabular-nums text-base">{fmtCurrency(item.amount)}</span>
                      <button type="button" onClick={() => deleteItem(item.id)} disabled={busy}
                        className="h-8 w-8 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t bg-red-50 px-6 py-4 flex justify-between items-center">
                <span className="text-sm font-bold text-red-700 uppercase tracking-wider">Total Outstanding ({fmtDate(date)})</span>
                <span className="text-xl font-black text-red-600 tabular-nums">{fmtCurrency(total)}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-sm bg-white rounded-2xl shadow-xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Coins className="h-5 w-5 text-primary" /> Record Outstanding Entry
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={addItem} className="space-y-4 mt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Date</Label>
              <Input type="text" readOnly disabled value={fmtDate(date)} className="h-11 bg-slate-50 font-medium" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Customer Name</Label>
              {customerOptions.length > 0 ? (
                <>
                  <Combobox
                    options={customerOptions}
                    value={selectedCustomerId || ""}
                    onValueChange={(val) => {
                      setSelectedCustomerId(val || null);
                      const cust = customers.find(c => c.id === val);
                      setCustomerName(cust ? cust.name : "");
                    }}
                    placeholder="Select customer from list..."
                    searchPlaceholder="Search customer..."
                    emptyMessage="No customer found."
                  />
                  {/* Allow manual override if not in list */}
                  <Input
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      setSelectedCustomerId(null);
                    }}
                    placeholder="Or type name manually..."
                    className="h-9 text-xs mt-1"
                  />
                </>
              ) : (
                <Input required value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Enter customer name..." className="h-11" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Udhari Rs (Amount)</Label>
              <Input required type="number" step="any" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="h-11 font-bold text-lg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Note (Optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Additional remarks..." rows={3} className="resize-none" />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !customerName.trim()} className="bg-primary hover:bg-primary/90 text-white font-bold h-11">
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Record Entry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
