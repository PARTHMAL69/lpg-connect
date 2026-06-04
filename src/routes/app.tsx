import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard, ShoppingCart, Users, Package, IndianRupee,
  Receipt, Wallet, Truck, BookOpen, LogOut, Flame, Menu, UserCog,
  ArrowDownToLine, ArrowUpFromLine,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AppLayout,
});

const NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/app/sales", label: "Sales", icon: ShoppingCart },
  { to: "/app/customers", label: "Customers", icon: Users },
  { to: "/app/udhari", label: "Credit Book", icon: IndianRupee },
  { to: "/app/payments", label: "Payments", icon: Wallet },
  { to: "/app/expenses", label: "Expenses", icon: Receipt },
  { to: "/app/products", label: "Products", icon: Package },
  { to: "/app/delivery-boys", label: "Delivery Boys", icon: Truck },
  { to: "/app/cashbook", label: "Cash Book", icon: BookOpen },
  { to: "/app/payment-inflow", label: "Payment Inflow", icon: ArrowDownToLine },
  { to: "/app/payment-outflow", label: "Payment Outflow", icon: ArrowUpFromLine },
] as const;

function AppLayout() {
  const meFn = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const { roles } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (document.activeElement && (document.activeElement as HTMLInputElement).type === "number") {
        (document.activeElement as HTMLInputElement).blur();
      }
    };
    document.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      document.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const isAdmin = useMemo(() => {
    return roles.includes("agency_admin") || roles.includes("platform_admin" as any);
  }, [roles]);

  const navItems = useMemo(() => {
    const items = [...NAV] as any[];
    if (isAdmin) {
      items.push({ to: "/app/users", label: "Users", icon: UserCog });
    }
    return items;
  }, [isAdmin]);

  async function signOut() {
    await supabase.auth.signOut();
    nav({ to: "/login" });
  }

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex w-64 flex-col bg-sidebar border-r border-sidebar-border">
        <div className="h-16 px-5 flex items-center gap-2 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground grid place-items-center">
            <Flame className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <div className="font-bold text-sm">{me?.agency?.name ?? "LPG Agency"}</div>
            <div className="text-xs text-muted-foreground">{me?.agency?.code}</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((n) => (
            <Link
              key={n.to} to={n.to}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-primary" }}
              activeOptions={{ exact: (n as any).exact }}
            >
              <n.icon className="w-5 h-5" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="text-xs text-muted-foreground mb-2 px-3">{me?.user?.full_name ?? me?.user?.username}</div>
          <Button variant="ghost" className="w-full justify-start" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden h-14 px-4 flex items-center justify-between border-b bg-background sticky top-0 z-30">
          <button onClick={() => setOpen(!open)} className="p-2 -ml-2"><Menu className="w-6 h-6" /></button>
          <div className="font-semibold">{me?.agency?.name ?? "LPG Agency"}</div>
          <button onClick={signOut} className="p-2 -mr-2"><LogOut className="w-5 h-5" /></button>
        </header>

        {/* Mobile drawer */}
        {open && (
          <div className="lg:hidden fixed inset-0 z-40" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <aside className="absolute left-0 top-0 bottom-0 w-72 bg-sidebar shadow-xl p-3 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 px-2 py-3 border-b">
                <div className="font-bold">{me?.agency?.name}</div>
                <div className="text-xs text-muted-foreground">{me?.agency?.code}</div>
              </div>
              {navItems.map((n) => (
                <Link key={n.to} to={n.to} onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium hover:bg-sidebar-accent"
                  activeProps={{ className: "bg-sidebar-accent text-sidebar-primary" }}
                  activeOptions={{ exact: (n as any).exact }}
                >
                  <n.icon className="w-5 h-5" />{n.label}
                </Link>
              ))}
            </aside>
          </div>
        )}

        <main className={cn("flex-1 p-4 lg:p-8 max-w-7xl w-full mx-auto")}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
