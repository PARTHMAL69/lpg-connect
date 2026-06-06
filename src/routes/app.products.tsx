import { createFileRoute } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getStockBalances, getStockLedger, recordPurchase, recordAdjustment, recordTransfer } from "@/lib/stock-store";
import { Plus, Archive, RotateCcw, Search, Loader2, Eye, Info, Clock, User } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fmtCurrency } from "@/lib/format";
import { Switch } from "@/components/ui/switch";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getFriendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/app/products")({ component: () => <RequireAgencyUser><Page/></RequireAgencyUser> });

interface P { 
  id: string; 
  name: string; 
  rate: number; 
  is_deleted: boolean; 
  created_at: string;
  created_by: string | null; 
  updated_at: string | null;
  updated_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
}

function Page() {
  const { t } = useTranslation();
  const { agency, session } = useAuth();
  const [rows, setRows] = useState<P[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);

  // View Details & Archive confirmation states
  const [selectedProduct, setSelectedProduct] = useState<P | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  // Stock Refresh Counter
  const [stockRefreshCounter, setStockRefreshCounter] = useState(0);
  const triggerStockRefresh = () => setStockRefreshCounter(c => c + 1);

  // Stock forms states
  const [purchaseProductId, setPurchaseProductId] = useState("");
  const [purchaseQty, setPurchaseQty] = useState("");
  const [purchaseRef, setPurchaseRef] = useState("");
  const [purchaseRemarks, setPurchaseRemarks] = useState("");

  const [adjProductId, setAdjProductId] = useState("");
  const [adjQty, setAdjQty] = useState("");
  const [adjType, setAdjType] = useState<"add" | "remove">("add");
  const [adjRef, setAdjRef] = useState("");
  const [adjRemarks, setAdjRemarks] = useState("");

  const [transferProductId, setTransferProductId] = useState("");
  const [transferQty, setTransferQty] = useState("");
  const [transferRef, setTransferRef] = useState("");
  const [transferRemarks, setTransferRemarks] = useState("");

  const stockBalances = useMemo(() => {
    if (!agency) return {};
    return getStockBalances(agency.id, rows);
  }, [agency, rows, stockRefreshCounter]);

  const stockLedger = useMemo(() => {
    if (!agency) return [];
    return getStockLedger(agency.id);
  }, [agency, stockRefreshCounter]);

  const handlePurchase = (e: FormEvent) => {
    e.preventDefault();
    if (!agency || !purchaseProductId) return;
    const qty = Number(purchaseQty);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Please enter a valid quantity.");
      return;
    }
    const prodName = rows.find(p => p.id === purchaseProductId)?.name ?? "Cylinder";
    recordPurchase(agency.id, purchaseProductId, prodName, qty, purchaseRef, purchaseRemarks, session?.user?.id);
    toast.success("Stock purchase recorded successfully!");
    setPurchaseQty("");
    setPurchaseRef("");
    setPurchaseRemarks("");
    triggerStockRefresh();
  };

  const handleAdjustment = (e: FormEvent) => {
    e.preventDefault();
    if (!agency || !adjProductId) return;
    const qty = Number(adjQty);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Please enter a valid quantity.");
      return;
    }
    const prodName = rows.find(p => p.id === adjProductId)?.name ?? "Cylinder";
    recordAdjustment(agency.id, adjProductId, prodName, qty, adjType, adjRef, adjRemarks, session?.user?.id);
    toast.success("Stock adjustment recorded successfully!");
    setAdjQty("");
    setAdjRef("");
    setAdjRemarks("");
    triggerStockRefresh();
  };

  const handleTransfer = (e: FormEvent) => {
    e.preventDefault();
    if (!agency || !transferProductId) return;
    const qty = Number(transferQty);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Please enter a valid quantity.");
      return;
    }
    const prodName = rows.find(p => p.id === transferProductId)?.name ?? "Cylinder";
    recordTransfer(agency.id, transferProductId, prodName, qty, transferRef, transferRemarks, session?.user?.id);
    toast.success("Stock transfer recorded successfully!");
    setTransferQty("");
    setTransferRef("");
    setTransferRemarks("");
    triggerStockRefresh();
  };

  const load = async () => {
    if (!agency) return;
    setLoading(true);
    try {
      let query = (supabase.from("products") as any).select("*").eq("agency_id", agency.id);
      
      if (!showArchived) {
        query = query.eq("is_deleted", false);
      }
      
      const { data, error } = await query.order("name");
      if (error) throw error;
      setRows((data ?? []) as unknown as P[]);
    } catch (err: any) {
      toast.error(getFriendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [agency, showArchived]);

  const saveRate = async (id: string, rate: number) => {
    try {
      const { error } = await (supabase.from("products") as any).update({ 
        rate,
        updated_by: session?.user?.id 
      }).eq("id", id);
      
      if (error) throw error;
      toast.success("Rate successfully updated.");
      void load();
    } catch (err: any) {
      toast.error(getFriendlyError(err));
    }
  };

  const archiveRow = async () => {
    if (!confirmArchiveId || !session) return;
    setArchiving(true);
    try {
      const { error } = await (supabase.from("products") as any).update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: session.user.id
      }).eq("id", confirmArchiveId);

      if (error) throw error;
      toast.success("Product successfully archived.");
      setConfirmArchiveId(null);
      void load();
    } catch (err: any) {
      toast.error(getFriendlyError(err));
    } finally {
      setArchiving(false);
    }
  };

  const restoreRow = async (id: string) => {
    try {
      const { error } = await (supabase.from("products") as any).update({
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        updated_by: session?.user?.id
      }).eq("id", id);

      if (error) throw error;
      toast.success("Product successfully restored.");
      void load();
    } catch (err: any) {
      toast.error(getFriendlyError(err));
    }
  };

  const filtered = rows.filter((r) => 
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 pb-8">
      <PageHeader title={t("products.title")} actions={
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button className="h-11">
              <Plus className="h-4.5 w-4.5 mr-1.5" />{t("products.addProduct")}
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{t("products.addProduct")}</SheetTitle>
            </SheetHeader>
            <NewForm 
              agencyId={agency?.id} 
              userId={session?.user?.id}
              onDone={() => { setOpen(false); void load(); }} 
            />
          </SheetContent>
        </Sheet>
      } />

      {/* Primary Navigation Tabs */}
      <Tabs defaultValue="catalog" className="space-y-6">
        <TabsList className="grid grid-cols-3 max-w-lg">
          <TabsTrigger value="catalog">{t("products.title")}</TabsTrigger>
          <TabsTrigger value="stock">LPG Stock Management</TabsTrigger>
          <TabsTrigger value="ledger">Product Movement Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="space-y-6 pt-2">
          {/* Filters Bar */}
          <Card className="shadow-soft"><CardContent className="p-4 flex flex-wrap gap-4 items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Input 
                placeholder="Search products..." 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
                className="h-10 pl-9"
              />
              <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
            <div className="flex items-center space-x-2">
              <Switch 
                id="archived" 
                checked={showArchived} 
                onCheckedChange={setShowArchived}
              />
              <Label htmlFor="archived" className="text-sm font-semibold text-muted-foreground cursor-pointer select-none">
                Show Archived Products
              </Label>
            </div>
          </CardContent></Card>

          <Card className="shadow-card overflow-hidden">
            <CardContent className="p-0">
              {loading ? (
                <div className="p-12 text-center text-xs text-muted-foreground animate-pulse">Loading products database...</div>
              ) : filtered.length === 0 ? (
                <EmptyState title={t("common.noData")} />
              ) : (
                <div className="divide-y divide-border/60 border-slate-100">
                  {filtered.map((p) => (
                    <div 
                      key={p.id} 
                      onClick={() => { setSelectedProduct(p); setShowDetails(true); }}
                      className={`p-4 flex flex-wrap items-center justify-between gap-4 transition-colors cursor-pointer ${
                        p.is_deleted ? "bg-slate-50/50 text-muted-foreground line-through" : "hover:bg-accent/5"
                      }`}
                    >
                      <div className="font-bold text-foreground flex items-center gap-2">
                        {p.name}
                        {p.is_deleted && (
                          <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded bg-muted text-muted-foreground border">
                            Archived
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <Input 
                            type="number" 
                            disabled={p.is_deleted}
                            defaultValue={p.rate} 
                            className="h-10 w-28 text-right font-bold"
                            onBlur={(e) => { const v = Number(e.target.value); if (v !== p.rate) void saveRate(p.id, v); }} 
                          />
                          <span className="text-xs text-muted-foreground w-20 text-right font-semibold">{fmtCurrency(p.rate)}</span>
                        </div>

                        <div className="flex gap-1.5">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => { setSelectedProduct(p); setShowDetails(true); }}
                            className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          {p.is_deleted ? (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => restoreRow(p.id)}
                              className="h-9 px-2 gap-1 text-success hover:bg-success/5 font-semibold text-xs"
                            >
                              <RotateCcw className="h-4 w-4" /> Restore
                            </Button>
                          ) : (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => setConfirmArchiveId(p.id)}
                              className="h-9 px-2 gap-1 text-destructive hover:bg-destructive/5 font-semibold text-xs"
                            >
                              <Archive className="h-4 w-4" /> Archive
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stock" className="space-y-6 pt-2">
          {/* Real-time stock status summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Live Balances Table Card */}
            <div className="lg:col-span-2 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">LPG Real-time Cylinder Stock Roster</h3>
              <Card className="shadow-card overflow-hidden"><CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-border/80 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                        <th className="p-4">Product Name</th>
                        <th className="p-4 text-center">Opening Stock</th>
                        <th className="p-4 text-center">Inbound (Purchases)</th>
                        <th className="p-4 text-center">Outbound (Sales/Transfers)</th>
                        <th className="p-4 text-right">Closing Stock Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {rows.filter(r => !r.is_deleted).map((p) => {
                        const bal = stockBalances[p.id] || { openingStock: 0, currentStock: 0 };
                        const led = stockLedger.filter(l => l.productId === p.id);
                        const purchases = led.filter(l => l.type === 'purchase').reduce((s, l) => s + l.quantity, 0);
                        const sales = led.filter(l => l.type === 'sale' || l.type === 'transfer').reduce((s, l) => s + Math.abs(l.quantity), 0);

                        return (
                          <tr key={p.id} className="hover:bg-muted/5 transition-colors">
                            <td className="p-4 font-bold text-foreground">{p.name}</td>
                            <td className="p-4 text-center font-semibold text-slate-500">{bal.openingStock} units</td>
                            <td className="p-4 text-center font-semibold text-emerald-600">+{purchases}</td>
                            <td className="p-4 text-center font-semibold text-rose-600">-{sales}</td>
                            <td className="p-4 text-right bg-primary-soft/5">
                              <span className={`inline-block font-extrabold text-sm ${
                                bal.currentStock > 15 ? "text-primary" : "text-destructive font-black animate-pulse"
                              }`}>
                                {bal.currentStock} unit(s)
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent></Card>
            </div>

            {/* Quick Action Forms Card Stack */}
            <div className="space-y-6">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Record Inventory Movements</h3>

              {/* Purchase form card */}
              <Card className="shadow-soft border"><CardContent className="p-4">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b pb-2 flex items-center gap-1.5">
                  📥 Record Stock Purchase
                </h4>
                <form onSubmit={handlePurchase} className="space-y-3.5 mt-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Product</Label>
                    <Select value={purchaseProductId} onValueChange={setPurchaseProductId} required>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select Cylinder..." /></SelectTrigger>
                      <SelectContent>
                        {rows.filter(r => !r.is_deleted).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Quantity</Label>
                      <Input type="number" min="1" required value={purchaseQty} onChange={(e) => setPurchaseQty(e.target.value)} className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Invoice No / Ref</Label>
                      <Input placeholder="Ref bill..." required value={purchaseRef} onChange={(e) => setPurchaseRef(e.target.value)} className="h-9 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Remarks</Label>
                    <Input placeholder="Supplier details..." value={purchaseRemarks} onChange={(e) => setPurchaseRemarks(e.target.value)} className="h-9 text-xs" />
                  </div>
                  <Button type="submit" size="sm" className="w-full h-9 bg-emerald-600 text-white hover:bg-emerald-700 font-semibold text-xs">
                    Confirm Purchase Receipt
                  </Button>
                </form>
              </CardContent></Card>

              {/* Adjustment form card */}
              <Card className="shadow-soft border"><CardContent className="p-4">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b pb-2 flex items-center gap-1.5">
                  🔧 Record Stock Adjustment
                </h4>
                <form onSubmit={handleAdjustment} className="space-y-3.5 mt-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Product</Label>
                    <Select value={adjProductId} onValueChange={setAdjProductId} required>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select Cylinder..." /></SelectTrigger>
                      <SelectContent>
                        {rows.filter(r => !r.is_deleted).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Qty / Delta</Label>
                      <Input type="number" min="1" required value={adjQty} onChange={(e) => setAdjQty(e.target.value)} className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Action Type</Label>
                      <Select value={adjType} onValueChange={(v: any) => setAdjType(v)} required>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="add">Add (+)</SelectItem>
                          <SelectItem value="remove">Deduct (-)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Audit Code / Ref</Label>
                    <Input placeholder="e.g. AUDIT-2026" required value={adjRef} onChange={(e) => setAdjRef(e.target.value)} className="h-9 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Reason / Remarks</Label>
                    <Input placeholder="e.g. Cylinder leakage void" value={adjRemarks} onChange={(e) => setAdjRemarks(e.target.value)} className="h-9 text-xs" />
                  </div>
                  <Button type="submit" size="sm" className="w-full h-9 bg-amber-600 text-white hover:bg-amber-700 font-semibold text-xs">
                    Confirm Stock Adjustment
                  </Button>
                </form>
              </CardContent></Card>

              {/* Transfer form card */}
              <Card className="shadow-soft border"><CardContent className="p-4">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b pb-2 flex items-center gap-1.5">
                  🚚 Record Stock Transfer
                </h4>
                <form onSubmit={handleTransfer} className="space-y-3.5 mt-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Product</Label>
                    <Select value={transferProductId} onValueChange={setTransferProductId} required>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select Cylinder..." /></SelectTrigger>
                      <SelectContent>
                        {rows.filter(r => !r.is_deleted).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Quantity</Label>
                      <Input type="number" min="1" required value={transferQty} onChange={(e) => setTransferQty(e.target.value)} className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Truck No / Ref</Label>
                      <Input placeholder="MH-12-3456" required value={transferRef} onChange={(e) => setTransferRef(e.target.value)} className="h-9 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Target Destination</Label>
                    <Input placeholder="e.g. Village Route Shop" value={transferRemarks} onChange={(e) => setTransferRemarks(e.target.value)} className="h-9 text-xs" />
                  </div>
                  <Button type="submit" size="sm" className="w-full h-9 bg-blue-600 text-white hover:bg-blue-700 font-semibold text-xs">
                    Confirm Stock Transfer
                  </Button>
                </form>
              </CardContent></Card>

            </div>
          </div>
        </TabsContent>

        <TabsContent value="ledger" className="space-y-6 pt-2">
          {/* Movement Ledger chronological log */}
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Product Movement Ledger Audit Trail</h3>
          <Card className="shadow-card overflow-hidden"><CardContent className="p-0">
            {stockLedger.length === 0 ? <EmptyState title="No stock movements logged yet." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-border/80 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                      <th className="p-4">Timestamp</th>
                      <th className="p-4">Product Name</th>
                      <th className="p-4">Movement Type</th>
                      <th className="p-4 text-center">Quantity Delta</th>
                      <th className="p-4">Reference No</th>
                      <th className="p-4">Audit Details</th>
                      <th className="p-4">Cashier</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {stockLedger.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/5 transition-colors">
                        <td className="p-4 font-semibold text-foreground whitespace-nowrap">{new Date(item.created_at).toLocaleString()}</td>
                        <td className="p-4 font-bold text-foreground">{item.productName}</td>
                        <td className="p-4 whitespace-nowrap">
                          <span className={`inline-block text-[9px] uppercase font-black px-2 py-0.5 rounded border ${
                            item.type === 'purchase' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                            item.type === 'sale' ? 'bg-rose-50 text-rose-600 border-rose-200' :
                            item.type === 'transfer' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                            'bg-amber-50 text-amber-600 border-amber-200'
                          }`}>
                            {item.type}
                          </span>
                        </td>
                        <td className={`p-4 text-center font-bold text-sm ${item.quantity > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {item.quantity > 0 ? `+${item.quantity}` : item.quantity}
                        </td>
                        <td className="p-4 font-mono text-[10px] text-foreground font-semibold uppercase">{item.reference.substring(0, 8)}</td>
                        <td className="p-4 font-medium text-slate-500">{item.description}</td>
                        <td className="p-4 text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                          {item.created_by ? `UID:${item.created_by.substring(0, 8)}` : "System / Seeder"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Product Details & System Audit Trail Modal */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md bg-white border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" /> Product Registry Details
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Ref ID: <span className="font-mono font-semibold text-foreground uppercase">{selectedProduct?.id}</span>
            </DialogDescription>
          </DialogHeader>

          {selectedProduct && (
            <div className="space-y-5 mt-4">
              
              {/* Primary metrics panel */}
              <div className="grid grid-cols-2 gap-4 bg-muted/40 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Product Rate</span>
                  <div className="font-black text-lg text-primary mt-0.5">
                    {fmtCurrency(selectedProduct.rate)}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Registry Status</span>
                  <div className="mt-0.5">
                    {selectedProduct.is_deleted ? (
                      <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">Archived</span>
                    ) : (
                      <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded bg-success/15 text-success border border-success/20">Active Catalog</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Data fields */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b pb-1">Product Details</h4>
                
                <div className="grid grid-cols-2 gap-y-2 text-xs">
                  <div className="text-muted-foreground">Product Name</div>
                  <div className="font-bold text-foreground text-right">{selectedProduct.name}</div>

                  <div className="text-muted-foreground">Current Catalog Rate</div>
                  <div className="font-bold text-foreground text-right">{fmtCurrency(selectedProduct.rate)}</div>
                </div>
              </div>

              {/* AUDIT TRAIL METADATA SECTION */}
              <div className="space-y-2.5 bg-slate-50/50 p-4 rounded-xl border border-dashed border-slate-200">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 select-none">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" /> System Records
                </h4>
                
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex justify-between items-center">
                    <span>Created At</span>
                    <span className="font-semibold text-foreground">
                      {new Date(selectedProduct.created_at).toLocaleString()}
                    </span>
                  </div>

                  {selectedProduct.updated_at && selectedProduct.updated_by && (
                    <div className="flex justify-between items-center border-t pt-1.5 mt-1.5">
                      <span>Last Updated At</span>
                      <span className="font-semibold text-foreground">
                        {new Date(selectedProduct.updated_at).toLocaleString()}
                      </span>
                    </div>
                  )}

                  {selectedProduct.is_deleted && (
                    <div className="space-y-1.5 border-t border-destructive/25 pt-1.5 mt-1.5 bg-destructive/5 -mx-4 -mb-4 p-4 rounded-b-xl text-destructive-dark">
                      <div className="flex justify-between items-center">
                        <span>Archived At</span>
                        <span className="font-extrabold text-destructive-dark text-right">
                          {selectedProduct.deleted_at ? new Date(selectedProduct.deleted_at).toLocaleString() : "—"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                {selectedProduct.is_deleted ? (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      void restoreRow(selectedProduct.id);
                      setShowDetails(false);
                    }}
                    className="border-success/30 hover:bg-success/5 text-success font-bold"
                  >
                    <RotateCcw className="h-4 w-4 mr-1.5" /> Restore Product to Catalog
                  </Button>
                ) : (
                  <Button 
                    variant="destructive"
                    onClick={() => {
                      setShowDetails(false);
                      setConfirmArchiveId(selectedProduct.id);
                    }}
                    className="font-bold"
                  >
                    <Archive className="h-4 w-4 mr-1.5" /> Archive Product
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setShowDetails(false)}>Close</Button>
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Archive Product */}
      <Dialog open={!!confirmArchiveId} onOpenChange={(v) => { if (!v) setConfirmArchiveId(null); }}>
        <DialogContent className="max-w-sm bg-white border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-destructive flex items-center gap-2">
              ⚠️ Archive Product?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-2">
              Are you sure you want to archive this product? Active catalogs will update immediately. No historical transaction sales data will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setConfirmArchiveId(null)} disabled={archiving}>
              Cancel
            </Button>
            <Button onClick={archiveRow} disabled={archiving} className="bg-destructive hover:bg-destructive-dark text-white font-bold">
              {archiving ? "Archiving..." : "Yes, Archive Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function NewForm({ agencyId, userId, onDone }: { agencyId?: string; userId?: string; onDone: () => void }) {
  const [name, setName] = useState(""); 
  const [rate, setRate] = useState("0"); 
  const [busy, setBusy] = useState(false);
  
  const submit = async (e: FormEvent) => {
    e.preventDefault(); 
    if (!agencyId) return; 
    setBusy(true);
    
    try {
      const { error } = await (supabase.from("products") as any).insert({ 
        agency_id: agencyId, 
        name, 
        rate: Number(rate),
        created_by: userId
      });
      
      if (error) throw error;
      toast.success("Product successfully created!"); 
      onDone(); 
    } catch (err: any) {
      toast.error(getFriendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4.5 mt-6">
      <div className="space-y-1.5">
        <Label>Product Name</Label>
        <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 14 KG Home Delivery" className="h-11" />
      </div>
      <div className="space-y-1.5">
        <Label>Product Rate (₹)</Label>
        <Input required type="number" value={rate} onChange={(e) => setRate(e.target.value)} className="h-11" />
      </div>
      <Button type="submit" disabled={busy} className="w-full h-12 font-semibold shadow-soft">
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Save Product
      </Button>
    </form>
  );
}
