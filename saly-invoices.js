/* saly-invoices.js — invoice archive: one invoice per line, tap for details, WhatsApp in one tap */
const SEND_ICON = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#f6b92b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 17v-6m0 0-2.5 2.5M12 11l2.5 2.5"/></svg>';

async function mountInvoices({ read, root }) {
  root.innerHTML = `<input id="q" type="search" autocomplete="off" placeholder="بحث بالرقم أو الاسم أو الهاتف">
    <div class="pl"><div class="ivh"><span>الرقم</span><span>العملية</span><span>الساعة</span><span>الإجمالي</span><span></span></div><div id="ivl"></div></div>`;
  const all = (await read.getTransactions({ limit: 100000 })).filter((t) => t.no); // newest first; closings/adjustments have no number
  const mods = {};
  all.forEach((t) => { if (t.refId) (mods[t.refId] ||= []).push(t); });
  const LIMIT = 300;

  function render() {
    const q = latin($('#q').value).trim().toLowerCase(), dq = q.replace(/\D/g, '');
    const rows = !q ? all : all.filter((t) => t.no.includes(dq || '\u0000') || (t.party && (t.party.nom.toLowerCase().includes(q) || (dq && t.party.phone.includes(dq)))));
    $('#ivl').innerHTML = rows.length
      ? rows.slice(0, LIMIT).map((t) => `<div class="iv" data-id="${t.id}"><b class="no">${t.no}</b><span>${opName(t.type)}${mods[t.id] ? '<i class="md">معدلة</i>' : ''}</span><span class="tm">${hhmm(t.timestamp)}</span><b class="tt">${fmt(t.total)}</b><button class="wa" data-send aria-label="إرسال PDF">${SEND_ICON}</button></div>`).join('')
        + (rows.length > LIMIT ? `<div class="empty">يتم عرض ${LIMIT} من ${rows.length} — استخدم البحث</div>` : '')
      : `<div class="empty">${all.length ? 'لا توجد نتائج' : 'لا فواتير'}</div>`;
  }
  $('#q').addEventListener('input', render);
  render();

  $('#ivl').addEventListener('click', (e) => {
    const row = e.target.closest('.iv'); if (!row) return;
    const tx = all.find((t) => t.id === row.dataset.id);
    if (e.target.closest('[data-send]')) return shareInvoice(tx, read);
    const m = modal(`<h2>فاتورة ${tx.no}</h2>${detailsHtml(tx, mods[tx.id] ?? [])}
      <div class="btns" style="margin-top:14px"><button class="btn" data-c>إغلاق</button><button class="btn" data-view>معاينة</button><button class="btn p" data-send>إرسال PDF</button></div>`);
    m.querySelector('[data-c]').onclick = () => m.remove();
    m.querySelector('[data-view]').onclick = () => previewInvoice(tx, read);
    m.querySelector('[data-send]').onclick = () => shareInvoice(tx, read);
  });
}
