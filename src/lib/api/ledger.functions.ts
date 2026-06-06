import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "../auth.server";

// Server function to record manual outstanding entry, creating the customer profile if it doesn't exist.
export const recordManualOutstanding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customerName: z.string().trim().min(1),
        selectedCustomerId: z.string().uuid().nullable().optional(),
        amount: z.number().positive(),
        note: z.string().trim(),
        date: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();

    // 1. Retrieve agency associated with user
    const { data: user } = await admin
      .from("agency_users")
      .select("agency_id")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!user || !user.agency_id) {
      throw new Error("Unauthorized: No agency associated with this user.");
    }
    const agencyId = user.agency_id;

    let customerId = data.selectedCustomerId || null;

    // 2. If no customer selected, resolve by name or create a new customer
    if (!customerId) {
      const { data: existing } = await admin
        .from("customers")
        .select("id")
        .eq("agency_id", agencyId)
        .eq("name", data.customerName)
        .eq("is_deleted", false)
        .maybeSingle();

      if (existing) {
        customerId = existing.id;
      } else {
        // Create new customer profile
        const { data: newCust, error: cErr } = await admin
          .from("customers")
          .insert({
            name: data.customerName,
            agency_id: agencyId,
            created_by: context.userId,
            mobile: null,
            village: null,
            consumer_number: null,
          })
          .select("id")
          .single();

        if (cErr || !newCust) {
          throw new Error(cErr?.message || "Failed to create new customer profile.");
        }
        customerId = newCust.id;
      }
    }

    const itemId = "out-udhar-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);

    // 3. Insert customer ledger entry
    const { error: ledgerErr } = await admin.from("customer_ledger").insert({
      agency_id: agencyId,
      customer_id: customerId,
      entry_date: data.date,
      kind: "adjustment",
      debit: data.amount,
      credit: 0,
      description: data.note || "Manual Outstanding Entry",
      reference: itemId,
    });

    if (ledgerErr) {
      throw new Error(ledgerErr.message);
    }

    // 4. Reconcile customer outstanding balance
    const { data: entries } = await admin
      .from("customer_ledger")
      .select("debit, credit")
      .eq("customer_id", customerId);

    const totalDebits = (entries ?? []).reduce((sum, entry) => sum + Number(entry.debit || 0), 0);
    const totalCredits = (entries ?? []).reduce((sum, entry) => sum + Number(entry.credit || 0), 0);
    const correctOutstanding = totalDebits - totalCredits;

    await admin
      .from("customers")
      .update({ outstanding_balance: correctOutstanding })
      .eq("id", customerId);

    return {
      itemId,
      customerId,
      customerName: data.customerName,
    };
  });

// Server function to delete manual outstanding entry and reconcile balance.
export const deleteManualOutstanding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ referenceId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    const { data: deletedRows, error: delErr } = await admin
      .from("customer_ledger")
      .delete()
      .eq("reference", data.referenceId)
      .select("customer_id");

    if (delErr) {
      throw new Error(delErr.message);
    }

    if (deletedRows && deletedRows.length > 0) {
      for (const row of deletedRows) {
        if (row.customer_id) {
          const { data: entries } = await admin
            .from("customer_ledger")
            .select("debit, credit")
            .eq("customer_id", row.customer_id);

          const totalDebits = (entries ?? []).reduce((sum, entry) => sum + Number(entry.debit || 0), 0);
          const totalCredits = (entries ?? []).reduce((sum, entry) => sum + Number(entry.credit || 0), 0);
          const correctOutstanding = totalDebits - totalCredits;

          await admin
            .from("customers")
            .update({ outstanding_balance: correctOutstanding })
            .eq("id", row.customer_id);
        }
      }
    }

    return { ok: true };
  });

// Server function to record opening balance for a new customer.
export const recordCustomerOpeningBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customerId: z.string().uuid(),
        amount: z.number().positive(),
        date: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();

    const { data: user } = await admin
      .from("agency_users")
      .select("agency_id")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!user || !user.agency_id) {
      throw new Error("Unauthorized");
    }

    const { error: ledgerErr } = await admin.from("customer_ledger").insert({
      agency_id: user.agency_id,
      customer_id: data.customerId,
      entry_date: data.date,
      kind: "adjustment",
      debit: data.amount,
      credit: 0,
      description: "Opening Balance (Previous)",
    });

    if (ledgerErr) {
      throw new Error(ledgerErr.message);
    }

    const { data: entries } = await admin
      .from("customer_ledger")
      .select("debit, credit")
      .eq("customer_id", data.customerId);

    const totalDebits = (entries ?? []).reduce((sum, entry) => sum + Number(entry.debit || 0), 0);
    const totalCredits = (entries ?? []).reduce((sum, entry) => sum + Number(entry.credit || 0), 0);
    const correctOutstanding = totalDebits - totalCredits;

    await admin
      .from("customers")
      .update({ outstanding_balance: correctOutstanding })
      .eq("id", data.customerId);

    return { ok: true };
  });
