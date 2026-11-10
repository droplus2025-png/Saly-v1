/* saly-invoice.js — operation names, invoice details and WhatsApp text/link (used by the archive and the sale screen) */
const OPS = {
  SALE: 'بيع', PURCHASE: 'شراء', DEBT_PAYMENT: 'تحصيل دين', RECEIVABLE_PAYMENT: 'تسديد مورد',
  WITHDRAWAL: 'سحب', DEPOSIT: 'إيداع', PREVIOUS_DEBT: 'دين سابق', PREVIOUS_RECEIVABLE: 'مستحق سابق',
  EXPENSE: 'مصروف', CUSTOMER_RETURN: 'إرجاع من زبون', SUPPLIER_RETURN: 'إرجاع للمورد',
};
const opName = (t) => OPS[t] ?? t;
const hhmm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fullDate = (ts) => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${hhmm(ts)}`; };
const isGoods = (tx) => ['SALE', 'PURCHASE', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN'].includes(tx.type);
const isReturn = (tx) => tx.type === 'CUSTOMER_RETURN' || tx.type === 'SUPPLIER_RETURN';
const unitOf = (tx, l) => (tx.type === 'SALE' || tx.type === 'CUSTOMER_RETURN' ? l.unitPrice : l.unitCost);
const hasNote = (tx) => !!tx.note && ['WITHDRAWAL', 'DEPOSIT', 'EXPENSE'].includes(tx.type);
/** Labels for the money part of goods invoices (paid / debt for sale & purchase, cash back / debt cut for returns). */
const moneyLabels = (tx) => ({
  SALE: ['المدفوع', 'دين الزبون'], PURCHASE: ['المدفوع', 'دين للمورد'],
  CUSTOMER_RETURN: ['أُعيد نقداً', 'خُصم من دين الزبون'], SUPPLIER_RETURN: ['استُرد نقداً', 'خُصم من دين المورد'],
}[tx.type]);

function waNumber(raw) {
  let n = digits(raw);
  if (n.startsWith('00')) n = n.slice(2); else if (n.startsWith('0')) n = CONFIG.countryCode + n.slice(1);
  return n.length >= 8 ? n : null;
}
/** Full invoice details; `mods` = later operations linked to this invoice (returns). */
function detailsHtml(tx, mods = []) {
  const cur = CONFIG.currency, kv = (k, v, c = '') => `<div class="kv"><span>${k}</span><b class="${c}">${v}</b></div>`;
  let h = kv('العملية', opName(tx.type)) + kv('التاريخ', `<bdi>${fullDate(tx.timestamp)}</bdi>`);
  if (tx.party) h += kv('الطرف', `${esc(tx.party.nom)} · <bdi>${esc(tx.party.phone)}</bdi>`);
  if (isGoods(tx)) {
    h += tx.items.map((l) => {
      let x = '';
      if (l.custom) x += `<small class="dl">حسب الطلب · شراء ${fmt(l.unitCost)} · عمولة ${fmt(Math.round((l.unitPrice - l.unitCost) * l.quantity))}</small>`;
      if (l.isNew) x += '<small class="dl">منتج جديد</small>';
      if (l.previousPurchasePrice !== undefined) x += `<small class="dl">سعر الشراء: ${fmt(l.previousPurchasePrice)} ← ${fmt(l.newPurchasePrice)}</small>`;
      if (l.previousSalePrice !== undefined) x += `<small class="dl">سعر البيع: ${fmt(l.previousSalePrice)} ← ${fmt(l.newSalePrice)}</small>`;
      return `<div class="il"><div><b>${esc(l.produit)}</b>${x}</div><div class="ilr"><span>${fmtQty(l.quantity)} × ${fmt(unitOf(tx, l))}</span><b>${fmt(l.lineTotal)}</b></div></div>`;
    }).join('');
    h += kv('عدد القطع', fmtQty(tx.items.reduce((s, l) => s + l.quantity, 0)))
      + kv(isReturn(tx) ? 'إجمالي المرتجع' : 'الإجمالي', `${fmt(tx.total)} ${cur}`, 'gl') + kv(moneyLabels(tx)[0], fmt(tx.paid));
    if (tx.settlement === 'DEBT') h += kv(moneyLabels(tx)[1], fmt(tx.total - tx.paid), 'dbt');
  } else h += kv('المبلغ', `${fmt(tx.total)} ${cur}`, 'gl');
  if (hasNote(tx)) h += kv(tx.type === 'EXPENSE' ? 'الوصف' : 'ملاحظة', esc(tx.note));
  if (mods.length) { // every later return on this invoice, with its items, and the net
    h += `<h3 class="mh">التعديلات (معدلة)</h3>` + mods.map((m) => kv(`${opName(m.type)} ${m.no ?? ''}`, `<bdi>${fullDate(m.timestamp)}</bdi> · ${fmt(m.total)}`)
      + `<small class="dl">${m.items.map((l) => `${esc(l.produit)} × ${fmtQty(l.quantity)}`).join(' ، ')}</small>`).join('');
    h += kv('الصافي بعد الإرجاع', `${fmt(tx.total - mods.reduce((s, m) => s + m.total, 0))} ${cur}`, 'gl');
  }
  return h;
}

const WA_ICON = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2z" fill="#25D366"/><path d="M8.5 7.5c-.3 0-.8.1-1 .6-.3.7-.3 1.9.9 3.6 1.3 1.9 2.8 2.9 4.5 3.4 1 .3 1.8.1 2.2-.4.2-.3.3-.6.2-.8l-1.6-.8c-.2-.1-.4 0-.5.1l-.5.6c-.1.1-.3.2-.5.1-.6-.3-1.7-1-2.4-2.2-.1-.2 0-.4.1-.5l.4-.5c.1-.2.1-.4 0-.5l-.7-1.6c-.1-.2-.3-.3-.5-.3z" fill="#fff"/></svg>';
const shortDate = (ts) => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };

/** Debt reminder for a customer (the amount is what is still open). */
function reminderText(d) {
  return [`*${CONFIG.storeName}*`, '', `السلام عليكم ${d.nom}،`, `نذكّركم بأن المبلغ المتبقي عليكم هو *${fmt(d.amount)} ${CONFIG.currency}*.`,
    'نرجو تسوية ذلك في أقرب وقت.', ...(CONFIG.phone ? ['', `Tel: ${CONFIG.phone}`] : []), '', CONFIG.thanks].join('\n');
}
/** Opens the customer's WhatsApp chat with the reminder ready to send. */
function openReminder(d) {
  const n = waNumber(d.phone);
  if (!n) { toast('رقم واتساب غير صحيح'); return false; }
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(reminderText(d))}`, '_blank');
  return true;
}
