/* purchase.js — purchase invoice screen. The UI only collects the draft; engine.purchase decides and writes everything. */
let read, engine, products = [];
let draft = []; // { key, sku, name, isNew, qty, buy, sell }  (prices in minor units)
let keySeq = 0;
const F = { sku: $('#fSku'), name: $('#fName'), qty: $('#fQty'), buy: $('#fBuy'), sell: $('#fSell') };
const hint = (msg = '', cls = '') => { const h = $('#hint'); h.textContent = msg; h.className = 'phint ' + cls; };
const skuOf = () => { const n = parseInt(latin(F.sku.value), 10); return Number.isInteger(n) && n >= 1 ? n : null; };
const used = () => new Set([...products.map((p) => p.sku), ...draft.map((l) => l.sku)]);
const lineTotal = (l) => Math.round(l.buy * l.qty);
const total = () => draft.reduce((s, l) => s + lineTotal(l), 0);

/* ── entry form ── */
function clearEntry() {
  F.sku.value = smallestFree(used()); F.name.value = ''; F.name.readOnly = false;
  F.qty.value = F.buy.value = F.sell.value = ''; $('#sug').hidden = true; hint();
}
function fromSku() { // a number that belongs to a product fills its name and current prices
  const n = skuOf(), p = products.find((x) => x.sku === n);
  if (p) {
    F.name.value = p.produit; F.name.readOnly = true; F.buy.value = p.purchasePrice / 100; F.sell.value = p.salePrice / 100;
    hint(`منتج موجود · المخزون: ${fmtQty(p.quantity)}`, 'ok');
  } else {
    if (F.name.readOnly) { F.name.value = ''; F.buy.value = F.sell.value = ''; }
    F.name.readOnly = false; hint(n ? `منتج جديد برقم ${n}` : '', 'dbt');
  }
}
F.sku.addEventListener('input', fromSku);
F.name.addEventListener('input', () => { // typing a name searches existing products first
  const q = F.name.value.trim().toLowerCase(), box = $('#sug');
  const rows = q ? products.filter((p) => p.produit.toLowerCase().includes(q)).slice(0, 6) : [];
  box.hidden = !rows.length;
  box.innerHTML = rows.map((p) => `<button data-sku="${p.sku}"><b class="bd">${p.sku}</b>${esc(p.produit)}</button>`).join('');
});
F.name.addEventListener('blur', () => { $('#sug').hidden = true; });
$('#sug').addEventListener('mousedown', (e) => e.preventDefault()); // keep focus so the tap registers
$('#sug').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sku]'); if (!b) return;
  F.sku.value = b.dataset.sku; $('#sug').hidden = true; fromSku(); F.qty.focus();
});
const order = [F.sku, F.name, F.qty, F.buy, F.sell];
order.forEach((el, i) => el.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return; e.preventDefault();
  if (i < order.length - 1) (order[i + 1].readOnly ? order[i + 2] : order[i + 1]).focus(); else addLine();
}));
[F.qty, F.buy, F.sell, F.sku].forEach((el) => el.addEventListener('focus', () => el.select()));

function addLine() {
  const n = skuOf(), ex = products.find((p) => p.sku === n);
  const qty = num(F.qty.value), buy = num(F.buy.value), sell = num(F.sell.value);
  if (!n) return toast('الرقم غير صحيح');
  if (draft.some((l) => l.sku === n)) return toast('هذا الرقم موجود في الفاتورة — عدّل سطره في القائمة');
  let name = ex?.produit;
  if (!ex) {
    name = F.name.value.trim();
    if (!name) return toast('أدخل اسم المنتج');
    const dup = [...products, ...draft.map((l) => ({ sku: l.sku, produit: l.name }))].find((p) => p.produit.trim().toLowerCase() === name.toLowerCase());
    if (dup) return toast(`هذا المنتج موجود برقم ${dup.sku} — ابحث عنه واخترْه`);
  }
  if (!(qty > 0)) return toast('أدخل الكمية');
  if (!(buy >= 0) || !(sell >= 0)) return toast('أدخل سعر الشراء وسعر البيع');
  draft.push({ key: ++keySeq, sku: n, name, isNew: !ex, qty, buy: Math.round(buy * 100), sell: Math.round(sell * 100) });
  clearEntry(); render(); F.name.focus();
}
$('#addBtn').addEventListener('click', addLine);

/* ── draft list (newest first, one compact row per product) ── */
function render() {
  $('#plist').innerHTML = draft.length
    ? '<div class="ph"><span>المنتج</span><span>الكمية</span><span>شراء</span><span>بيع</span><span></span></div>' +
      [...draft].reverse().map((l) => `<div class="pr" data-key="${l.key}"><span class="pn"><b class="bd">${l.sku}</b>${esc(l.name)}${l.isNew ? '<i class="nw">جديد</i>' : ''}</span>
        <input data-f="qty" inputmode="decimal" value="${l.qty}"><input data-f="buy" inputmode="decimal" value="${l.buy / 100}"><input data-f="sell" inputmode="decimal" value="${l.sell / 100}">
        <button class="x" data-act="del" aria-label="حذف">✕</button></div>`).join('')
    : '<div class="empty" style="padding-top:40px">لم تدخل شيئاً بعد</div>';
  totals();
}
const totals = () => { $('#total').textContent = fmt(total()); $('#pay').disabled = !draft.length; };
$('#plist').addEventListener('input', (e) => {
  const f = e.target.dataset.f; if (!f) return;
  const l = draft.find((x) => x.key == e.target.closest('.pr').dataset.key), v = num(e.target.value);
  if (f === 'qty') l.qty = v > 0 ? v : 0; else l[f] = v >= 0 ? Math.round(v * 100) : 0;
  totals();
});
$('#plist').addEventListener('focusin', (e) => { if (e.target.dataset.f) e.target.select(); });
$('#plist').addEventListener('click', (e) => {
  if (e.target.dataset.act !== 'del') return;
  draft = draft.filter((l) => l.key != e.target.closest('.pr').dataset.key); clearEntry(); render();
});

