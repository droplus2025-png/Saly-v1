/**
 * saly-db.js — Offline-first IndexedDB architecture for "saly".
 *
 * ARCHITECTURE
 *   UI  ──reads──▶  read API   (readonly transactions only, frozen object)
 *   UI  ──intent──▶ engine     (the ONLY code that opens readwrite transactions)
 *
 *   The UI never decides money. It sends intent ("sell these items, customer paid X");
 *   the engine decides CASH vs DEBT, updates stock, cash box, debts and the journal
 *   in ONE IndexedDB transaction (all-or-nothing).
 *
 * MONEY: every amount is an INTEGER in minor units (cents). Never floats. The UI converts with num()/fmt().
 *
 * SYNC-READY:
 *   - every mutated record carries `_sync: { updatedAt, deviceId }` (after the business columns)
 *   - ledgers (cashbox, transactions) use globally unique, time-sortable string ids
 *   - an `outbox` store records every local change; sync = drain outbox → server,
 *     and engine.applyRemoteChanges() for the opposite direction
 *
 * WHATSAPP-READY:
 *   Debts.notification: NONE | PENDING | SENT | FAILED. The engine sets PENDING whenever a
 *   debt is created/changed. After the shop opens a reminder chat it calls
 *   engine.setNotificationStatus(phone, 'SENT'), which also stores remindedAt.
 */

const DB_NAME = 'saly';
const DB_VERSION = 1;

/* ───────────────────────── Schema (exact column order) ───────────────────────── */

export const SCHEMA = Object.freeze({
  products:     ['sku', 'produit', 'purchasePrice', 'salePrice', 'quantity'],
  cashbox:      ['id', 'direction', 'amount', 'reason', 'txId', 'timestamp', 'balanceAfter'],
  debts:        ['nom', 'phone', 'amount', 'notification', 'remindedAt'],
  receivables:  ['nom', 'phone', 'amount'],
  transactions: ['id', 'type', 'no', 'timestamp', 'total', 'paid', 'settlement', 'party', 'items', 'note', 'refId'],
});

export const TX_TYPE = Object.freeze({
  SALE: 'SALE', PURCHASE: 'PURCHASE', WITHDRAWAL: 'WITHDRAWAL', DEPOSIT: 'DEPOSIT',
  DEBT_PAYMENT: 'DEBT_PAYMENT',               // customer pays down what they owe
  RECEIVABLE_PAYMENT: 'RECEIVABLE_PAYMENT',   // we pay down what we owe a supplier
  PREVIOUS_DEBT: 'PREVIOUS_DEBT',             // customer debt that existed before saly (no cash moves)
  PREVIOUS_RECEIVABLE: 'PREVIOUS_RECEIVABLE', // supplier payable that existed before saly (no cash moves)
  EXPENSE: 'EXPENSE',                         // rent, electricity, transport … (cash out, with a description)
  CUSTOMER_RETURN: 'CUSTOMER_RETURN',         // linked to the original sale by refId
  SUPPLIER_RETURN: 'SUPPLIER_RETURN',         // linked to the original purchase by refId
  CASH_CLOSING: 'CASH_CLOSING',               // end-of-day blind count (not an invoice)
  ADJUSTMENT: 'ADJUSTMENT',                   // audited manual stock change (opening stock, owner edit)
});
export const SETTLEMENT = Object.freeze({ CASH: 'CASH', DEBT: 'DEBT' });
export const NOTIFICATION = Object.freeze({ NONE: 'NONE', PENDING: 'PENDING', SENT: 'SENT', FAILED: 'FAILED' });

/* ───────────────────────── Utilities ───────────────────────── */

export class SalyError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SalyError';
    this.code = code;
    this.details = details;
  }
}

const req = (r) => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

const pad2 = (n) => String(n).padStart(2, '0');
const round3 = (n) => Math.round(n * 1000) / 1000;

const assertMoney = (v, name, { allowZero = true } = {}) => {
  if (!Number.isSafeInteger(v) || v < 0 || (!allowZero && v === 0)) {
    throw new SalyError('INVALID_AMOUNT', `${name} must be a ${allowZero ? 'non-negative' : 'positive'} integer in minor units`, { [name]: v });
  }
  return v;
};

const normQty = (q) => {
  const n = round3(Number(q));
  if (!Number.isFinite(n) || n <= 0) throw new SalyError('INVALID_QUANTITY', 'quantity must be > 0', { quantity: q });
  return n;
};

const normPhone = (p) => String(p ?? '').replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/\D/g, '');

const normParty = (party) => {
  const nom = String(party?.nom ?? '').trim();
  const phone = normPhone(party?.phone);
  if (!nom || phone.length < 6) {
    throw new SalyError('PARTY_REQUIRED', 'A name and a phone number (6+ digits) are required when a balance stays open');
  }
  return { nom, phone };
};

let idCounter = 0;
const newId = (deviceId) =>
  `${Date.now().toString(36).padStart(9, '0')}-${(idCounter++ % 1296).toString(36).padStart(2, '0')}-${deviceId.slice(0, 4)}`;

/**
 * THE financial decision, as a pure function (easy to unit-test).
 * paid >= total → CASH: cash box +total, change (paid-total) is handed back, never recorded.
 * paid <  total → DEBT: cash box +paid, the remainder becomes a receivable/payable.
 */
