export interface StockBalance {
  productId: string;
  openingStock: number;
  currentStock: number;
}

export interface StockLedgerEntry {
  id: string;
  productId: string;
  productName: string;
  entryDate: string;
  type: 'opening' | 'purchase' | 'adjustment' | 'transfer' | 'sale';
  quantity: number; // positive for additions, negative for deductions
  reference: string;
  description: string;
  created_at: string;
  created_by?: string;
}

// Key format: stock_balances_<agencyId>, stock_ledger_<agencyId>
const getBalancesKey = (agencyId: string) => `stock_balances_${agencyId}`;
const getLedgerKey = (agencyId: string) => `stock_ledger_${agencyId}`;

export function getStockBalances(agencyId: string, products: any[]): Record<string, StockBalance> {
  const key = getBalancesKey(agencyId);
  const raw = localStorage.getItem(key);
  let saved: Record<string, StockBalance> = {};
  if (raw) {
    try { saved = JSON.parse(raw); } catch (e) { console.error(e); }
  }

  // Ensure every active product has a balance record
  let modified = false;
  products.forEach((p) => {
    if (!saved[p.id]) {
      saved[p.id] = {
        productId: p.id,
        openingStock: 100, // Default opening stock for village testing
        currentStock: 100,
      };
      modified = true;
    }
  });

  if (modified) {
    localStorage.setItem(key, JSON.stringify(saved));
  }

  return saved;
}

export function getStockLedger(agencyId: string): StockLedgerEntry[] {
  const key = getLedgerKey(agencyId);
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as StockLedgerEntry[];
  } catch (e) {
    console.error(e);
    return [];
  }
}

function saveBalances(agencyId: string, balances: Record<string, StockBalance>) {
  localStorage.setItem(getBalancesKey(agencyId), JSON.stringify(balances));
}

function addLedgerEntry(agencyId: string, entry: Omit<StockLedgerEntry, 'id' | 'created_at'>) {
  const ledger = getStockLedger(agencyId);
  const newEntry: StockLedgerEntry = {
    ...entry,
    id: Math.random().toString(36).substring(2, 11).toUpperCase(),
    created_at: new Date().toISOString(),
  };
  ledger.unshift(newEntry); // Newest first
  localStorage.setItem(getLedgerKey(agencyId), JSON.stringify(ledger));
}

export function recordPurchase(agencyId: string, productId: string, productName: string, qty: number, ref: string, desc: string, userId?: string) {
  const balances = getStockBalances(agencyId, []);
  if (!balances[productId]) {
    balances[productId] = { productId, openingStock: 0, currentStock: 0 };
  }
  balances[productId].currentStock += qty;
  saveBalances(agencyId, balances);

  addLedgerEntry(agencyId, {
    productId,
    productName,
    entryDate: new Date().toISOString().substring(0, 10),
    type: 'purchase',
    quantity: qty,
    reference: ref,
    description: desc || 'Stock purchase received',
    created_by: userId,
  });
}

export function recordAdjustment(agencyId: string, productId: string, productName: string, qty: number, type: 'add' | 'remove', ref: string, desc: string, userId?: string) {
  const balances = getStockBalances(agencyId, []);
  if (!balances[productId]) {
    balances[productId] = { productId, openingStock: 0, currentStock: 0 };
  }
  const delta = type === 'add' ? qty : -qty;
  balances[productId].currentStock += delta;
  saveBalances(agencyId, balances);

  addLedgerEntry(agencyId, {
    productId,
    productName,
    entryDate: new Date().toISOString().substring(0, 10),
    type: 'adjustment',
    quantity: delta,
    reference: ref,
    description: desc || 'Inventory audit adjustment',
    created_by: userId,
  });
}

export function recordTransfer(agencyId: string, productId: string, productName: string, qty: number, ref: string, desc: string, userId?: string) {
  const balances = getStockBalances(agencyId, []);
  if (!balances[productId]) {
    balances[productId] = { productId, openingStock: 0, currentStock: 0 };
  }
  balances[productId].currentStock -= qty; // Move out of main godown
  saveBalances(agencyId, balances);

  addLedgerEntry(agencyId, {
    productId,
    productName,
    entryDate: new Date().toISOString().substring(0, 10),
    type: 'transfer',
    quantity: -qty,
    reference: ref,
    description: desc || 'Transferred to sub-truck/shop',
    created_by: userId,
  });
}

export function recordSaleDeduction(agencyId: string, productId: string, productName: string, qty: number, ref: string, userId?: string) {
  const balances = getStockBalances(agencyId, []);
  if (!balances[productId]) {
    balances[productId] = { productId, openingStock: 100, currentStock: 100 };
  }
  balances[productId].currentStock -= qty;
  saveBalances(agencyId, balances);

  addLedgerEntry(agencyId, {
    productId,
    productName,
    entryDate: new Date().toISOString().substring(0, 10),
    type: 'sale',
    quantity: -qty,
    reference: ref,
    description: `Sold in Invoice #${ref.substring(0, 8).toUpperCase()}`,
    created_by: userId,
  });
}

export function reverseSaleDeduction(agencyId: string, productId: string, productName: string, qty: number, ref: string, userId?: string) {
  const balances = getStockBalances(agencyId, []);
  if (!balances[productId]) {
    balances[productId] = { productId, openingStock: 100, currentStock: 100 };
  }
  balances[productId].currentStock += qty;
  saveBalances(agencyId, balances);

  addLedgerEntry(agencyId, {
    productId,
    productName,
    entryDate: new Date().toISOString().substring(0, 10),
    type: 'adjustment',
    quantity: qty,
    reference: ref,
    description: `Void reversal of Invoice #${ref.substring(0, 8).toUpperCase()}`,
    created_by: userId,
  });
}
