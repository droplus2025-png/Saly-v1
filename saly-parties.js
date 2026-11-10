/* saly-parties.js — customer debts / supplier receivables screen (same layout, different engine calls) */
const PARTY = {
  debts: { total: 'إجمالي الديون', add: '+ إضافة دين سابق', empty: 'لا ديون مسجلة', addTitle: 'إضافة دين سابق', payBtn: 'تحصيل', get: 'getDebts', pay: 'collectDebt', addOp: 'addPreviousDebt', who: 'اسم الزبون' },
  receivables: { total: 'إجمالي المستحقات', add: '+ إضافة مستحق سابق', empty: 'لا مستحقات مسجلة', addTitle: 'إضافة مستحق سابق', payBtn: 'تسديد', get: 'getReceivables', pay: 'payReceivable', addOp: 'addPreviousReceivable', who: 'اسم المورد' },
};

function mountParties({ read, engine, kind, root }) {
  const K = PARTY[kind];
  const field = 'width:100%;margin-bottom:10px;background:var(--field);border:1px solid var(--line);border-radius:14px;padding:13px;font-size:17px';
  root.innerHTML = `<input id="q" type="search" autocomplete="off" placeholder="بحث بالاسم أو الهاتف">
    <div class="sum"><span>${K.total}</span><b id="sumv">0</b></div>
    <button class="wide" id="addp">${K.add}</button><div class="pl" id="pl"></div>`;
  let rows = [];

  async function render() {
    rows = (await read[K.get]()).sort((a, b) => b.amount - a.amount); // biggest balance first
    $('#sumv').textContent = fmt(rows.reduce((s, r) => s + r.amount, 0));
    const q = latin($('#q').value).trim().toLowerCase(), dq = q.replace(/\D/g, '');
    const shown = q ? rows.filter((r) => r.nom.toLowerCase().includes(q) || (dq && r.phone.includes(dq))) : rows;
    $('#pl').innerHTML = shown.length
      ? shown.map((r) => `<div class="pi" data-phone="${esc(r.phone)}"><div><b>${esc(r.nom)}</b><small>${esc(r.phone)}${r.remindedAt ? ' · آخر تذكير ' + shortDate(r.remindedAt) : ''}</small></div>
          <span class="amt">${fmt(r.amount)}</span>${kind === 'debts' ? `<button class="wa" data-wa aria-label="تذكير واتساب">${WA_ICON}</button>` : ''}</div>`).join('')
      : `<div class="empty">${rows.length ? 'لا توجد نتائج' : K.empty}</div>`;
  }
  $('#q').addEventListener('input', render);
  render();

  /* settle part or all of a balance (cash moves inside the engine) */
  $('#pl').addEventListener('click', (e) => {
    const el = e.target.closest('.pi'); if (!el) return;
    const r = rows.find((x) => x.phone === el.dataset.phone); if (!r) return;
    const remind = async () => { // one tap: chat opens with the reminder; the engine records that this customer was reminded
      if (!openReminder(r)) return;
      try { await engine.setNotificationStatus(r.phone, 'SENT'); render(); } catch (err) { toast(errText(err)); }
    };
    if (e.target.closest('[data-wa]')) return remind();
    const m = modal(`<h2>${esc(r.nom)}</h2>
      <div class="kv"><span>الهاتف</span><b>${esc(r.phone)}</b></div>
      <div class="kv"><span>المتبقي</span><b class="dbt">${fmt(r.amount)} ${CONFIG.currency}</b></div>
      <input id="pa" inputmode="decimal" placeholder="المبلغ" style="${field};margin-top:12px">
      <div class="btns" style="margin:0 0 10px"><button class="btn" data-full>كامل المبلغ</button></div>
      <div class="hint" id="ph"></div>
      ${kind === 'debts' ? '<div class="btns" style="margin:0 0 10px"><button class="btn" data-remind>تذكير عبر واتساب</button></div>' : ''}
      <div class="btns"><button class="btn" data-c>إغلاق</button><button class="btn p" data-ok>${K.payBtn}</button></div>`);
    m.querySelector('[data-remind]')?.addEventListener('click', remind);
    const pa = m.querySelector('#pa'), ph = m.querySelector('#ph'), ok = m.querySelector('[data-ok]');
    const amount = () => { const v = num(pa.value); return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null; };
    const update = () => {
      const a = amount(); ok.disabled = a === null || a > r.amount;
      ph.className = 'hint ' + (a !== null && a <= r.amount ? 'ok' : 'dbt');
      ph.textContent = a === null ? '' : a > r.amount ? 'المبلغ أكبر من المتبقي' : `المتبقي بعد العملية: ${fmt(r.amount - a)} ${CONFIG.currency}`;
    };
    pa.addEventListener('input', update); pa.focus(); update();
    m.querySelector('[data-full]').onclick = () => { pa.value = r.amount / 100; update(); };
    m.querySelector('[data-c]').onclick = () => m.remove();
    ok.onclick = async () => {
      ok.disabled = true;
      try { const tx = await engine[K.pay]({ phone: r.phone, amount: amount() }); m.remove(); toast(`تمت العملية · فاتورة ${tx.no}`, true); render(); }
      catch (err) { ok.disabled = false; toast(errText(err)); }
    };
  });

  /* balance that existed before saly: recorded and numbered, but no cash moves */
  $('#addp').addEventListener('click', () => {
    const m = modal(`<h2>${K.addTitle.replace('إضافة ', '')}</h2>
      <input id="an" placeholder="${K.who}" style="${field}">
      <input id="ap" inputmode="tel" placeholder="الهاتف" style="${field}">
      <input id="am" inputmode="decimal" placeholder="المبلغ" style="${field}">
      <div class="hint dbt" id="ah"></div>
      <div class="btns"><button class="btn" data-c>إلغاء</button><button class="btn p" data-ok>إضافة</button></div>`);
    const [an, ap, am] = ['#an', '#ap', '#am'].map((s) => m.querySelector(s)), ah = m.querySelector('#ah');
    an.focus();
    ap.addEventListener('input', () => { // same phone = same party: say so instead of merging silently
      const d = digits(ap.value), ex = rows.find((x) => x.phone === d);
      ah.textContent = ex ? `⚠ هذا الرقم مسجل باسم ${ex.nom} (${fmt(ex.amount)}) — سيُضاف المبلغ إلى رصيده` : '';
    });
    m.querySelector('[data-c]').onclick = () => m.remove();
    m.querySelector('[data-ok]').onclick = async (ev) => {
      const v = num(am.value);
      if (!an.value.trim() || digits(ap.value).length < 6 || !(v > 0)) return toast('أدخل الاسم والهاتف (6 أرقام على الأقل) والمبلغ');
      ev.target.disabled = true;
      try { const tx = await engine[K.addOp]({ nom: an.value, phone: ap.value, amount: Math.round(v * 100) }); m.remove(); toast(`تمت الإضافة · فاتورة ${tx.no}`, true); render(); }
      catch (err) { ev.target.disabled = false; toast(errText(err)); }
    };
  });
}
