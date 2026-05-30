import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/app/")({ component: Dashboard });

function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Construction className="w-5 h-5" /> Modules Coming Online</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>The database, authentication, and platform admin are live.</p>
          <p>Next loop: Sales entry, customer/product/delivery-boy CRUD, payments, udhari ledger, expenses, cash book, and dashboard tiles will be wired up.</p>
        </CardContent>
      </Card>
    </div>
  );
}
