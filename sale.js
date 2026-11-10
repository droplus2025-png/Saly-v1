/* sale.js — POS sale screen (UI is read-only; every write goes through engine.sale) */
let read, engine;
/* ═══════════════ STATE (UI only holds the draft invoice; the engine owns all data) ═══════════════ */
let cart = []; // { key, sku, custom, name, unitCost, unitPrice (minor), qty }
let keySeq = 0;

const lineTotal = (l) => Math.round(l.unitPrice * (l.qty || 0));
const cartTotal = () => cart.reduce((s, l) => s + lineTotal(l), 0);
const cartCount = () => cart.reduce((s, l) => s + (l.qty || 0), 0);

/* ═══════════════ CART RENDERING ═══════════════ */
function renderCart() {
  const box = $('#cart');
  if (!cart.length) box.innerHTML = '<div class="empty">لا توجد منتجات في الفاتورة</div>';
  else box.innerHTML = cart.map((l) => `
    <div class="line" data-key="${l.key}">
      <div class="top">
        <div class="nm">${esc(l.name)}${l.custom ? '<span class="tag">حسب الطلب</span>' : ''}</div>
        <div style="display:flex;align-items:center">
          ${l.custom ? '<button class="x" style="color:var(--gold);font-size:18px" data-act="info" aria-label="تفاصيل">ⓘ</button>' : ''}
          <button class="x" data-act="del" aria-label="حذف">✕</button>
        </div>
      </div>
      <div class="ctl">
        <label>السعر<input data-f="price" inputmode="decimal" value="${l.unitPrice / 100}"></label>
        <label>الكمية<input data-f="qty" inputmode="decimal" value="${l.qty}"></label>
        <div class="lt" data-lt>${fmt(lineTotal(l))}</div>
      </div>
    </div>`).join('');
  refreshTotals();
}
function refreshTotals() {
  $('#count').textContent = cartCount().toLocaleString('en-US', { maximumFractionDigits: 3 });
  $('#total').textContent = fmt(cartTotal());
  $('#pay').disabled = !cart.length;
  cart.forEach((l) => {
    const n = document.querySelector(`.line[data-key="${l.key}"] [data-lt]`);
    if (n) n.textContent = fmt(lineTotal(l));
  });
}
$('#cart').addEventListener('input', (e) => {
  const f = e.target.dataset.f; if (!f) return;
  const l = cart.find((x) => x.key == e.target.closest('.line').dataset.key);
  const v = num(e.target.value);
  if (f === 'price') l.unitPrice = Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : 0;
  else l.qty = Number.isFinite(v) && v > 0 ? v : 0;
  refreshTotals();
});
$('#cart').addEventListener('focusin', (e) => { if (e.target.dataset.f) e.target.select(); });
$('#cart').addEventListener('click', (e) => {
  const act = e.target.dataset.act; if (!act) return;
  const key = e.target.closest('.line').dataset.key;
  if (act === 'del') { cart = cart.filter((l) => l.key != key); renderCart(); }
  if (act === 'info') showBreakdown(cart.filter((l) => l.custom));
});

/* ═══════════════ SEARCH ═══════════════ */
let searchSeq = 0;
async function runSearch() {
  const q = latin($('#q').value).trim().toLowerCase();
  const box = $('#results'); const seq = ++searchSeq;
  if (!q) { box.style.display = 'none'; return; }
  const all = await read.getProducts();
  if (seq !== searchSeq) return;
  const rows = /^\d+$/.test(q)
    ? all.filter((p) => String(p.sku).startsWith(q))          // digits → SKU only
    : all.filter((p) => p.produit.toLowerCase().includes(q)); // text → name only
  box.style.display = 'block';
  box.innerHTML = '<div class="res h"><span>الرقم</span><span>منتج</span><span>شراء</span><span>بيع</span></div>' +
    (rows.length ? rows.map((p) => `<div class="res" data-sku="${p.sku}"><span>${p.sku}</span><span>${esc(p.produit)}</span><span>${fmt(p.purchasePrice)}</span><span>${fmt(p.salePrice)}</span></div>`).join('')
      : '<div class="empty">لا توجد نتائج</div>');
  box._rows = rows;
}
$('#q').addEventListener('input', runSearch);
$('#results').addEventListener('click', (e) => {
  const r = e.target.closest('.res[data-sku]'); if (!r) return;
  const p = $('#results')._rows.find((x) => x.sku == r.dataset.sku);
  const ex = cart.find((l) => l.sku === p.sku);
  if (ex) ex.qty += 1;
  else cart.push({ key: ++keySeq, sku: p.sku, name: p.produit, unitCost: p.purchasePrice, unitPrice: p.salePrice, qty: 1 });
  $('#q').value = ''; $('#results').style.display = 'none';
  renderCart(); $('#q').focus();
});