export function decideSettlement(total, paid) {
  assertMoney(total, 'total', { allowZero: false });
  assertMoney(paid, 'paid');
  return paid >= total
    ? { settlement: SETTLEMENT.CASH, cashAmount: total, openAmount: 0, change: paid - total }
    : { settlement: SETTLEMENT.DEBT, cashAmount: paid, openAmount: total - paid, change: 0 };
}

/* ───────────────────────── Settings & admin PIN ───────────────────────── */

export const DEFAULT_SETTINGS = Object.freeze({
  storeName: 'saly', phone: '', address: '', thanks: 'نشكركم على تعاملكم معنا', currency: 'DH', countryCode: '212',
  extra: '',   // free line on the invoice (ICE, RC, …)
  logo: '',     // shop logo as a small data URL, set in Settings
  accent: '',   // invoice colour picked from the logo (#rrggbb)
});

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261; // fallback for non-secure contexts
  for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
  return 'f' + h.toString(16);
}

/* ───────────────────────── Data migrations ─────────────────────────
 * Rule: whenever the SHAPE of stored data changes (new field, renamed field, new default…), append a function here.
 * Each one runs once, in order, on every device the next time the app opens, and is never edited afterwards.
 * Example:  async (ctx) => { for (const p of await ctx.all('products')) await ctx.raw('products', { ...p, unit: 'pcs' }); }
 */
const MIGRATIONS = [];

/* ───────────────────────── Database opening ───────────────────────── */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore('products', { keyPath: 'sku' })
        .createIndex('produit', 'produit');
      const cash = db.createObjectStore('cashbox', { keyPath: 'id' });
      cash.createIndex('timestamp', 'timestamp');
      cash.createIndex('txId', 'txId');
      db.createObjectStore('debts', { keyPath: 'phone' })
        .createIndex('notification', 'notification');
      db.createObjectStore('receivables', { keyPath: 'phone' });
      const tx = db.createObjectStore('transactions', { keyPath: 'id' });
      tx.createIndex('timestamp', 'timestamp');
      tx.createIndex('type', 'type');
      db.createObjectStore('meta', { keyPath: 'key' });                          // deviceId, settings, adminPin, cashBalance, lastClosing, invoiceSeq:*, lastBackup
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });   // pending sync changes
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new SalyError('DB_BLOCKED', 'Close other saly tabs and retry'));
  });
}

/* ───────────────────────── Read-only API (for the UI) ───────────────────────── */

function createReadAPI(db) {
  const read = async (store, fn) => {
    const tx = db.transaction(store, 'readonly');
    return fn(tx.objectStore(store));
  };
  const all = (store) => read(store, (s) => req(s.getAll()));
  const metaValue = async (key, fallback = 0) =>
    (await read('meta', (s) => req(s.get(key))))?.value ?? fallback;
  const project = (store, rows) => rows.map((r) => Object.fromEntries(SCHEMA[store].map((c) => [c, r[c]])));

  return Object.freeze({
    schema: SCHEMA,

    async getProducts() { return project('products', await all('products')); },

    async getCashLedger({ limit = 100 } = {}) {
      const rows = await read('cashbox', (s) => req(s.getAll()));
      return project('cashbox', rows.slice(-limit).reverse());
    },

    async getDebts({ openOnly = true } = {}) {
      const rows = await all('debts');
      return project('debts', openOnly ? rows.filter((d) => d.amount > 0) : rows);
    },
    async getReceivables({ openOnly = true } = {}) {
      const rows = await all('receivables');
      return project('receivables', openOnly ? rows.filter((d) => d.amount > 0) : rows);
    },

    async getTransactions({ type, from, to, limit = 200 } = {}) {
      let rows = await all('transactions');
      if (type) rows = rows.filter((t) => t.type === type);
      if (from != null) rows = rows.filter((t) => t.timestamp >= from);
      if (to != null) rows = rows.filter((t) => t.timestamp <= to);
      return project('transactions', rows.slice(-limit).reverse());
    },

    /** What the employee may see: the counted amount of the last closing (= today's opening). Never the expected balance. */
    async getOpeningBalance() { return (await metaValue('lastClosing', null))?.counted ?? 0; },
    /** Owner view: expected balance + last closing. */
    async getCashStatus() { return { balance: await metaValue('cashBalance', 0), lastClosing: await metaValue('lastClosing', null) }; },
    /** Everything needed to rebuild this shop on another device (the device id and the sync queue are left out). */
    async exportBackup() {
      const names = ['products', 'cashbox', 'debts', 'receivables', 'transactions', 'meta'];
      const tx = db.transaction(names, 'readonly'), data = {};
      for (const n of names) data[n] = await req(tx.objectStore(n).getAll());
      data.meta = data.meta.filter((m) => m.key !== 'deviceId');
      return { format: 'saly-backup', version: 1, createdAt: Date.now(), data };
    },
    getLastBackup: () => metaValue('lastBackup', null),
    async getSettings() { return { ...DEFAULT_SETTINGS, ...(await metaValue('settings', {})) }; },
    async hasAdminPin() { return !!(await metaValue('adminPin', null)); },
    async verifyAdminPin(pin) {
      const rec = await metaValue('adminPin', null);
      return !!rec && (await hashPin(String(pin), rec.salt)) === rec.hash;
    },

    /** For the sync service. */
    getPendingChanges: (limit = 500) => read('outbox', (s) => req(s.getAll(null, limit))),
  });
}

