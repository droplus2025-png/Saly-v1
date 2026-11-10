/* saly-expenses.js — expense = cash out with a description (rent, electricity, transport …) */
async function mountExpenses({ read, engine, root }) {
  root.innerHTML = `<div class="card"><h3>مصروف جديد</h3>
      <input class="cin" id="ea" inputmode="decimal" placeholder="المبلغ" autocomplete="off">
      <input id="en" placeholder="الوصف (كراء، كهرباء، نقل ...)" autocomplete="off" enterkeyhint="done">
      <button class="btn gold" id="esave" style="width:100%;padding:16px;font-size:19px">تسجيل المصروف</button></div>
    <div id="elist"></div>`;
  async function list() {
    const rows = await read.getTransactions({ type: 'EXPENSE', limit: 15 });
    $('#elist').innerHTML = rows.length
      ? `<div class="mh" style="margin:6px 4px;color:var(--gold2)">آخر المصاريف</div>` + rows.map((t) =>
        `<div class="cr"><div>${esc(t.note)}<small><bdi>${fullDate(t.timestamp)}</bdi> · ${t.no}</small></div><b class="out">−${fmt(t.total)}</b></div>`).join('')
      : '';
  }
  async function save() {
    const v = num($('#ea').value);
    if (!(v > 0)) return toast('أدخل المبلغ');
    if (!$('#en').value.trim()) return toast('أدخل وصف المصروف');
    $('#esave').disabled = true;
    try {
      const tx = await engine.expense({ amount: Math.round(v * 100), note: $('#en').value });
      $('#ea').value = $('#en').value = ''; toast(`تم تسجيل المصروف · فاتورة ${tx.no}`, true); await list(); $('#ea').focus();
    } catch (err) { toast(errText(err)); }
    $('#esave').disabled = false;
  }
  $('#esave').onclick = save;
  $('#ea').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#en').focus(); } });
  $('#en').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  $('#ea').addEventListener('focus', (e) => e.target.select());
  await list();
}
