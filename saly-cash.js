/* saly-cash.js — cash register. Employee: blind closing count. Owner (admin): balances, deposit/withdraw, ledger. */
const REASONS = {
  SALE: 'بيع', PURCHASE: 'شراء', DEBT_PAYMENT: 'تحصيل دين زبون', RECEIVABLE_PAYMENT: 'تسديد مورد',
  WITHDRAWAL: 'سحب', DEPOSIT: 'إيداع', CUSTOM_ORDER_COST: 'تكلفة طلب خاص', CLOSING_DIFFERENCE: 'فرق الإقفال',
  EXPENSE: 'مصروف', CUSTOMER_RETURN: 'إرجاع من زبون', SUPPLIER_RETURN: 'إرجاع للمورد',
};
const when = (t) => { const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const cin = 'width:100%;margin-bottom:10px;background:var(--field);border:1px solid var(--line);border-radius:14px;padding:13px;font-size:17px';

/* ── employee: sees only the opening balance, types what he counted ── */
async function mountCashStaff({ read, engine, root }) {
  const opening = await read.getOpeningBalance();
  root.innerHTML = `<div class="card opn"><small>رصيد الافتتاح</small><div>${fmt(opening)} ${CONFIG.currency}</div></div>
    <div class="card"><h3>المبلغ المعدود في الصندوق</h3>
      <input class="cin" id="cc" inputmode="decimal" placeholder="0" autocomplete="off">
      <button class="btn gold" id="close" style="width:100%;padding:16px;font-size:19px">إقفال الصندوق</button></div>`;
  $('#cc').addEventListener('focus', (e) => e.target.select());
  $('#close').onclick = () => {
    const v = num($('#cc').value);
    if (!(v >= 0)) return toast('أدخل المبلغ المعدود في الصندوق');
    const counted = Math.round(v * 100);
    const m = modal(`<h2>تأكيد الإقفال</h2><div class="big">${fmt(counted)} ${CONFIG.currency}</div>
      <div class="hint dbt">هذا هو المبلغ الذي عددته. لا يمكن التراجع بعد التأكيد.</div>
      <div class="btns"><button class="btn" data-c>مراجعة</button><button class="btn gold" data-ok>تأكيد الإقفال</button></div>`);
    m.querySelector('[data-c]').onclick = () => m.remove();
    m.querySelector('[data-ok]').onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        await engine.closeCash({ counted }); m.remove();
        const d = modal(`<h2>تم إقفال الصندوق</h2><div class="hint ok">تم تسجيل المبلغ المعدود</div><div class="btns"><button class="btn gold" data-ok>تم</button></div>`);
        d.dismissable = false; d.querySelector('[data-ok]').onclick = () => { d.remove(); mountCashStaff({ read, engine, root }); };
      } catch (err) { ev.target.disabled = false; toast(errText(err)); }
    };
  };
}

/* ── owner ── */
async function mountCashAdmin({ read, engine, root, tab = 'moves' }) {
  const { balance, lastClosing: lc } = await read.getCashStatus();
  const moves = await read.getCashLedger({ limit: 60 });
  const closings = (await read.getTransactions({ type: 'CASH_CLOSING', limit: 60 })).map((t) => ({ at: t.timestamp, ...t.items[0] }));
  const alert = !lc ? '' : lc.difference === 0
    ? `<div class="alert good">✔ لا فرق في آخر إقفال (<bdi>${when(lc.at)}</bdi>)</div>`
    : `<div class="alert bad">⚠ آخر إقفال (<bdi>${when(lc.at)}</bdi>): ${lc.difference < 0 ? 'عجز' : 'زيادة'} <bdi>${fmt(Math.abs(lc.difference))} ${CONFIG.currency}</bdi></div>`;
  const diffCls = (d) => (d === 0 ? '' : d < 0 ? 'out' : 'in');
  root.innerHTML = `${alert}
    <div class="kpi"><div><small>الافتتاح</small><b>${fmt(lc?.counted ?? 0)}</b></div><div><small>المتوقع الآن</small><b>${fmt(balance)}</b></div>
      <div><small>فرق آخر إقفال</small><b class="${diffCls(lc?.difference ?? 0)}">${lc ? fmt(lc.difference) : '—'}</b></div></div>
    <div class="btns"><button class="btn gold" data-op="deposit">إيداع</button><button class="btn" data-op="withdraw" style="border-color:var(--gold)">سحب</button></div>
    <div class="tabs"><button class="btn ${tab === 'moves' ? 'on' : ''}" data-tab="moves">الحركات</button><button class="btn ${tab === 'closings' ? 'on' : ''}" data-tab="closings">الإقفالات</button></div>
    <div id="clist">${tab === 'moves'
      ? (moves.length ? moves.map((r) => `<div class="cr"><div>${REASONS[r.reason] ?? esc(r.reason)}<small>${when(r.timestamp)} · الرصيد ${fmt(r.balanceAfter)}</small></div><b class="${r.direction === 'IN' ? 'in' : 'out'}">${r.direction === 'IN' ? '+' : '−'}${fmt(r.amount)}</b></div>`).join('') : '<div class="empty">لا حركات</div>')
      : (closings.length ? closings.map((c) => `<div class="cr"><div>${when(c.at)}<small>المتوقع ${fmt(c.expected)} · المعدود ${fmt(c.counted)}</small></div><b class="${diffCls(c.difference)}">${c.difference > 0 ? '+' : ''}${fmt(c.difference)}</b></div>`).join('') : '<div class="empty">لا إقفالات</div>')}</div>`;
  const again = (t) => mountCashAdmin({ read, engine, root, tab: t });
  root.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => again(b.dataset.tab)));
  root.querySelectorAll('[data-op]').forEach((b) => (b.onclick = () => {
    const op = b.dataset.op, title = op === 'deposit' ? 'إيداع في الصندوق' : 'سحب من الصندوق';
    const m = modal(`<h2>${title}</h2><input id="oa" inputmode="decimal" placeholder="المبلغ" style="${cin}"><input id="on" placeholder="ملاحظة (اختياري)" style="${cin}">
      <div class="btns"><button class="btn" data-c>إلغاء</button><button class="btn gold" data-ok>تأكيد</button></div>`);
    m.querySelector('#oa').focus();
    m.querySelector('[data-c]').onclick = () => m.remove();
    m.querySelector('[data-ok]').onclick = async (ev) => {
      const v = num(m.querySelector('#oa').value);
      if (!(v > 0)) return toast('أدخل المبلغ');
      ev.target.disabled = true;
      try {
        const tx = await engine[op]({ amount: Math.round(v * 100), note: m.querySelector('#on').value.trim() });
        m.remove(); toast(`تمت العملية · فاتورة ${tx.no}`, true); again(tab);
      } catch (err) { ev.target.disabled = false; toast(errText(err)); }
    };
  }));
}