/* ───────────────────────── Atomic Engine (sole writer) ───────────────────────── */

function createEngine(db, deviceId) {
  const STORES = ['products', 'cashbox', 'debts', 'receivables', 'transactions', 'meta', 'outbox'];

  /** Runs `fn` inside ONE readwrite transaction. Any throw aborts everything. */
  async function atomic(fn) {
    const tx = db.transaction(STORES, 'readwrite');
    const done = new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error ?? new SalyError('ABORTED', 'Transaction aborted'));
    });
    const now = Date.now();
    const stamp = (rec) => ({ ...rec, _sync: { updatedAt: now, deviceId } });

    const ctx = {
      now,
      get: (store, key) => req(tx.objectStore(store).get(key)),
      async put(store, rec, { track = true, keepStamp = false } = {}) {
        const stamped = keepStamp ? rec : stamp(rec);
        await req(tx.objectStore(store).put(stamped));
        if (track) {
          await req(tx.objectStore('outbox').add({
            store, key: stamped[tx.objectStore(store).keyPath], op: 'put', record: stamped, ts: now, deviceId,
          }));
        }
        return stamped;
      },
      async meta(key, fallback) { return (await ctx.get('meta', key))?.value ?? fallback; },
      setMeta: (key, value) => req(tx.objectStore('meta').put({ key, value })),

      /** The only path that touches the cash box. */
      async cash(direction, amount, reason, txId) {
        if (amount === 0) return;
        const balance = await ctx.meta('cashBalance', 0);
        // the cash box is allowed to go negative (e.g. the employee pays out of his own pocket)
        const balanceAfter = direction === 'IN' ? balance + amount : balance - amount;
        await ctx.put('cashbox', {
          id: newId(deviceId), direction, amount, reason, txId, timestamp: now, balanceAfter,
        });
        await ctx.setMeta('cashBalance', balanceAfter);
      },

      async usedSkus() {
        if (!ctx._used) ctx._used = new Set(await req(tx.objectStore('products').getAllKeys()));
        return ctx._used;
      },
      /** Smallest free number (fills gaps; skips numbers chosen by hand). */
      async nextSku() {
        const used = await ctx.usedSkus();
        let sku = 1;
        while (used.has(sku)) sku++;
        used.add(sku);
        return sku;
      },
      async purgeMeta(prefix) {
        const os = tx.objectStore('meta');
        for (const k of await req(os.getAllKeys())) if (String(k).startsWith(prefix)) await req(os.delete(k));
      },
      async del(store, key, { track = true } = {}) {
        await req(tx.objectStore(store).delete(key));
        if (track) await req(tx.objectStore('outbox').add({ store, key, op: 'delete', ts: now, deviceId }));
      },
      clear: (store) => req(tx.objectStore(store).clear()),
      all: (store) => req(tx.objectStore(store).getAll()),
      raw: (store, rec) => req(tx.objectStore(store).put(rec)), // restore only: keeps the original stamps, no outbox entry
      async purgeOutbox(stores) {
        const os = tx.objectStore('outbox');
        for (const r of await req(os.getAll())) if (stores.includes(r.store)) await req(os.delete(r.seq));
      },
    };

    try {
      const result = await fn(ctx);
      await done;
      return result;
    } catch (err) {
      try { tx.abort(); } catch { /* already finished */ }
      done.catch(() => {});
      throw err;
    }
  }

  const INVOICE_TYPES = new Set(Object.values(TX_TYPE).filter((t) => t !== TX_TYPE.ADJUSTMENT && t !== TX_TYPE.CASH_CLOSING));
  /** Writes a journal entry. Every operation except stock adjustments gets the next invoice number of the day. */
  const journal = async (ctx, type, fields) => {
    let no;
    if (INVOICE_TYPES.has(type)) {
      const d = new Date(ctx.now), day = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
      const n = (await ctx.meta('invoiceSeq:' + day, 0)) + 1;
      await ctx.setMeta('invoiceSeq:' + day, n);
      no = `${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${String(n).padStart(3, '0')}`;
    }
    return ctx.put('transactions', {
      id: newId(deviceId), type, ...(no && { no }), timestamp: ctx.now,
      total: 0, paid: 0, settlement: SETTLEMENT.CASH, party: null, items: [], note: '', ...fields,
    });
  };

  const needItems = (items) => {
    if (!Array.isArray(items) || !items.length) throw new SalyError('EMPTY_ORDER', 'At least one item is required');
  };

  const checkFreeSku = async (ctx, value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) throw new SalyError('INVALID_SKU', 'sku must be a positive integer');
    const clash = await ctx.get('products', n);
    if (clash) throw new SalyError('SKU_EXISTS', `SKU ${n} is already used`, { product: clash });
    (await ctx.usedSkus()).add(n);
    return n;
  };

  const createProduct = async (ctx, { sku: wanted, produit, purchasePrice, salePrice, quantity = 0 }) => {
    const name = String(produit ?? '').trim();
    if (!name) throw new SalyError('INVALID_PRODUCT', 'produit is required');
    assertMoney(purchasePrice, 'purchasePrice');
    assertMoney(salePrice, 'salePrice');
    const q = round3(Number(quantity) || 0);
    if (q < 0) throw new SalyError('INVALID_QUANTITY', 'quantity cannot be negative');
    const sku = wanted === undefined || wanted === null || wanted === '' ? await ctx.nextSku() : await checkFreeSku(ctx, wanted);
    return ctx.put('products', { sku, produit: name, purchasePrice, salePrice, quantity: q });
  };

  const auditStock = async (ctx, changes, note) => {
    const real = changes.filter((c) => c.before !== c.after);
    if (real.length) await journal(ctx, TX_TYPE.ADJUSTMENT, { items: real, note });
  };

  /** Adds `amount` to an open balance (debts or receivables) for a party. */
  async function addOpenBalance(ctx, store, party, amount) {
    const existing = await ctx.get(store, party.phone);
    const rec = { nom: party.nom, phone: party.phone, amount: (existing?.amount ?? 0) + amount };
    if (store === 'debts') { rec.notification = NOTIFICATION.PENDING; if (existing?.remindedAt) rec.remindedAt = existing.remindedAt; }
    await ctx.put(store, rec);
  }

  /** Reduces an open balance; refuses to overpay. */
  async function reduceOpenBalance(ctx, store, phone, amount) {
    const rec = await ctx.get(store, normPhone(phone));
    if (!rec || rec.amount === 0) throw new SalyError('NO_BALANCE', 'Nothing is owed for this phone number');
    if (amount > rec.amount) throw new SalyError('OVERPAYMENT', 'Payment exceeds the open balance', { open: rec.amount, amount });
    const next = { ...rec, amount: rec.amount - amount };
    if (store === 'debts') next.notification = next.amount === 0 ? NOTIFICATION.NONE : NOTIFICATION.PENDING;
    await ctx.put(store, next);
    return rec;
  }

  /**
   * Return against an existing invoice (customer return ← sale, supplier return ← purchase).
   * The original invoice is never changed: the return is a new numbered operation linked by refId.
   * Value = price recorded on the invoice; never more than what is left to return. Money: the party's open
   * balance (only if the invoice had a debt part) is reduced first, the rest moves through the cash box.
   */
  const makeReturn = (kind) => ({ invoiceId, lines }) => atomic(async (ctx) => {
    const cust = kind === 'CUSTOMER';
    const orig = await ctx.get('transactions', invoiceId);
    if (!orig || orig.type !== (cust ? TX_TYPE.SALE : TX_TYPE.PURCHASE)) throw new SalyError('NOT_FOUND', 'Invoice not found');
    if (!Array.isArray(lines) || !lines.length) throw new SalyError('EMPTY_ORDER', 'Select at least one item');
    const returned = {};
    for (const t of await ctx.all('transactions')) {
      if (t.refId === orig.id) for (const l of t.items) returned[l.sku] = round3((returned[l.sku] ?? 0) + l.quantity);
    }
    const out = [], seen = new Set();
    let total = 0;
    for (const ln of lines) {
      if (seen.has(ln.sku)) throw new SalyError('INVALID_ORDER', 'Duplicate product in the return');
      seen.add(ln.sku);
      const src = orig.items.filter((l) => l.sku === ln.sku && !l.custom); // made-to-order items were never stocked
      if (!src.length) throw new SalyError('NOT_FOUND', `Product ${ln.sku} is not returnable on this invoice`);
      const qty = normQty(ln.quantity);
      const left = round3(src.reduce((s, l) => s + l.quantity, 0) - (returned[ln.sku] ?? 0));
      if (qty > left) throw new SalyError('RETURN_EXCEEDS', 'Return exceeds what is left on the invoice', { sku: ln.sku, left });
      const base = src[0], unit = cust ? base.unitPrice : base.unitCost, lineTotal = Math.round(unit * qty);
      total += lineTotal;
      const p = await ctx.get('products', ln.sku);
      if (!p) throw new SalyError('NOT_FOUND', `Product ${ln.sku} not found`);
      let next;
      if (cust) { // back to stock; cost re-averaged with the cost recorded on the sale line
        const oldQty = Math.max(p.quantity, 0), cost = base.unitCost ?? p.purchasePrice;
        next = { ...p, quantity: round3(p.quantity + qty), purchasePrice: Math.round((oldQty * p.purchasePrice + qty * cost) / (oldQty + qty)) };
      } else {
        if (p.quantity < qty) throw new SalyError('INSUFFICIENT_STOCK', `Not enough stock for ${p.produit}`, { sku: p.sku, available: p.quantity, requested: qty });
        next = { ...p, quantity: round3(p.quantity - qty) };
      }
      await ctx.put('products', next);
      out.push({ sku: p.sku, produit: base.produit, quantity: qty, ...(cust && { unitPrice: base.unitPrice }), unitCost: base.unitCost, lineTotal });
    }
    const store = cust ? 'debts' : 'receivables';
    let debtPart = 0;
    if (orig.settlement === SETTLEMENT.DEBT && orig.party) {
      debtPart = Math.min(total, (await ctx.get(store, orig.party.phone))?.amount ?? 0);
      if (debtPart > 0) await reduceOpenBalance(ctx, store, orig.party.phone, debtPart);
    }
    const cashPart = total - debtPart;
    const type = cust ? TX_TYPE.CUSTOMER_RETURN : TX_TYPE.SUPPLIER_RETURN;
    const tx = await journal(ctx, type, {
      total, paid: cashPart, settlement: debtPart ? SETTLEMENT.DEBT : SETTLEMENT.CASH, party: orig.party, items: out, refId: orig.id,
    });
    if (cashPart) await ctx.cash(cust ? 'OUT' : 'IN', cashPart, type, tx.id);
    return { transaction: tx };
  });

  /** Opening balance for a party: journaled with an invoice number, but no cash moves. */
  const previousBalance = (store, type) => ({ nom, phone, amount }) => atomic(async (ctx) => {
    assertMoney(amount, 'amount', { allowZero: false });
    const party = normParty({ nom, phone });
    const tx = await journal(ctx, type, { total: amount, paid: 0, settlement: SETTLEMENT.DEBT, party, note: 'previous balance' });
    await addOpenBalance(ctx, store, party, amount);
    return tx;
  });

  return Object.freeze({
    customerReturn: makeReturn('CUSTOMER'),
    supplierReturn: makeReturn('SUPPLIER'),

    /** Expense: cash out with a mandatory description. No limit; the employee keeps the proof. */
    expense: ({ amount, note }) => atomic(async (ctx) => {
      assertMoney(amount, 'amount', { allowZero: false });
      const text = String(note ?? '').trim();
      if (!text) throw new SalyError('NOTE_REQUIRED', 'A description is required');
      const tx = await journal(ctx, TX_TYPE.EXPENSE, { total: amount, paid: amount, note: text });
      await ctx.cash('OUT', amount, TX_TYPE.EXPENSE, tx.id);
      return tx;
    }),

    addPreviousDebt: previousBalance('debts', TX_TYPE.PREVIOUS_DEBT),
    addPreviousReceivable: previousBalance('receivables', TX_TYPE.PREVIOUS_RECEIVABLE),

    /** Create a product with the next sequential SKU (1, 2, 3 …); initial stock is journaled. */
    addProduct: (data) => atomic(async (ctx) => {
      const p = await createProduct(ctx, data);
      await auditStock(ctx, [{ sku: p.sku, produit: p.produit, before: 0, after: p.quantity }], 'opening stock');
      return p;
    }),

    /** Bulk add (CSV / Excel paste), all-or-nothing. Always creates NEW products. */
    importProducts: (rows) => atomic(async (ctx) => {
      if (!Array.isArray(rows) || !rows.length) throw new SalyError('EMPTY_IMPORT', 'Nothing to import');
      const made = [];
      for (const r of rows) made.push(await createProduct(ctx, r));
      await auditStock(ctx, made.map((p) => ({ sku: p.sku, produit: p.produit, before: 0, after: p.quantity })), 'opening stock (import)');
      return made.length;
    }),

    /** Owner edit. A quantity change is written to the journal (ADJUSTMENT) so stock cannot move silently. */
    updateProduct: (sku, { sku: newSku, produit, purchasePrice, salePrice, quantity }) => atomic(async (ctx) => {
      const p = await ctx.get('products', sku);
      if (!p) throw new SalyError('NOT_FOUND', `Product ${sku} not found`);
      const next = { ...p };
      if (produit !== undefined) {
        next.produit = String(produit).trim();
        if (!next.produit) throw new SalyError('INVALID_PRODUCT', 'produit is required');
      }
      if (purchasePrice !== undefined) next.purchasePrice = assertMoney(purchasePrice, 'purchasePrice');
      if (salePrice !== undefined) next.salePrice = assertMoney(salePrice, 'salePrice');
      if (quantity !== undefined) {
        const q = round3(Number(quantity));
        if (!Number.isFinite(q) || q < 0) throw new SalyError('INVALID_QUANTITY', 'quantity must be >= 0');
        next.quantity = q;
      }
      const renamed = newSku !== undefined && Number(newSku) !== sku;
      if (renamed) { next.sku = await checkFreeSku(ctx, newSku); await ctx.del('products', sku); (await ctx.usedSkus()).delete(sku); }
      const saved = await ctx.put('products', next);
      await auditStock(ctx, [{ sku: next.sku, produit: next.produit, before: p.quantity, after: next.quantity }], 'manual adjustment');
      if (renamed) await journal(ctx, TX_TYPE.ADJUSTMENT, { items: [{ sku: next.sku, produit: next.produit, previousSku: sku }], note: 'sku change' });
      return saved;
    }),

    /**
     * items: [{ sku, quantity, unitPrice? }] or made-to-order [{ custom:{produit,purchasePrice,salePrice}, quantity?, unitPrice? }]   paid: minor units   customer: { nom, phone } (only if paid < total)
     * The engine — not the UI — decides CASH or DEBT.
     */
    sale: ({ items, paid, customer }) => atomic(async (ctx) => {
      needItems(items);
      const lines = [];
      let total = 0;
      let customCost = 0; // made-to-order items: bought outside inventory, cost leaves the cash box
      for (const it of items) {
        if (it.custom) {
          const produit = String(it.custom.produit ?? '').trim();
          if (!produit) throw new SalyError('INVALID_PRODUCT', 'produit is required');
          const quantity = normQty(it.quantity ?? 1);
          const unitCost = assertMoney(it.custom.purchasePrice, 'purchasePrice');
          const unitPrice = assertMoney(it.unitPrice ?? it.custom.salePrice, 'salePrice');
          const lineTotal = Math.round(unitPrice * quantity);
          total += lineTotal;
          customCost += Math.round(unitCost * quantity);
          lines.push({ sku: null, custom: true, produit, quantity, unitPrice, unitCost, lineTotal });
          continue;
        }
        const p = await ctx.get('products', it.sku);
        if (!p) throw new SalyError('NOT_FOUND', `Product ${it.sku} not found`);
        const quantity = normQty(it.quantity);
        if (p.quantity < quantity) {
          throw new SalyError('INSUFFICIENT_STOCK', `Not enough stock for ${p.produit}`, { sku: p.sku, available: p.quantity, requested: quantity });
        }
        const unitPrice = assertMoney(it.unitPrice ?? p.salePrice, 'unitPrice');
        const lineTotal = Math.round(unitPrice * quantity);
        total += lineTotal;
        lines.push({ sku: p.sku, produit: p.produit, quantity, unitPrice, unitCost: p.purchasePrice, lineTotal });
        await ctx.put('products', { ...p, quantity: round3(p.quantity - quantity) });
      }

      const d = decideSettlement(total, paid);
      const party = d.openAmount > 0 ? normParty(customer) : null;
      const tx = await journal(ctx, TX_TYPE.SALE, { total, paid: d.cashAmount, settlement: d.settlement, party, items: lines });
      await ctx.cash('IN', d.cashAmount, TX_TYPE.SALE, tx.id);
      await ctx.cash('OUT', customCost, 'CUSTOM_ORDER_COST', tx.id);
      if (party) await addOpenBalance(ctx, 'debts', party, d.openAmount);
      return { transaction: tx, change: d.change };
    }),

    /**
     * items: [{ sku, quantity, purchasePrice, salePrice? }] or
     *        [{ new: { sku?, produit, salePrice }, quantity, purchasePrice }]  (creates the product)
     * supplier: { nom, phone } (always required). paid may not exceed the total.
     */
    purchase: ({ items, paid, supplier }) => atomic(async (ctx) => {
      needItems(items);
      const lines = [];
      let total = 0;
      for (const it of items) {
        const quantity = normQty(it.quantity);
        const purchasePrice = assertMoney(it.purchasePrice, 'purchasePrice');
        let p, isNew = false;
        if (it.new) {
          const produit = String(it.new.produit ?? '').trim();
          if (!produit) throw new SalyError('INVALID_PRODUCT', 'produit is required');
          const wanted = it.new.sku;
          const sku = wanted === undefined || wanted === null || wanted === '' ? await ctx.nextSku() : await checkFreeSku(ctx, wanted);
          p = { sku, produit, purchasePrice, salePrice: assertMoney(it.new.salePrice, 'salePrice'), quantity: 0 };
          isNew = true;
        } else {
          p = await ctx.get('products', it.sku);
          if (!p) throw new SalyError('NOT_FOUND', `Product ${it.sku} not found`);
        }
        const before = { purchasePrice: p.purchasePrice, salePrice: p.salePrice };
        // weighted-average cost; negative stock counts as 0
        const oldQty = Math.max(p.quantity, 0);
        const avgCost = isNew ? purchasePrice : Math.round((oldQty * p.purchasePrice + quantity * purchasePrice) / (oldQty + quantity));
        const newSale = it.salePrice !== undefined ? assertMoney(it.salePrice, 'salePrice') : p.salePrice;
        const lineTotal = Math.round(purchasePrice * quantity);
        total += lineTotal;
        // the invoice keeps every price change so nothing moves silently
        lines.push({
          sku: p.sku, produit: p.produit, quantity, unitCost: purchasePrice, lineTotal,
          ...(isNew && { isNew: true }),
          ...(!isNew && before.purchasePrice !== avgCost && { previousPurchasePrice: before.purchasePrice, newPurchasePrice: avgCost }),
          ...(!isNew && before.salePrice !== newSale && { previousSalePrice: before.salePrice }),
          newSalePrice: newSale,
        });
        await ctx.put('products', { ...p, purchasePrice: avgCost, salePrice: newSale, quantity: round3(p.quantity + quantity) });
      }

      assertMoney(paid, 'paid');
      if (paid > total) throw new SalyError('OVERPAYMENT', 'Payment exceeds the invoice total', { total, paid });
      const d = decideSettlement(total, paid);
      const party = normParty(supplier); // supplier is always required (traceability + re-ordering)
      const tx = await journal(ctx, TX_TYPE.PURCHASE, { total, paid: d.cashAmount, settlement: d.settlement, party, items: lines });
      await ctx.cash('OUT', d.cashAmount, TX_TYPE.PURCHASE, tx.id);
      if (d.openAmount > 0) await addOpenBalance(ctx, 'receivables', party, d.openAmount);
      return { transaction: tx };
    }),

    withdraw: ({ amount, note = '' }) => atomic(async (ctx) => {
      assertMoney(amount, 'amount', { allowZero: false });
      const tx = await journal(ctx, TX_TYPE.WITHDRAWAL, { total: amount, paid: amount, note });
      await ctx.cash('OUT', amount, TX_TYPE.WITHDRAWAL, tx.id);
      return tx;
    }),

    deposit: ({ amount, note = '' }) => atomic(async (ctx) => {
      assertMoney(amount, 'amount', { allowZero: false });
      const tx = await journal(ctx, TX_TYPE.DEPOSIT, { total: amount, paid: amount, note });
      await ctx.cash('IN', amount, TX_TYPE.DEPOSIT, tx.id);
      return tx;
    }),

    /**
     * Blind end-of-day count. The employee only supplies what he counted; the engine compares it with the
     * expected balance, writes the difference to the cash box permanently, and the counted amount becomes
     * the new balance and the next opening. Returns nothing about the expected amount.
     */
    closeCash: ({ counted }) => atomic(async (ctx) => {
      assertMoney(counted, 'counted');
      const expected = await ctx.meta('cashBalance', 0);
      const difference = counted - expected;
      const tx = await journal(ctx, TX_TYPE.CASH_CLOSING, {
        total: counted, paid: counted, items: [{ expected, counted, difference }],
        note: difference === 0 ? 'no difference' : difference < 0 ? 'shortage' : 'overage',
      });
      if (difference) await ctx.cash(difference > 0 ? 'IN' : 'OUT', Math.abs(difference), 'CLOSING_DIFFERENCE', tx.id);
      await ctx.setMeta('lastClosing', { at: ctx.now, expected, counted, difference, txId: tx.id });
      return { closedAt: ctx.now };
    }),

    /** A customer pays part or all of what they owe. */
    collectDebt: ({ phone, amount }) => atomic(async (ctx) => {
      assertMoney(amount, 'amount', { allowZero: false });
      const debt = await reduceOpenBalance(ctx, 'debts', phone, amount);
      const tx = await journal(ctx, TX_TYPE.DEBT_PAYMENT, {
        total: amount, paid: amount, party: { nom: debt.nom, phone: debt.phone },
      });
      await ctx.cash('IN', amount, TX_TYPE.DEBT_PAYMENT, tx.id);
      return tx;
    }),

    /** We pay part or all of what we owe a supplier. */
    payReceivable: ({ phone, amount }) => atomic(async (ctx) => {
      assertMoney(amount, 'amount', { allowZero: false });
      const rec = await reduceOpenBalance(ctx, 'receivables', phone, amount);
      const tx = await journal(ctx, TX_TYPE.RECEIVABLE_PAYMENT, {
        total: amount, paid: amount, party: { nom: rec.nom, phone: rec.phone },
      });
      await ctx.cash('OUT', amount, TX_TYPE.RECEIVABLE_PAYMENT, tx.id);
      return tx;
    }),

    saveSettings: (patch) => atomic(async (ctx) => {
      const cur = { ...DEFAULT_SETTINGS, ...(await ctx.meta('settings', {})) };
      for (const k of Object.keys(DEFAULT_SETTINGS)) if (patch[k] !== undefined) cur[k] = String(patch[k]).trim();
      cur.countryCode = normPhone(cur.countryCode);
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(cur.logo)) cur.logo = '';
      if (!/^#[0-9a-f]{6}$/i.test(cur.accent)) cur.accent = '';
      if (!cur.storeName) throw new SalyError('INVALID_SETTINGS', 'storeName is required');
      await ctx.setMeta('settings', cur);
      return cur;
    }),

    /** Sets or changes the admin PIN (hashed, 4–12 digits). Hashing happens before the transaction opens. */
    setAdminPin: async (newPin, currentPin) => {
      if (!/^\d{4,12}$/.test(String(newPin))) throw new SalyError('INVALID_PIN', 'PIN must be 4–12 digits');
      const cur = (await req(db.transaction('meta').objectStore('meta').get('adminPin')))?.value;
      if (cur && (await hashPin(String(currentPin ?? ''), cur.salt)) !== cur.hash) throw new SalyError('WRONG_PIN', 'Wrong PIN');
      const salt = newId(deviceId);
      const rec = { salt, hash: await hashPin(String(newPin), salt) };
      return atomic(async (ctx) => { await ctx.setMeta('adminPin', rec); });
    },

    /** Runs pending data migrations (see MIGRATIONS). Called by openSaly(). */
    migrate: () => atomic(async (ctx) => {
      const done = await ctx.meta('schemaVersion', 0);
      for (let i = done; i < MIGRATIONS.length; i++) await MIGRATIONS[i](ctx);
      if (done < MIGRATIONS.length) await ctx.setMeta('schemaVersion', MIGRATIONS.length);
    }),

    recordBackup: () => atomic(async (ctx) => { await ctx.setMeta('lastBackup', Date.now()); }),

    /** Replaces ALL data on this device with a backup file. Needs the current admin PIN (when one is set). */
    restoreBackup: async (backup, pin) => {
      const d = backup?.data;
      const keys = { products: 'sku', cashbox: 'id', debts: 'phone', receivables: 'phone', transactions: 'id', meta: 'key' };
      if (backup?.format !== 'saly-backup' || backup.version !== 1 || !d
        || Object.entries(keys).some(([st, k]) => !Array.isArray(d[st]) || d[st].some((r) => r?.[k] === undefined))) {
        throw new SalyError('INVALID_BACKUP', 'Not a valid saly backup file');
      }
      const cur = (await req(db.transaction('meta').objectStore('meta').get('adminPin')))?.value;
      if (cur && (await hashPin(String(pin ?? ''), cur.salt)) !== cur.hash) throw new SalyError('WRONG_PIN', 'Wrong PIN');
      return atomic(async (ctx) => {
        for (const st of ['products', 'cashbox', 'debts', 'receivables', 'transactions', 'outbox']) await ctx.clear(st);
        const mine = await ctx.get('meta', 'deviceId');
        await ctx.clear('meta');
        if (mine) await ctx.raw('meta', mine);
        for (const st of Object.keys(keys)) for (const r of d[st]) if (!(st === 'meta' && r.key === 'deviceId')) await ctx.raw(st, r);
        return Object.fromEntries(Object.keys(keys).map((st) => [st, d[st].length]));
      });
    },

    /**
     * Remise à zéro: wipes cash box, debts, receivables and the journal (so invoices too).
     * KEPT: products (inventory), settings, admin PIN, device id and SKU counter. Requires the admin PIN.
     */
    resetData: async (pin) => {
      const rec = (await req(db.transaction('meta').objectStore('meta').get('adminPin')))?.value;
      if (!rec || (await hashPin(String(pin ?? ''), rec.salt)) !== rec.hash) throw new SalyError('WRONG_PIN', 'Wrong PIN');
      const wiped = ['cashbox', 'debts', 'receivables', 'transactions'];
      return atomic(async (ctx) => {
        for (const st of wiped) await ctx.clear(st);
        await ctx.purgeOutbox(wiped);
        await ctx.purgeMeta('invoiceSeq:');
        await ctx.purgeMeta('lastClosing');
        await ctx.setMeta('cashBalance', 0);
      });
    },

    /** Called by the WhatsApp notifier after it tried to send. */
    setNotificationStatus: (phone, status) => atomic(async (ctx) => {
      if (!Object.values(NOTIFICATION).includes(status)) throw new SalyError('INVALID_STATUS', `Unknown status ${status}`);
      const debt = await ctx.get('debts', normPhone(phone));
      if (!debt) throw new SalyError('NOT_FOUND', 'No debt for this phone number');
      return ctx.put('debts', { ...debt, notification: status, ...(status === NOTIFICATION.SENT && { remindedAt: ctx.now }) });
    }),

    /* ── Sync hooks ── */

    /** After the server acknowledged these outbox entries. */
    markSynced: (seqs) => acknowledge(db, seqs),

    /**
     * Apply changes received from the server (not re-queued to the outbox).
     * Mutable tables: last-writer-wins on _sync.updatedAt (ties broken by deviceId).
     * Ledgers: insert-if-absent (append-only); remote cash rows also adjust the local balance.
     */
    applyRemoteChanges: (changes) => atomic(async (ctx) => {
      const newer = (a, b) =>
        a._sync.updatedAt > b._sync.updatedAt ||
        (a._sync.updatedAt === b._sync.updatedAt && a._sync.deviceId > b._sync.deviceId);

      for (const { store, record, op, key: delKey } of changes) {
        if (op === 'delete') { await ctx.del(store, delKey, { track: false }); continue; }
        const key = record[store === 'products' ? 'sku' : store === 'debts' || store === 'receivables' ? 'phone' : 'id'];
        const local = await ctx.get(store, key);

        const appendOnly = store === 'cashbox' || store === 'transactions';
        if (appendOnly ? local : local && !newer(record, local)) continue;

        // keepStamp: preserve the remote _sync stamp so last-writer-wins stays stable
        await ctx.put(store, record, { track: false, keepStamp: true });

        if (store === 'cashbox') {
          const bal = await ctx.meta('cashBalance', 0);
          await ctx.setMeta('cashBalance', record.direction === 'IN' ? bal + record.amount : bal - record.amount);
        }
      }
    }),
  });
}