/* ── supplier contacts (Contact Picker API: Chrome on Android, secure pages only) ── */
$('#pick').addEventListener('click', async () => {
  if (!navigator.contacts?.select) return toast('اختيار جهات الاتصال غير مدعوم في هذا المتصفح أو هذه الصفحة');
  try {
    const [c] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
    if (c) { $('#sn').value = c.name?.[0] ?? ''; $('#sp').value = c.tel?.[0] ?? ''; }
  } catch { /* cancelled */ }
});
[$('#sn'), $('#sp')].forEach((el, i, a) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (a[i + 1] ?? F.name).focus(); } }));

/* ── payment ── */
$('#pay').addEventListener('click', () => {
  const nom = $('#sn').value.trim(), phone = $('#sp').value;
  if (!nom || digits(phone).length < 6) return toast('اسم المورد وهاتفه (6 أرقام على الأقل) مطلوبان');
  if (draft.some((l) => !(l.qty > 0))) return toast('الكمية يجب أن تكون أكبر من صفر');
  const sum = total();
  if (sum <= 0) return toast('الإجمالي يجب أن يكون أكبر من صفر');
  const m = modal(`<h2>الدفع للمورد</h2><div class="big">${fmt(sum)} ${CONFIG.currency}</div>
    <input id="pd" inputmode="decimal" placeholder="المبلغ المدفوع" style="width:100%;margin-bottom:10px;background:var(--field);border:1px solid var(--line);border-radius:14px;padding:13px;font-size:17px">
    <div class="btns" style="margin:0 0 10px"><button class="btn" data-full>كامل المبلغ</button></div>
    <div class="hint" id="ht"></div>
    <div class="btns"><button class="btn" data-c>إلغاء</button><button class="btn p" data-ok>تأكيد</button></div>`);
  const pd = m.querySelector('#pd'), ht = m.querySelector('#ht'), ok = m.querySelector('[data-ok]');
  const paid = () => { const v = num(pd.value); return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null; };
  const update = () => {
    const p = paid(); ok.disabled = p === null || p > sum;
    ht.className = 'hint ' + (p !== null && p <= sum ? (p === sum ? 'ok' : 'dbt') : 'dbt');
    ht.textContent = p === null ? '' : p > sum ? 'المبلغ أكبر من قيمة الفاتورة' : p === sum ? 'دفع كامل' : `دين للمورد: ${fmt(sum - p)} ${CONFIG.currency}`;
  };
  pd.addEventListener('input', update); pd.focus(); update();
  m.querySelector('[data-full]').onclick = () => { pd.value = sum / 100; update(); };
  m.querySelector('[data-c]').onclick = () => m.remove();
  ok.onclick = async () => {
    ok.disabled = true;
    try {
      const items = draft.map((l) => l.isNew
        ? { new: { sku: l.sku, produit: l.name, salePrice: l.sell }, quantity: l.qty, purchasePrice: l.buy }
        : { sku: l.sku, quantity: l.qty, purchasePrice: l.buy, salePrice: l.sell });
      const { transaction: tx } = await engine.purchase({ items, paid: paid(), supplier: { nom, phone } });
      m.remove(); await reset(); showSaved(tx);
    } catch (err) { ok.disabled = false; toast(errText(err)); }
  };
});
async function reset() {
  draft = []; $('#sn').value = $('#sp').value = ''; products = await read.getProducts(); clearEntry(); render();
}
function showSaved(tx) {
  const m = modal(`<h2>تم حفظ فاتورة الشراء ${tx.no}</h2><div class="big">${fmt(tx.total)} ${CONFIG.currency}</div>
    <div class="kv"><span>المورد</span><b>${esc(tx.party.nom)}</b></div>
    <div class="kv"><span>المدفوع من الصندوق</span><b>${fmt(tx.paid)}</b></div>
    ${tx.settlement === 'DEBT' ? `<div class="kv"><span>دين للمورد</span><b class="dbt">${fmt(tx.total - tx.paid)}</b></div>` : ''}
    <div class="btns" style="margin-top:14px"><button class="btn p" data-new>فاتورة جديدة</button></div>`);
  m.dismissable = false; m.querySelector('[data-new]').onclick = () => { m.remove(); F.name.focus(); };
}

/* ── boot ── */
setTitle('شراء');
render();
try { ({ read, engine } = await boot()); products = await read.getProducts(); clearEntry(); }
catch { $('#pay').disabled = true; $('#addBtn').disabled = true; }