/* ═══════════════ MADE-TO-ORDER (+) ═══════════════ */
$('#add').addEventListener('click', () => {
  const m = modal(`<h2>البيع حسب الطلب</h2>
    <input id="cn" placeholder="الاسم">
    <input id="cb" inputmode="decimal" placeholder="سعر الشراء">
    <input id="cs" inputmode="decimal" placeholder="سعر البيع">
    <div class="btns"><button class="btn" data-c>إلغاء</button><button class="btn p" data-ok>إضافة</button></div>`);
  m.querySelector('#cn').focus();
  m.querySelector('[data-c]').onclick = () => m.remove();
  m.querySelector('[data-ok]').onclick = () => {
    const name = m.querySelector('#cn').value.trim();
    const buy = num(m.querySelector('#cb').value), sell = num(m.querySelector('#cs').value);
    if (!name || !(buy >= 0) || !(sell >= 0)) return toast('أدخل الاسم وسعر الشراء وسعر البيع');
    cart.push({ key: ++keySeq, custom: true, name, unitCost: Math.round(buy * 100), unitPrice: Math.round(sell * 100), qty: 1 });
    m.remove(); renderCart();
  };
});

function showBreakdown(lines) {
  let buy = 0, sell = 0;
  const rows = lines.map((l) => {
    const q = l.quantity ?? l.qty, p = Math.round(l.unitCost * q), s = l.lineTotal ?? Math.round(l.unitPrice * q);
    buy += p; sell += s;
    return `<div class="kv"><b>${esc(l.produit ?? l.name)}${q !== 1 ? ' × ' + q : ''}</b><span></span></div>
      <div class="kv"><span>سعر الشراء</span><span>${fmt(p)}</span></div>
      <div class="kv"><span>سعر البيع</span><span>${fmt(s)}</span></div>
      <div class="kv"><span>العمولة</span><b class="ok">${fmt(s - p)}</b></div>`;
  }).join('');
  const m = modal(`<h2>تفاصيل الطلب</h2>${rows}
    ${lines.length > 1 ? `<div class="kv"><span>مجموع العمولة</span><b class="ok">${fmt(sell - buy)} ${CONFIG.currency}</b></div>` : ''}
    <div class="btns" style="margin-top:14px"><button class="btn" data-c>إغلاق</button></div>`);
  m.querySelector('[data-c]').onclick = () => m.remove();
}

