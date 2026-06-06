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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Plus, Search, Edit, Trash2, RotateCcw, User, Phone, DollarSign, Calendar, Eye, Download, FileText, X, BadgeCheck, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { exportToExcel, exportToPDF } from "@/lib/exports";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getFriendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/app/delivery-boys")({ component: () => <RequireAgencyUser><Page/></RequireAgencyUser> });

interface DeliveryBoy {
  id: string;
  name: string;
  mobile: string | null;
  commission_rate: number;
  is_deleted: boolean;
}

interface DeliveryHistoryItem {
  id: string;
  sale_date: string;
  customer_name: string | null;
  product_name: string;
  quantity: number;
  total: number;
  commission_total: number;
  net_amount: number;
  payment_mode: string;
}

interface SettlementHistoryItem {
  id: string;
  settlement_date: string;
  collection_amount: number;
  commission_amount: number;
  net_submitted: number;
  status: string;
  remarks: string | null;
}

function Page() {
  const { t } = useTranslation();
  const { agency, session } = useAuth();
  const [rows, setRows] = useState<DeliveryBoy[]>([]);
  const [open, setOpen] = useState(false);
  const [editBoy, setEditBoy] = useState<DeliveryBoy | null>(null);
  
  // Profile Detail state
  const [selectedBoy, setSelectedBoy] = useState<DeliveryBoy | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryHistoryItem[]>([]);
  
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  // Archive confirmation states
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

  const [routeDeliveries, setRouteDeliveries] = useState<any[]>([]);
  const [qRegister, setQRegister] = useState("");
  const [filterRegisterBoy, setFilterRegisterBoy] = useState("all");
  const [filterRegisterVillage, setFilterRegisterVillage] = useState("all");

  const load = async () => {
    if (!agency) return;
    let query = supabase.from("delivery_boys").select("id, name, mobile, commission_rate:default_commission, is_deleted").eq("agency_id", agency.id);
    if (!showArchived) {
      query = query.eq("is_deleted", false);
    }
    const { data } = await query.order("name");
    setRows((data ?? []) as unknown as DeliveryBoy[]);

    // Fetch Daily Route Register deliveries
    const { data: salesData } = await supabase
      .from("sales")
      .select("id, sale_date, quantity, gross_amount, commission_amount, payment_mode, customer:customers(name, village), product:products(name), delivery_boy:delivery_boys(name, id)")
      .eq("agency_id", agency.id)
      .not("delivery_boy_id", "is", null)
      .eq("is_deleted", false)
      .order("sale_date", { ascending: false });
    setRouteDeliveries(salesData ?? []);
  };

  const loadDetails = async (boy: DeliveryBoy) => {
    // Load deliveries
    const { data: dData } = await supabase
      .from("sales")
      .select("id, sale_date, quantity, gross_amount, commission_amount, net_amount, payment_mode, customer:customers(name), product:products(name)")
      .eq("delivery_boy_id", boy.id)
      .eq("is_deleted", false)
      .order("sale_date", { ascending: false });

    const formattedDeliveries = ((dData ?? []) as any[]).map((d) => ({
      id: d.id,
      sale_date: d.sale_date,
      customer_name: d.customer?.name ?? "—",
      product_name: d.product?.name ?? "—",
      quantity: Number(d.quantity),
      total: Number(d.gross_amount),
      commission_total: Number(d.commission_amount || 0),
      net_amount: Number(d.net_amount),
      payment_mode: d.payment_mode
    }));
    setDeliveries(formattedDeliveries);
  };

  useEffect(() => {
    void load();
  }, [agency, showArchived]);

  useEffect(() => {
    if (selectedBoy) {
      void loadDetails(selectedBoy);
    }
  }, [selectedBoy]);

  const filtered = useMemo(() => {
    return rows.filter((b) => {
      const matchesSearch = !q.trim() || 
        b.name.toLowerCase().includes(q.toLowerCase()) || 
        (b.mobile ?? "").includes(q);
      return matchesSearch;
    });
  }, [rows, q]);

  const voidBoy = async () => {
    if (!confirmVoidId || !session) return;
    setVoiding(true);
    try {
      const { error } = await (supabase
        .from("delivery_boys") as any)
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: session.user.id
        })
        .eq("id", confirmVoidId);

      if (error) throw error;
      toast.success("Delivery boy archived successfully.");
      setConfirmVoidId(null);
      void load();
    } catch (err: any) {
      toast.error(getFriendlyError(err));
    } finally {
      setVoiding(false);
    }
  };

  const restoreBoy = async (id: string) => {
    const { error } = await (supabase
      .from("delivery_boys") as any)
      .update({
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        updated_by: session?.user?.id
      })
      .eq("id", id);

    if (error) {
      toast.error(getFriendlyError(error));
    } else {
      toast.success("Delivery boy restored successfully.");
      void load();
    }
  };

  const doExport = (kind: "pdf" | "xlsx") => {
    if (kind === "pdf") {
      const cols = ["Name", "Mobile Number", "Commission / Unit (INR)", "Status"];
      const data = filtered.map((b) => [
        b.name,
        b.mobile ?? "—",
        fmtCurrency(b.commission_rate),
        b.is_deleted ? "Archived" : "Active"
      ]);
      exportToPDF("Delivery Team Roster", cols, data, "delivery_team");
    } else {
      const data = filtered.map((b) => ({
        Name: b.name,
        Mobile: b.mobile ?? "—",
        "Commission Rate (INR)": Number(b.commission_rate),
        Status: b.is_deleted ? "Archived" : "Active"
      }));
      exportToExcel(data, "delivery_team", "Delivery Roster");
    }
  };

  // Calculations for profile details
  const stats = useMemo(() => {
    const totalDeliveries = deliveries.reduce((acc, d) => acc + d.quantity, 0);
    const cashDeliveries = deliveries.filter((d) => d.payment_mode === "cash");
    const totalCashCollections = cashDeliveries.reduce((acc, d) => acc + d.total, 0);
    const totalCommissionEarned = deliveries.reduce((acc, d) => acc + d.commission_total, 0);
    const totalNetCollection = deliveries.reduce((acc, d) => acc + d.net_amount, 0);
    
    return {
      totalDeliveries,
      totalCashCollections,
      totalCommissionEarned,
      totalNetCollection
    };
  }, [deliveries]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("delivery.title")} actions={
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11">
                <Download className="h-4.5 w-4.5 mr-1.5" />{t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("pdf")}><FileText className="h-4 w-4 mr-2" />PDF Roster</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx")}><FileText className="h-4 w-4 mr-2" />Excel Sheet</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Sheet open={open || !!editBoy} onOpenChange={(v) => { if (!v) { setOpen(false); setEditBoy(null); } }}>
            <SheetTrigger asChild>
              <Button onClick={() => setOpen(true)} className="h-11">
                <Plus className="h-4.5 w-4.5 mr-1.5" />{t("delivery.addBoy")}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{editBoy ? "Edit Delivery Boy Details" : t("delivery.addBoy")}</SheetTitle>
              </SheetHeader>
              <DeliveryBoyForm 
                editBoy={editBoy} 
                onDone={() => { setOpen(false); setEditBoy(null); void load(); }} 
              />
            </SheetContent>
          </Sheet>
        </div>
      } />

      {/* Main Navigation Tabs */}
      <Tabs defaultValue="directory" className="space-y-6">
        <TabsList className="grid grid-cols-2 max-w-sm">
          <TabsTrigger value="directory">Team Directory</TabsTrigger>
          <TabsTrigger value="register">Daily Route Register</TabsTrigger>
        </TabsList>

        <TabsContent value="directory" className="space-y-6 pt-2">
          {/* Search and Filters for Directory */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
            <div className="relative md:col-span-2">
              <Input 
                placeholder="Search by name, mobile number..." 
                value={q} 
                onChange={(e) => setQ(e.target.value)} 
                className="h-11 pl-9 text-sm"
              />
              <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
            <div className="flex items-center gap-2 md:justify-end">
              <Switch id="archived" checked={showArchived} onCheckedChange={setShowArchived} />
              <Label htmlFor="archived" className="text-xs font-medium cursor-pointer">Show Archived / Deleted Boys</Label>
            </div>
          </div>

          {/* Roster Cards Grid */}
          {filtered.length === 0 ? <EmptyState title={t("common.noData")} /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((b) => (
                <Card key={b.id} className={`shadow-soft overflow-hidden border hover:border-primary/40 transition-colors ${b.is_deleted ? "bg-destructive/5 text-muted-foreground" : ""}`}>
                  <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className={`font-bold text-lg ${b.is_deleted ? "line-through" : ""}`}>{b.name}</h3>
                        <p className="text-sm text-muted-foreground flex items-center mt-1">
                          <Phone className="h-3.5 w-3.5 mr-1" /> {b.mobile ?? "—"}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Commission</span>
                        <p className="text-lg font-bold text-primary">{fmtCurrency(b.commission_rate)} <span className="text-xs text-muted-foreground font-normal">/ unit</span></p>
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end border-t pt-3 mt-auto">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-9 gap-1"
                        onClick={() => setSelectedBoy(b)}
                      >
                        <Eye className="h-3.5 w-3.5" /> View Profile
                      </Button>

                      {!b.is_deleted ? (
                        <>
                          <Button 
                            variant="outline" 
                            size="icon" 
                            className="h-9 w-9 hover:text-primary"
                            onClick={() => setEditBoy(b)}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="icon" 
                            className="h-9 w-9 hover:text-destructive hover:bg-destructive/5 text-destructive/70"
                            onClick={() => setConfirmVoidId(b.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-9 w-9 text-primary hover:bg-primary/5"
                          onClick={() => restoreBoy(b.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="register" className="space-y-6 pt-2">
          {/* Daily Route Register filters */}
          <Card className="shadow-soft"><CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Search Register</Label>
                <div className="relative">
                  <Input 
                    placeholder="Search route, boy, customer..." 
                    value={qRegister} 
                    onChange={(e) => setQRegister(e.target.value)} 
                    className="h-10 pl-9 text-sm"
                  />
                  <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Delivery Partner</Label>
                <Select value={filterRegisterBoy} onValueChange={setFilterRegisterBoy}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Delivery Boys</SelectItem>
                    {rows.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Route / Village</Label>
                <Select value={filterRegisterVillage} onValueChange={setFilterRegisterVillage}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Routes / Villages</SelectItem>
                    {Array.from(new Set(routeDeliveries.map(d => d.customer?.village).filter(Boolean))).sort().map(v => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent></Card>

          {/* Daily Route Register log */}
          <Card className="shadow-card overflow-hidden"><CardContent className="p-0">
            {(() => {
              const list = routeDeliveries.filter((d) => {
                const boyName = d.delivery_boy?.name ?? "";
                const custName = d.customer?.name ?? "";
                const village = d.customer?.village ?? "";
                const prodName = d.product?.name ?? "";
                const matchesSearch = !qRegister.trim() || 
                  boyName.toLowerCase().includes(qRegister.toLowerCase()) ||
                  custName.toLowerCase().includes(qRegister.toLowerCase()) ||
                  village.toLowerCase().includes(qRegister.toLowerCase()) ||
                  prodName.toLowerCase().includes(qRegister.toLowerCase());
                const matchesBoy = filterRegisterBoy === "all" || d.delivery_boy?.id === filterRegisterBoy;
                const matchesVillage = filterRegisterVillage === "all" || village === filterRegisterVillage;
                return matchesSearch && matchesBoy && matchesVillage;
              });

              if (list.length === 0) return <EmptyState title="No route delivery records logged." />;

              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-border/80 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                        <th className="p-4">Date</th>
                        <th className="p-4">Delivery Boy</th>
                        <th className="p-4">Customer</th>
                        <th className="p-4">Route / Village</th>
                        <th className="p-4">Product</th>
                        <th className="p-4 text-center">Qty</th>
                        <th className="p-4 text-right">Commission</th>
                        <th className="p-4 text-center">Sale Mode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {list.map((item) => (
                        <tr key={item.id} className="hover:bg-muted/5 transition-colors">
                          <td className="p-4 font-semibold text-foreground whitespace-nowrap">{fmtDate(item.sale_date)}</td>
                          <td className="p-4 font-bold text-primary">{item.delivery_boy?.name}</td>
                          <td className="p-4 font-semibold text-foreground">{item.customer?.name}</td>
                          <td className="p-4 whitespace-nowrap font-medium text-slate-500">{item.customer?.village ?? "—"}</td>
                          <td className="p-4 font-semibold text-slate-700">{item.product?.name}</td>
                          <td className="p-4 text-center font-bold text-foreground bg-primary-soft/5">{item.quantity}</td>
                          <td className="p-4 text-right font-extrabold text-success-dark">{fmtCurrency(item.commission_amount)}</td>
                          <td className="p-4 text-center whitespace-nowrap">
                            <span className={`inline-block text-[9px] uppercase font-black px-2 py-0.5 rounded border ${
                              item.payment_mode === "credit" ? "bg-red-50 text-red-600 border-red-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"
                            }`}>
                              {item.payment_mode}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Profile details Drawer Sheet */}
      <Sheet open={!!selectedBoy} onOpenChange={(v) => { if (!v) setSelectedBoy(null); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedBoy && (
            <div className="space-y-6 pt-4">
              <div className="flex justify-between items-start border-b pb-4">
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">Delivery Partner</span>
                  <h2 className="text-2xl font-bold">{selectedBoy.name}</h2>
                  <p className="text-sm text-muted-foreground flex items-center">
                    <Phone className="h-4 w-4 mr-1.5" /> {selectedBoy.mobile ?? "—"}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted-foreground uppercase">Commission Structure</span>
                  <p className="text-xl font-bold text-success-dark">{fmtCurrency(selectedBoy.commission_rate)} <span className="text-xs text-muted-foreground font-normal">/ unit</span></p>
                </div>
              </div>

              {/* Stats Overview Grid */}
              <div className="grid grid-cols-2 gap-3">
                <Card className="bg-muted/40 p-3 flex flex-col justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Total Delivered</span>
                  <p className="text-lg font-bold mt-1">{stats.totalDeliveries} units</p>
                </Card>
                <Card className="bg-muted/40 p-3 flex flex-col justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Cash Collected (Gross)</span>
                  <p className="text-lg font-bold text-primary mt-1">{fmtCurrency(stats.totalCashCollections)}</p>
                </Card>
                <Card className="bg-muted/40 p-3 flex flex-col justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Commission Deducted</span>
                  <p className="text-lg font-bold text-success-dark mt-1">{fmtCurrency(stats.totalCommissionEarned)}</p>
                </Card>
                <Card className="bg-muted/40 p-3 flex flex-col justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Net Remitted Cash</span>
                  <p className="text-lg font-bold text-emerald-600 mt-1">{fmtCurrency(stats.totalNetCollection)}</p>
                </Card>
              </div>

              {/* Delivery History List */}
              <div className="space-y-3">
                <h3 className="font-bold text-sm text-foreground uppercase tracking-wider">Deliveries Log ({deliveries.length})</h3>
                {deliveries.length === 0 ? <EmptyState title="No deliveries found" /> : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                    {deliveries.map((d) => (
                      <div key={d.id} className="p-3 border rounded-lg bg-card text-xs flex justify-between items-center">
                        <div>
                          <div className="font-semibold text-sm">{d.customer_name ?? "—"}</div>
                          <div className="text-muted-foreground mt-0.5">{fmtDate(d.sale_date)} · {d.product_name} · qty {d.quantity}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-primary">{fmtCurrency(d.total)}</div>
                          <div className="text-muted-foreground text-[10px] uppercase">Comm Deducted: {fmtCurrency(d.commission_total)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirmation Dialog for Archiving Delivery Boy */}
      <Dialog open={!!confirmVoidId} onOpenChange={(v) => { if (!v) setConfirmVoidId(null); }}>
        <DialogContent className="max-w-sm bg-white border border-slate-100 shadow-xl rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-destructive flex items-center gap-2">
              ⚠️ Archive Delivery Boy?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-2">
              Are you sure you want to archive/soft-delete this delivery boy? Historical settlements and outstanding collection balances will not be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setConfirmVoidId(null)} disabled={voiding}>
              Cancel
            </Button>
            <Button onClick={voidBoy} disabled={voiding} className="bg-destructive hover:bg-destructive-dark text-white font-bold">
              {voiding ? "Archiving..." : "Yes, Archive Partner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Form Component for Create/Edit
interface FormProps {
  editBoy: DeliveryBoy | null;
  onDone: () => void;
}

function DeliveryBoyForm({ editBoy, onDone }: FormProps) {
  const { t } = useTranslation();
  const { agency, session } = useAuth();
  const [name, setName] = useState(editBoy?.name ?? "");
  const [mobile, setMobile] = useState(editBoy?.mobile ?? "");
  const [commission_rate, setCommissionRate] = useState(editBoy?.commission_rate ? String(editBoy.commission_rate) : "30");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agency) return;
    setBusy(true);

    const comm = Number(commission_rate);
    if (isNaN(comm) || comm < 0) {
      toast.error("Please enter a valid non-negative commission rate.");
      setBusy(false);
      return;
    }

    if (editBoy) {
      // Edit
      const { error } = await (supabase
        .from("delivery_boys") as any)
        .update({
          name,
          mobile: mobile || null,
          default_commission: comm,
          updated_by: session?.user?.id
        })
        .eq("id", editBoy.id);

      if (error) {
        toast.error(getFriendlyError(error));
      } else {
        toast.success("Delivery boy configuration updated successfully.");
        onDone();
      }
    } else {
      // Fresh Create
      const { error } = await (supabase
        .from("delivery_boys") as any)
        .insert({
          agency_id: agency.id,
          name,
          mobile: mobile || null,
          default_commission: comm,
          created_by: session?.user?.id
        });

      if (error) {
        toast.error(getFriendlyError(error));
      } else {
        toast.success("Delivery boy successfully added.");
        onDone();
      }
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4 pt-4">
      <div className="space-y-1.5">
        <Label>{t("common.name")}</Label>
        <Input 
          required 
          placeholder="e.g. Satish Kumar"
          value={name} 
          onChange={(e) => setName(e.target.value)} 
          className="h-11"
        />
      </div>

      <div className="space-y-1.5">
        <Label>{t("common.mobile")}</Label>
        <Input 
          type="tel"
          placeholder="e.g. +91 9876543210"
          value={mobile} 
          onChange={(e) => setMobile(e.target.value)} 
          className="h-11"
        />
      </div>

      <div className="space-y-1.5">
        <Label>{t("delivery.commissionRate")}</Label>
        <Input 
          type="number" 
          step="0.01"
          required 
          value={commission_rate} 
          onChange={(e) => setCommissionRate(e.target.value)} 
          className="h-11"
        />
        <p className="text-xs text-muted-foreground">Standard delivery incentive/commission in INR paid per gas cylinder delivered.</p>
      </div>

      <div className="flex gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onDone} className="w-1/2 h-11">
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy} className="w-1/2 h-11">
          {busy ? "Saving..." : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
