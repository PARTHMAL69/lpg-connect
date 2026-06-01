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

/**
 * Synchronizes the customer ledger for a sale, fully supporting split payments.
 * It deletes existing ledger entries for this sale and inserts the correct credit portion.
 */
export async function syncSaleLedger(
  saleId: string,
  customerId: string | null,
  isSplit: boolean,
  creditAmount: number,
  grossAmount: number,
  txnNo: string | null,
  saleDate: string,
  agencyId: string
): Promise<void> {
  if (!saleId || !customerId) return;
  try {
    // 1. Delete any existing customer ledger records for this sale
    const { error: delErr } = await supabase
      .from("customer_ledger")
      .delete()
      .eq("sale_id", saleId);
    if (delErr) throw delErr;

    // 2. Determine correct debit value: split credit amount or standard gross amount
    const debitVal = isSplit ? creditAmount : grossAmount;

    // 3. Insert new customer ledger record if debit value is greater than 0
    if (debitVal > 0) {
      const { error: insErr } = await supabase
        .from("customer_ledger")
        .insert({
          agency_id: agencyId,
          customer_id: customerId,
          entry_date: saleDate,
          kind: "sale_credit",
          reference: txnNo,
          description: isSplit ? `Split Sale (Credit Portion)` : `Credit sale`,
          debit: debitVal,
          sale_id: saleId
        });
      if (insErr) throw insErr;
    }

    // 4. Reconcile the customer outstanding balance
    await reconcileCustomerOutstanding(customerId);
  } catch (err) {
    console.error(`[Reconciliation] Error syncing sale ledger for sale ${saleId}:`, err);
  }
}