/* ───────────────────────── Public entry point ───────────────────────── */

/**
 * const { read, engine } = await openSaly();
 * await engine.addProduct({ produit: 'Marteau', purchasePrice: 4000, salePrice: 6000, quantity: 10 });
 * await engine.deposit({ amount: 50000, note: 'opening float' });
 * const { transaction, change } = await engine.sale({ items: [{ sku: 1, quantity: 2 }], paid: 12000 });
 * await engine.sale({ items: [{ sku: 1, quantity: 1 }], paid: 2000, customer: { nom: 'Ali', phone: '0612345678' } }); // → DEBT
 */
export async function openSaly() {
  const db = await openDatabase();

  // one-time device identity (used in ids and sync stamps)
  const tx = db.transaction('meta', 'readwrite');
  const store = tx.objectStore('meta');
  let rec = await req(store.get('deviceId'));
  if (!rec) {
    rec = { key: 'deviceId', value: Math.random().toString(36).slice(2, 10) };
    await req(store.put(rec));
  }
  const deviceId = rec.value;

  const engine = createEngine(db, deviceId);
  await engine.migrate();
  return { read: createReadAPI(db), engine, deviceId };
}

async function acknowledge(db, seqs) {
  const tx = db.transaction('outbox', 'readwrite');
  const store = tx.objectStore('outbox');
  for (const seq of seqs) await req(store.delete(seq));
}
