import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/page-header";
import { fmtCurrency, fmtDate, todayISO } from "@/lib/format";
import { useTranslation } from "react-i18next";
import { 
  ShoppingCart, HandCoins, Receipt, UserPlus, TrendingUp, AlertCircle, 
  BookOpen, Users, Clock, Flame, ChevronRight, Activity, Trash2, Calendar
} from "lucide-react";

export const Route = createFileRoute("/app/dashboard")({ component: () => <RequireAgencyUser><Dash/></RequireAgencyUser> });

interface ActivityItem {
  id: string;
  type: "sale" | "payment" | "expense";
  title: string;
  amount: number;
  timestamp: string;
  is_deleted: boolean;
}

interface TopCustomer {
  id: string;
  name: string;
  outstanding: number;
}

function Dash() {
  const { t } = useTranslation();
  const { agency } = useAuth();
  const [busy, setBusy] = useState(true);
  
  const [metrics, setMetrics] = useState({
    grossSales: 0,
    cashCollections: 0,
    outstanding: 0,
    commissionPaid: 0,
    expenses: 0,
    openingCash: 0,
    cashInHand: 0,
    pendingCommission: 0,
    monthlyRevenue: 0,
    totalCustomers: 0,
    totalDeliveryBoys: 0
  });

  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [topProducts, setTopProducts] = useState<Array<{ name: string; qty: number }>>([]);

  const loadData = async () => {
    if (!agency) return;
    setBusy(true);
    const today = todayISO();
    const monthStart = `${today.substring(0, 8)}01`;

    try {
      const [
        salesQ, 
        paysQ, 
        expQ, 
        custQ, 
        cashQ, 
        recentSales, 
        recentPayments, 
        recentExpenses,
        allSalesQ,
        allExpQ,
        allSettlesQ,
        monthlySalesQ,
        allCustCount,
        allBoyCount,
        ledgerQ
      ] = await Promise.all([
        // Today's aggregates
        (supabase.from("sales") as any).select("gross_amount, commission_amount, payment_mode").eq("agency_id", agency.id).eq("is_deleted", false).eq("sale_date", today),
        (supabase.from("payments") as any).select("amount, mode").eq("agency_id", agency.id).eq("is_deleted", false).eq("payment_date", today),
        (supabase.from("expenses") as any).select("amount").eq("agency_id", agency.id).eq("is_deleted", false).eq("expense_date", today),
        (supabase.from("customers") as any).select("id, name, outstanding:outstanding_balance").eq("agency_id", agency.id).eq("is_deleted", false),
        (supabase.from("cash_book_days") as any).select("opening_cash").eq("agency_id", agency.id).eq("book_date", today).maybeSingle(),
        
        // Activity feeds
        (supabase.from("sales") as any).select("id, gross_amount, created_at, is_deleted, customer:customers(name)").eq("agency_id", agency.id).order("created_at", { ascending: false }).limit(4),
        (supabase.from("payments") as any).select("id, amount, created_at, is_deleted, customer:customers(name)").eq("agency_id", agency.id).order("created_at", { ascending: false }).limit(4),
        (supabase.from("expenses") as any).select("id, category, amount, created_at, is_deleted").eq("agency_id", agency.id).order("created_at", { ascending: false }).limit(4),

        // Commission calculation aggregates
        (supabase.from("sales") as any).select("commission_amount").eq("agency_id", agency.id).eq("is_deleted", false),
        (supabase.from("expenses") as any).select("amount").eq("agency_id", agency.id).eq("category", "delivery_boy_payment").eq("is_deleted", false),
        (supabase.from("delivery_settlements") as any).select("commission_kept").eq("agency_id", agency.id).eq("is_deleted", false),

        // Monthly and count aggregates
        (supabase.from("sales") as any).select("gross_amount").eq("agency_id", agency.id).eq("is_deleted", false).gte("sale_date", monthStart).lte("sale_date", today),
        (supabase.from("customers") as any).select("id", { count: "exact" }).eq("agency_id", agency.id).eq("is_deleted", false),
        (supabase.from("delivery_boys") as any).select("id", { count: "exact" }).eq("agency_id", agency.id).eq("is_deleted", false),
        
        // Authoritative ledger sum query
        (supabase.from("customer_ledger") as any).select("debit, credit").eq("agency_id", agency.id)
      ]);

      // Calculate Core Today Metrics
      const grossSales = ((salesQ.data ?? []) as any[]).reduce((a, r) => a + Number(r.gross_amount), 0);
      const commissionPaid = ((salesQ.data ?? []) as any[]).reduce((a, r) => a + Number(r.commission_amount), 0);
      const expenses = ((expQ.data ?? []) as any[]).reduce((a, r) => a + Number(r.amount), 0);
      
      // Calculate Outstanding Udhari dynamically and authoritatively from the ledger
      const outstanding = ((ledgerQ.data ?? []) as any[]).reduce((a, r) => a + Number(r.debit || 0) - Number(r.credit || 0), 0);
      const openingCash = Number(cashQ.data?.opening_cash ?? 0);

      // Today's Collections = Sum of all Udhari payments collected today (Cash + Digital)
      const cashPayments = ((paysQ.data ?? []) as any[]).filter(p => p.mode === "cash").reduce((a, r) => a + Number(r.amount), 0);
      const digitalPayments = ((paysQ.data ?? []) as any[]).filter(p => p.mode !== "cash").reduce((a, r) => a + Number(r.amount), 0);
      const cashCollections = cashPayments + digitalPayments; // Renamed metric internally

      // Cashbook Turnover matches gross sales today (Business Turnover)
      const cashInHand = grossSales; // Renamed metric internally

      // Pending boy commission aggregates
      const totalCommissionEarned = ((allSalesQ.data ?? []) as any[]).reduce((a, r) => a + Number(r.commission_amount), 0);
      const totalPayouts = ((allExpQ.data ?? []) as any[]).reduce((a, r) => a + Number(r.amount), 0);
      const totalCommissionKept = ((allSettlesQ.data ?? []) as any[]).reduce((a, r) => a + Number(r.commission_kept), 0);
      const pendingCommission = totalCommissionEarned - totalPayouts - totalCommissionKept;

      // Monthly sales & total count aggregates
      const monthlyRevenue = ((monthlySalesQ.data ?? []) as any[]).reduce((a, r) => a + Number(r.gross_amount), 0);
      const totalCustomers = allCustCount.count ?? 0;
      const totalDeliveryBoys = allBoyCount.count ?? 0;

      setMetrics({
        grossSales,
        cashCollections,
        outstanding,
        commissionPaid,
        expenses,
        openingCash,
        cashInHand,
        pendingCommission,
        monthlyRevenue,
        totalCustomers,
        totalDeliveryBoys
      });

      // Format Top Customers by Outstanding
      const sortedCustomers = ((custQ.data ?? []) as any[])
        .sort((a: any, b: any) => b.outstanding - a.outstanding)
        .slice(0, 4) as TopCustomer[];
      setTopCustomers(sortedCustomers);

      // Format Top Products sold today
      const { data: todayProductsSales } = await (supabase.from("sales") as any)
        .select("quantity, product:products(name)")
        .eq("agency_id", agency.id)
        .eq("sale_date", today)
        .eq("is_deleted", false);
      
      const productMap: Record<string, number> = {};
      ((todayProductsSales ?? []) as any[]).forEach((s) => {
        const name = s.product?.name ?? "Cylinder";
        productMap[name] = (productMap[name] ?? 0) + Number(s.quantity);
      });

      const sortedProducts = Object.entries(productMap)
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 4);
      setTopProducts(sortedProducts);

      // Compile Recent Audit Activities
      const items: ActivityItem[] = [];
      
      ((recentSales.data ?? []) as any[]).forEach((s) => {
        items.push({
          id: s.id,
          type: "sale",
          title: `Sale to ${s.customer?.name ?? "Counter Client"}`,
          amount: Number(s.gross_amount),
          timestamp: s.created_at,
          is_deleted: s.is_deleted
        });
      });

      ((recentPayments.data ?? []) as any[]).forEach((p: any) => {
        items.push({
          id: p.id,
          type: "payment",
          title: `Payment from ${p.customer?.name ?? "—"}`,
          amount: Number(p.amount),
          timestamp: p.created_at,
          is_deleted: p.is_deleted
        });
      });

      ((recentExpenses.data ?? []) as any[]).forEach((e) => {
        items.push({
          id: e.id,
          type: "expense",
          title: `Overhead ${e.category.toUpperCase()}`,
          amount: Number(e.amount),
          timestamp: e.created_at,
          is_deleted: e.is_deleted
        });
      });

      const sortedActivities = items
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 4);

      setActivities(sortedActivities);
    } catch (err: any) {
      console.error("Dashboard error:", err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [agency]);

  return (
    <div className="space-y-6 pb-8">
      
      {/* Premium Welcome Banner */}
      <div className="bg-gradient-to-r from-navy via-slate-900 to-navy text-white rounded-2xl p-6 shadow-soft flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border border-slate-800">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Flame className="h-6 w-6 text-primary animate-pulse" />
            <h1 className="text-2xl font-bold tracking-wide">{agency?.name ?? "LPG Distributorship"}</h1>
          </div>
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">GasFlow Enterprise LPG Distributorship Dashboard</p>
        </div>
        <div className="bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/50 flex flex-col items-end">
          <span className="text-[10px] text-slate-400 uppercase font-semibold">Today's Date</span>
          <span className="font-bold text-sm tracking-wide">{fmtDate(todayISO())}</span>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Sales Turnover" value={fmtCurrency(metrics.grossSales)} icon={<TrendingUp className="h-4 w-4" />} accent="primary" description="Gross sales today" />
        <Kpi label="Udhari Collections" value={fmtCurrency(metrics.cashCollections)} icon={<HandCoins className="h-4 w-4" />} accent="success" description="Payments collected today" />
        <Kpi label="Outstanding Udhari" value={fmtCurrency(metrics.outstanding)} icon={<AlertCircle className="h-4 w-4" />} accent="destructive" description="Total pending dues" />
        <Kpi label="Cashbook Turnover" value={fmtCurrency(metrics.cashInHand)} icon={<BookOpen className="h-4 w-4" />} accent="primary" description="Daily business turnover" />
        <Kpi label="Today's Expenses" value={fmtCurrency(metrics.expenses)} icon={<Receipt className="h-4 w-4" />} accent="warning" description="Overheads logged today" />
        <Kpi label="Pending Boy Comm." value={fmtCurrency(metrics.pendingCommission)} icon={<Users className="h-4 w-4" />} accent="muted" description="Unpaid route commissions" />
        <Kpi label="Monthly Revenue" value={fmtCurrency(metrics.monthlyRevenue)} icon={<TrendingUp className="h-4 w-4" />} accent="success" description="Sales turnover this month" />
        <Kpi label="Business Directory" value={`${metrics.totalCustomers} Cust / ${metrics.totalDeliveryBoys} Boys`} icon={<Activity className="h-4 w-4" />} accent="muted" description="Active ledger rosters" />
      </div>

      {/* Quick Action Hub */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("dashboard.quickActions")}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickAction to="/app/sales" icon={<ShoppingCart className="h-5 w-5" />} label={t("dashboard.newSale")} />
          <QuickAction to="/app/payments" icon={<HandCoins className="h-5 w-5" />} label={t("dashboard.receivePayment")} />
          <QuickAction to="/app/expenses" icon={<Receipt className="h-5 w-5" />} label={t("dashboard.newExpense")} />
          <QuickAction to="/app/customers" icon={<UserPlus className="h-5 w-5" />} label={t("dashboard.newCustomer")} />
        </div>
      </div>

      {/* Roster & Activity Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Recent Audit Activities */}
        <Card className="shadow-soft overflow-hidden"><CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border/60 bg-muted/30 flex items-center justify-between">
            <h3 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-primary shrink-0" /> Recent Audit Activity
            </h3>
            <span className="text-[10px] bg-primary-soft text-primary font-semibold px-2 py-0.5 rounded">Live Feed</span>
          </div>

          <div className="divide-y divide-border/50 max-h-96 overflow-y-auto">
            {busy ? (
              <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">Loading real-time audit feeds...</div>
            ) : activities.length === 0 ? (
              <EmptyState title="No transactions recorded today." />
            ) : (
              activities.map((act) => (
                <div key={act.id} className={`p-4 flex items-center justify-between hover:bg-muted/10 transition-colors ${act.is_deleted ? "bg-destructive/5 text-muted-foreground" : ""}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${act.is_deleted ? "bg-destructive/10 text-destructive" : act.type === "sale" ? "bg-primary-soft text-primary" : act.type === "payment" ? "bg-success/15 text-success" : "bg-warning/15 text-warning-foreground"}`}>
                      {act.is_deleted ? <Trash2 className="h-4 w-4" /> : act.type === "sale" ? <ShoppingCart className="h-4 w-4" /> : act.type === "payment" ? <HandCoins className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className={`font-semibold text-sm truncate ${act.is_deleted ? "line-through" : ""}`}>{act.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {fmtDate(act.timestamp)} · {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className={`text-right font-bold text-sm whitespace-nowrap shrink-0 ml-2 ${act.is_deleted ? "line-through text-muted-foreground" : act.type === "expense" ? "text-destructive" : "text-success-dark"}`}>
                    {act.type === "expense" ? "-" : "+"}{fmtCurrency(act.amount)}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent></Card>

        {/* Top Dues Customer Dues Roster */}
        <Card className="shadow-soft overflow-hidden"><CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border/60 bg-muted/30 flex items-center justify-between">
            <h3 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Users className="h-4 w-4 text-primary shrink-0" /> Priority Udhari Dues
            </h3>
            <span className="text-[10px] text-destructive font-semibold">Alert</span>
          </div>

          <div className="divide-y divide-border/50">
            {busy ? (
              <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">Loading priority dues...</div>
            ) : topCustomers.length === 0 ? (
              <EmptyState title="All customer ledger balances cleared!" />
            ) : (
              topCustomers.map((cust) => (
                <Link 
                  key={cust.id} 
                  to="/app/customers/$id"
                  params={{ id: cust.id }}
                  className="p-4 flex justify-between items-center hover:bg-muted/30 transition-colors cursor-pointer group"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-foreground group-hover:text-primary transition-colors truncate">{cust.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">View Chronological Ledger</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className="font-bold text-sm text-destructive-dark">{fmtCurrency(cust.outstanding)}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </CardContent></Card>

        {/* Today's Top Products */}
        <Card className="shadow-soft overflow-hidden"><CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border/60 bg-muted/30 flex items-center justify-between">
            <h3 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Flame className="h-4 w-4 text-primary shrink-0" /> Today's Top Products
            </h3>
            <span className="text-[10px] bg-primary-soft text-primary font-semibold px-2 py-0.5 rounded">Volume</span>
          </div>

          <div className="divide-y divide-border/50">
            {busy ? (
              <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">Loading top products...</div>
            ) : topProducts.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground select-none">No sales recorded today.</div>
            ) : (
              topProducts.map((p, idx) => (
                <div key={p.name} className="p-4 flex justify-between items-center hover:bg-muted/10 transition-colors">
                  <div className="min-w-0 flex items-center gap-3">
                    <span className="font-bold text-xs text-muted-foreground w-4">#{idx + 1}</span>
                    <p className="font-bold text-sm text-foreground truncate">{p.name}</p>
                  </div>
                  <span className="font-extrabold text-sm text-primary shrink-0 bg-primary-soft/10 px-2 py-0.5 rounded-md">
                    {p.qty} unit(s)
                  </span>
                </div>
              ))
            )}
          </div>
        </CardContent></Card>

      </div>
    </div>
  );
}

function Kpi({ label, value, icon, accent, description }: { label: string; value: string; icon: React.ReactNode; accent: string; description?: string }) {
  const cls: Record<string, string> = {
    primary: "bg-primary-soft text-primary border-primary/20",
    success: "bg-success/10 text-success border-success/20",
    warning: "bg-warning/10 text-warning-foreground border-warning/20",
    destructive: "bg-destructive/10 text-destructive border-destructive/20",
    muted: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Card className="shadow-soft hover:shadow-card hover:border-primary/30 transition-all border"><CardContent className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">{label}</div>
          <div className="text-lg md:text-xl font-extrabold mt-1.5 tracking-tight text-foreground truncate">{value}</div>
          {description && <p className="text-[10px] text-muted-foreground mt-1 truncate">{description}</p>}
        </div>
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 border ${cls[accent] ?? cls.muted}`}>{icon}</div>
      </div>
    </CardContent></Card>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Button asChild variant="outline" className="h-24 flex-col gap-2 shadow-soft hover:bg-primary-soft/10 hover:border-primary/40 hover:text-primary transition-all border group">
      <Link to={to}>
        <div className="h-10 w-10 rounded-xl bg-muted group-hover:bg-primary-soft flex items-center justify-center group-hover:text-primary transition-colors">
          {icon}
        </div>
        <span className="text-xs font-semibold tracking-wide mt-1">{label}</span>
      </Link>
    </Button>
  );
}
