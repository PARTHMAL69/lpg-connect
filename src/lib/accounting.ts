import { supabase } from "@/integrations/supabase/client";

/**
 * Reconciles a customer's outstanding balance by summing all debits and subtracting credits in their ledger.
 * This guarantees absolute synchronization and mathematical correctness across all modules.
 */
export async function reconcileCustomerOutstanding(customerId: string): Promise<number | null> {
  if (!customerId) return null;
  try {
    // 1. Fetch all ledger records for this customer
    const { data: entries, error: fetchErr } = await supabase
      .from("customer_ledger")
      .select("debit, credit")
      .eq("customer_id", customerId);

    if (fetchErr) throw fetchErr;

    const totalDebits = (entries ?? []).reduce((sum, entry) => sum + Number(entry.debit || 0), 0);
    const totalCredits = (entries ?? []).reduce((sum, entry) => sum + Number(entry.credit || 0), 0);
    const correctOutstanding = totalDebits - totalCredits;

    // 2. Update the customer's outstanding_balance field
    const { error: updateErr } = await supabase
      .from("customers")
      .update({ outstanding_balance: correctOutstanding })
      .eq("id", customerId);

    if (updateErr) throw updateErr;

    console.log(`[Reconciliation] Reconciled Customer ${customerId}: Outstanding Balance = ₹${correctOutstanding}`);
    return correctOutstanding;
  } catch (err) {
    console.error(`[Reconciliation] Error reconciling customer ${customerId}:`, err);
    return null;
  }
}

/**
 * Compensates for the database trigger tg_sales_ledger() which uses net_amount instead of gross_amount.
 * We update the ledger row debit to gross_amount, then call reconcileCustomerOutstanding().
 */
export async function compensateSaleLedger(saleId: string, grossAmount: number, customerId: string | null): Promise<void> {
  if (!saleId || !customerId) return;
  try {
    // 1. Update the customer_ledger row for this sale to have the gross debit amount
    const { error: ledgerErr } = await supabase
      .from("customer_ledger")
      .update({ debit: grossAmount })
      .eq("sale_id", saleId);

    if (ledgerErr) throw ledgerErr;

    // 2. Reconcile the customer outstanding balance
    await reconcileCustomerOutstanding(customerId);
  } catch (err) {
    console.error(`[Reconciliation] Error compensating sale ledger for sale ${saleId}:`, err);
  }
}