/* ═══════════════ CHECKOUT ═══════════════ */
function confirmLoss(lines) {
  return new Promise((resolve) => {
    const rows = lines.map((l) => `<div class="kv"><b>${esc(l.name)}</b><span>الخسارة: ${fmt(Math.round((l.unitCost - l.unitPrice) * l.qty))}</span></div>
      <div class="kv"><span>سعر الشراء ${fmt(l.unitCost)}</span><span>سعر البيع ${fmt(l.unitPrice)}</span></div>`).join('');
    const m = modal(`<h2>⚠ بيع بالخسارة</h2><div class="hint dbt">سعر البيع أقل من سعر الشراء</div>${rows}
      <div class="btns" style="margin-top:14px"><button class="btn" data-no>تراجع</button><button class="btn gold" data-yes>استمرار</button></div>`);
    m.dismissable = false;
    m.querySelector('[data-no]').onclick = () => { m.remove(); resolve(false); };
    m.querySelector('[data-yes]').onclick = () => { m.remove(); resolve(true); };
  });
}
$('#pay').addEventListener('click', async () => {
  if (cart.some((l) => !(l.qty > 0))) return toast('الكمية يجب أن تكون أكبر من صفر');
  const total = cartTotal();
  if (total <= 0) return toast('الإجمالي يجب أن يكون أكبر من صفر');
  const losing = cart.filter((l) => l.unitPrice < l.unitCost);
  if (losing.length && !(await confirmLoss(losing))) return;
  const m = modal(`<h2>الدفع</h2>
    <div class="big">${fmt(total)} ${CONFIG.currency}</div>
    <input id="pd" inputmode="decimal" placeholder="المبلغ المدفوع">
    <div class="btns" style="margin:0 0 10px"><button class="btn" data-full>كامل المبلغ</button></div>
    <div class="hint" id="ht"></div>
    <div id="party" style="display:none"><input id="pn" placeholder="اسم الزبون"><input id="pp" inputmode="tel" placeholder="هاتف الزبون"></div>
    <div class="btns"><button class="btn" data-c>إلغاء</button><button class="btn p" data-ok>تأكيد</button></div>`);
  const pd = m.querySelector('#pd'), ht = m.querySelector('#ht'), party = m.querySelector('#party');
  const paidMinor = () => { const v = num(pd.value); return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null; };
  const update = () => {
    const p = paidMinor();
    party.style.display = p !== null && p < total ? 'block' : 'none';
    ht.className = 'hint ' + (p !== null && p >= total ? 'ok' : 'dbt');
    ht.textContent = p === null ? '' : p >= total ? `الباقي: ${fmt(p - total)} ${CONFIG.currency}` : `دين: ${fmt(total - p)} ${CONFIG.currency}`;
  };
  pd.addEventListener('input', update); pd.focus();
  m.querySelector('[data-full]').onclick = () => { pd.value = total / 100; update(); };
  m.querySelector('[data-c]').onclick = () => m.remove();
  m.querySelector('[data-ok]').onclick = async (ev) => {
    const paid = paidMinor();
    if (paid === null) return toast('أدخل المبلغ المدفوع');
    ev.target.disabled = true;
    try {
      const items = cart.map((l) => l.custom
        ? { custom: { produit: l.name, purchasePrice: l.unitCost, salePrice: l.unitPrice }, quantity: l.qty, unitPrice: l.unitPrice }
        : { sku: l.sku, quantity: l.qty, unitPrice: l.unitPrice });
      const customer = paid < total ? { nom: m.querySelector('#pn').value, phone: m.querySelector('#pp').value } : undefined;
      const { transaction, change } = await engine.sale({ items, paid, customer });
      cart = []; renderCart(); m.remove();
      showSaved(transaction, change);
    } catch (err) {
      ev.target.disabled = false;
      toast(errText(err));
    }
  };
});

/* ═══════════════ INVOICE + WHATSAPP ═══════════════ */
async function showSaved(tx, change) {
  const no = tx.no ?? '—';
  const hasCustom = tx.items.some((l) => l.custom);
  const m = modal(`<h2>تم حفظ الفاتورة ${no}</h2>
    <div class="big">${fmt(tx.total)} ${CONFIG.currency}</div>
    ${tx.settlement === 'CASH'
      ? `<div class="hint ok">الباقي: ${fmt(change)} ${CONFIG.currency}</div>`
      : `<div class="hint dbt">دين: ${fmt(tx.total - tx.paid)} ${CONFIG.currency} — ${esc(tx.party.nom)}</div>`}
    <div class="btns" style="margin-bottom:10px"><button class="btn p" data-send>إرسال الفاتورة PDF</button></div>
    <div class="btns">${hasCustom ? '<button class="btn" data-info>تفاصيل الطلب</button>' : ''}<button class="btn" data-new>فاتورة جديدة</button></div>`);
  m.dismissable = false;
  m.querySelector('[data-send]').onclick = () => shareInvoice(tx, read); // PDF → the phone's share sheet (WhatsApp)
  const info = m.querySelector('[data-info]');
  if (info) info.onclick = () => showBreakdown(tx.items.filter((l) => l.custom));
  m.querySelector('[data-new]').onclick = () => { m.remove(); $('#q').focus(); };
}

/* ═══════════════ BOOT ═══════════════ */
setTitle('بيع');
renderCart();
try { ({ read, engine } = await boot()); } catch { $('#pay').disabled = true; $('#q').disabled = true; }
