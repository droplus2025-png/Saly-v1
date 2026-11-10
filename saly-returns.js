/* saly-returns.js — customer return (from a sale) / supplier return (from a purchase).
   The UI finds the invoice and previews the money; engine.customerReturn / supplierReturn decide and write. */
const RET = {
  CUSTOMER: { type: 'SALE', pay: 'customerReturn', debts: 'getDebts', who: 'الزبون', debtLbl: 'يُخصم من دين الزبون', cashLbl: 'يُدفع للزبون نقداً', unit: (l) => l.unitPrice },
  SUPPLIER: { type: 'PURCHASE', pay: 'supplierReturn', debts: 'getReceivables', who: 'المورد', debtLbl: 'يُخصم من دين المورد', cashLbl: 'يعود إلى الصندوق نقداً', unit: (l) => l.unitCost },
};

async function mountReturns({ read, engine, kind, root }) {
  const K = RET[kind];
  root.innerHTML = `<input id="q" type="search" autocomplete="off" placeholder="بحث برقم الفاتورة أو الاسم أو الهاتف"><div class="pl" id="pl"></div>`;
  let all = [], mods = {};
  async function load() {
    const txs = await read.getTransactions({ limit: 100000 });
    all = txs.filter((t) => t.type === K.type && t.no);
    mods = {}; txs.forEach((t) => { if (t.refId) (mods[t.refId] ||= []).push(t); });
    render();
  }
  function render() {
    const q = latin($('#q').value).trim().toLowerCase(), dq = q.replace(/\D/g, '');
    const rows = (!q ? all : all.filter((t) => t.no.includes(dq || '\u0000') || (t.party && (t.party.nom.toLowerCase().includes(q) || (dq && t.party.phone.includes(dq)))))).slice(0, 40);
    $('#pl').innerHTML = rows.length
      ? rows.map((t) => `<div class="pi" data-id="${t.id}"><div><b>${t.no}${mods[t.id] ? '<i class="md">معدلة</i>' : ''}</b><small>${t.party ? esc(t.party.nom) + ' · <bdi>' + esc(t.party.phone) + '</bdi>' : 'بدون اسم'} · ${hhmm(t.timestamp)}</small></div><span class="amt">${fmt(t.total)}</span></div>`).join('')
      : `<div class="empty">${all.length ? 'لا توجد نتائج' : 'لا فواتير'}</div>`;
  }
  $('#q').addEventListener('input', render);
  await load();

  $('#pl').addEventListener('click', async (e) => {
    const row = e.target.closest('.pi'); if (!row) return;
    const inv = all.find((t) => t.id === row.dataset.id);
    const done = {}; (mods[inv.id] ?? []).forEach((m) => m.items.forEach((l) => (done[l.sku] = (done[l.sku] ?? 0) + l.quantity)));
    const products = Object.fromEntries((await read.getProducts()).map((p) => [p.sku, p]));
    const open = inv.party ? (await read[K.debts]()).find((d) => d.phone === inv.party.phone)?.amount ?? 0 : 0;
    const lines = inv.items.map((l) => ({ ...l, left: l.custom ? 0 : Math.round((l.quantity - (done[l.sku] ?? 0)) * 1000) / 1000 }));
    const m = modal(`<h2>${kind === 'CUSTOMER' ? 'إرجاع من زبون' : 'إرجاع للمورد'} · ${inv.no}</h2>
      ${inv.party ? `<div class="kv"><span>${K.who}</span><b>${esc(inv.party.nom)}</b></div>` : ''}
      ${lines.map((l, i) => `<div class="rl"><div><b>${esc(l.produit)}</b><small>${l.custom ? 'حسب الطلب — غير قابل للإرجاع' : `السعر ${fmt(K.unit(l))} · المتبقي للإرجاع ${fmtQty(l.left)}${kind === 'SUPPLIER' ? ` · المخزون ${fmtQty(products[l.sku]?.quantity ?? 0)}` : ''}`}</small></div>
        <input class="rq" data-i="${i}" inputmode="decimal" placeholder="0" ${l.left > 0 ? '' : 'disabled'}></div>`).join('')}
      <div class="hint" id="rs" style="margin-top:10px"></div>
      <div class="btns"><button class="btn" data-c>إغلاق</button><button class="btn p" data-ok disabled>تأكيد الإرجاع</button></div>`);
    const ok = m.querySelector('[data-ok]'), rs = m.querySelector('#rs');
    const picked = () => [...m.querySelectorAll('.rq')].map((i) => ({ l: lines[i.dataset.i], q: num(i.value) })).filter((x) => x.q > 0);
    const update = () => {
      const p = picked(), bad = p.find((x) => x.q > x.l.left || (kind === 'SUPPLIER' && x.q > (products[x.l.sku]?.quantity ?? 0)));
      const total = p.reduce((s, x) => s + Math.round(K.unit(x.l) * x.q), 0);
      const debtPart = inv.settlement === 'DEBT' && inv.party ? Math.min(total, open) : 0;
      ok.disabled = !p.length || !!bad;
      rs.className = 'hint ' + (bad ? 'dbt' : 'ok');
      rs.innerHTML = bad ? 'الكمية أكبر من المتاح للإرجاع'
        : !p.length ? '' : `قيمة المرتجع: <b>${fmt(total)} ${CONFIG.currency}</b>` + (debtPart ? `<br>${K.debtLbl}: ${fmt(debtPart)}` : '') + (total - debtPart ? `<br>${K.cashLbl}: ${fmt(total - debtPart)}` : '');
    };
    m.querySelectorAll('.rq').forEach((i) => { i.addEventListener('input', update); i.addEventListener('focus', () => i.select()); });
    m.querySelector('[data-c]').onclick = () => m.remove();
    ok.onclick = async () => {
      ok.disabled = true;
      try {
        const { transaction: tx } = await engine[K.pay]({ invoiceId: inv.id, lines: picked().map((x) => ({ sku: x.l.sku, quantity: x.q })) });
        m.remove(); await load();
        const d = modal(`<h2>تم الإرجاع · فاتورة ${tx.no}</h2><div class="big">${fmt(tx.total)} ${CONFIG.currency}</div>
          ${tx.total > tx.paid ? `<div class="kv"><span>${K.debtLbl}</span><b>${fmt(tx.total - tx.paid)}</b></div>` : ''}
          ${tx.paid ? `<div class="kv"><span>${K.cashLbl}</span><b>${fmt(tx.paid)}</b></div>` : ''}
          <div class="btns" style="margin-top:14px"><button class="btn" data-ok>تم</button><button class="btn p" data-send>إرسال PDF</button></div>`);
        d.dismissable = false;
        d.querySelector('[data-ok]').onclick = () => d.remove();
        d.querySelector('[data-send]').onclick = () => shareInvoice(tx, read);
      } catch (err) { ok.disabled = false; toast(errText(err)); }
    };
  });
}
