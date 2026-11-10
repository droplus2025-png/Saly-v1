/* admin.js — PIN gate → menu → settings / owner inventory. The unlock lives in memory only. */
const view = $('#view');
let read, engine;

function go(name) {
  const screens = { gate, menu, settings, stock, cash };
  view.onclick = view.onkeydown = null; // every screen starts with clean handlers
  onBack(name === 'menu' || name === 'gate' ? null : () => go('menu'));
  screens[name]();
}

async function gate() {
  setTitle('الإدارة');
  const has = await read.hasAdminPin();
  view.innerHTML = `<div class="card"><h3>${has ? 'أدخل الرمز السري' : 'أنشئ الرمز السري (4 أرقام على الأقل)'}</h3>
    <input id="p1" type="password" inputmode="numeric" autocomplete="off" placeholder="الرمز السري">
    ${has ? '' : '<input id="p2" type="password" inputmode="numeric" autocomplete="off" placeholder="تأكيد الرمز">'}
    <button class="btn gold" id="go" style="width:100%">دخول</button></div>`;
  const p1 = $('#p1'); p1.focus();
  const enter = async () => {
    const pin = latin(p1.value).trim();
    try {
      if (has) { if (!(await read.verifyAdminPin(pin))) return toast('الرمز السري غير صحيح'); }
      else { if (pin !== latin($('#p2').value).trim()) return toast('الرمزان غير متطابقين'); await engine.setAdminPin(pin); }
      go('menu');
    } catch (e) { toast(errText(e)); }
  };
  $('#go').onclick = enter;
  view.onkeydown = (e) => { if (e.key === 'Enter') enter(); }; // replaced (not stacked) and cleared by go()
}

function menu() {
  setTitle('الإدارة');
  view.innerHTML = `<div class="menu"><button class="tbtn gold" data-go="stock">المخزون</button><button class="tbtn" data-go="cash">الصندوق</button><button class="tbtn" data-go="settings">الإعدادات</button></div>`;
  view.onclick = (e) => { const g = e.target.closest('[data-go]')?.dataset.go; if (g) go(g); };
}

function stock() { setTitle('المخزون'); view.onclick = null; mountStock({ read, engine, admin: true, root: view }); }

function cash() { setTitle('الصندوق'); view.onclick = null; mountCashAdmin({ read, engine, root: view }); }

async function settings() {
  setTitle('الإعدادات'); view.onclick = null;
  const s = await read.getSettings();
  const F = [['storeName', 'اسم المحل أو الشركة'], ['phone', 'هاتف المحل'], ['address', 'العنوان'], ['thanks', 'عبارة الشكر في الفاتورة'], ['extra', 'معلومات إضافية في الفاتورة (ICE، RC ...)'], ['currency', 'العملة'], ['countryCode', 'رمز الدولة لواتساب (مثال: 212)']];
  view.innerHTML = `<div class="card"><h3>معلومات المحل والفاتورة</h3>
      ${F.map(([k, l]) => `<label class="fl">${l}</label><input data-k="${k}" value="${esc(s[k])}">`).join('')}
      <label class="fl">شعار المحل (يظهر في الفاتورة وتُستخرج منه ألوانها)</label>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <img id="lgp" alt="" style="width:64px;height:64px;object-fit:contain;border-radius:14px;background:#fff;padding:4px;flex:none" ${s.logo ? `src="${s.logo}"` : 'hidden'}>
        <button class="btn" id="lgpick">اختيار الشعار</button><button class="btn" id="lgdel" ${s.logo ? '' : 'hidden'}>حذف</button></div>
      <input type="file" id="lgfile" accept="image/*" hidden>
      <div class="btns" style="margin-bottom:10px"><button class="btn" id="lgview">معاينة تصميم الفاتورة</button></div>
      <button class="btn gold" id="save" style="width:100%">حفظ</button></div>
    <div class="card"><h3>تغيير الرمز السري</h3>
      <input id="c0" type="password" inputmode="numeric" placeholder="الرمز الحالي">
      <input id="c1" type="password" inputmode="numeric" placeholder="الرمز الجديد">
      <input id="c2" type="password" inputmode="numeric" placeholder="تأكيد الرمز الجديد">
      <button class="btn" id="pin" style="width:100%">تغيير الرمز</button></div>
    <div class="card"><h3>النسخ الاحتياطي</h3>
      <div class="hint" id="bk"></div>
      <div class="btns"><button class="btn gold" id="bsave">حفظ نسخة</button><button class="btn" id="bshare">مشاركة</button></div>
      <button class="btn" id="brest" style="width:100%;margin-top:10px">استعادة نسخة</button>
      <input type="file" id="bfile" accept=".json,application/json" hidden></div>
    <div class="card"><h3>تصفير البيانات (remise à zéro)</h3>
      <div class="hint dbt">يُحذف: الصندوق، ديون الزبائن، مستحقات الموردين، سجل العمليات والفواتير.<br>يبقى: المخزون والإعدادات والرمز السري.</div>
      <button class="btn" id="rst" style="width:100%;border-color:var(--bad);color:var(--bad)">تصفير البيانات</button></div>
    <div class="hint" style="opacity:.7">الإصدار: <bdi>${SALY_VERSION}</bdi></div>`;
  const setLogo = async (patch) => {
    try { Object.assign(CONFIG, await engine.saveSettings(patch)); $('#lgp').hidden = !CONFIG.logo; if (CONFIG.logo) $('#lgp').src = CONFIG.logo; $('#lgdel').hidden = !CONFIG.logo; toast('تم حفظ الشعار', true); }
    catch (e) { toast(errText(e)); }
  };
  $('#lgpick').onclick = () => $('#lgfile').click();
  $('#lgfile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { await setLogo(await prepareLogo(f)); } catch { toast('تعذر قراءة الصورة'); }
  };
  $('#lgdel').onclick = () => setLogo({ logo: '', accent: '' });
  $('#lgview').onclick = () => previewInvoice(sampleInvoice(), null);
  $('#save').onclick = async () => {
    const patch = {}; view.querySelectorAll('[data-k]').forEach((i) => (patch[i.dataset.k] = i.value));
    try { Object.assign(CONFIG, await engine.saveSettings(patch)); toast('تم الحفظ', true); } catch (e) { toast(errText(e)); }
  };
  /* backup: one file with everything; restore replaces all data on this device (PIN required) */
  const showBk = async () => {
    const t = await read.getLastBackup();
    $('#bk').className = 'hint ' + (t ? 'ok' : 'dbt'); $('#bk').textContent = t ? `آخر نسخة: ${when(t)}` : 'لم تؤخذ نسخة احتياطية بعد';
  };
  showBk();
  const makeBackup = async () => {
    const d = new Date(), name = `saly-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    return { name, text: JSON.stringify(await read.exportBackup()) };
  };
  $('#bsave').onclick = async () => {
    try { const { name, text } = await makeBackup(); download(name, text, 'application/json', false); await engine.recordBackup(); showBk(); toast('تم حفظ النسخة الاحتياطية', true); }
    catch (e) { toast(errText(e)); }
  };
  $('#bshare').onclick = async () => { // share the file (WhatsApp, Drive …); falls back to a normal download
    try {
      const { name, text } = await makeBackup(), file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'saly backup' }); else download(name, text, 'application/json', false);
      await engine.recordBackup(); showBk();
    } catch (e) { if (e.name !== 'AbortError') toast(errText(e)); }
  };
  $('#brest').onclick = () => $('#bfile').click();
  $('#bfile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let b; try { b = JSON.parse(await f.text()); } catch { return toast('ملف النسخة الاحتياطية غير صالح'); }
    if (b?.format !== 'saly-backup') return toast('ملف النسخة الاحتياطية غير صالح');
    const m = modal(`<h2>⚠ استعادة نسخة</h2><div class="hint">نسخة بتاريخ <bdi>${when(b.createdAt)}</bdi> · ${b.data?.products?.length ?? 0} منتج · ${b.data?.transactions?.length ?? 0} عملية</div>
      <div class="hint dbt">سيتم استبدال كل بيانات هذا الجهاز بمحتوى النسخة، ولا يمكن التراجع. أدخل الرمز السري الحالي للتأكيد.</div>
      <input id="rp2" type="password" inputmode="numeric" placeholder="الرمز السري" style="width:100%;margin-bottom:10px;background:var(--field);border:1px solid var(--line);border-radius:14px;padding:13px;font-size:17px">
      <div class="btns"><button class="btn" data-c>إلغاء</button><button class="btn gold" data-ok>استعادة</button></div>`);
    m.querySelector('[data-c]').onclick = () => m.remove();
    m.querySelector('[data-ok]').onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        await engine.restoreBackup(b, latin(m.querySelector('#rp2').value).trim()); m.remove();
        Object.assign(CONFIG, await read.getSettings()); toast('تمت الاستعادة — أدخل الرمز السري', true); go('gate');
      } catch (err) { ev.target.disabled = false; toast(errText(err)); }
    };
  };
  $('#rst').onclick = () => {
    const m = modal(`<h2>⚠ تأكيد التصفير</h2><div class="hint dbt">لا يمكن التراجع عن هذه العملية. أدخل الرمز السري للتأكيد.</div>
      <input id="rp" type="password" inputmode="numeric" placeholder="الرمز السري" style="width:100%;margin-bottom:10px;background:var(--field);border:1px solid var(--line);border-radius:14px;padding:13px;font-size:17px">
      <div class="btns"><button class="btn" data-c>إلغاء</button><button class="btn gold" data-ok>تصفير</button></div>`);
    m.querySelector('[data-c]').onclick = () => m.remove();
    m.querySelector('[data-ok]').onclick = async () => {
      try { await engine.resetData(latin(m.querySelector('#rp').value).trim()); m.remove(); toast('تم تصفير البيانات (المخزون محفوظ)', true); }
      catch (e) { toast(errText(e)); }
    };
  };
  $('#pin').onclick = async () => {
    const [c0, c1, c2] = ['#c0', '#c1', '#c2'].map((i) => latin($(i).value).trim());
    if (c1 !== c2) return toast('الرمزان الجديدان غير متطابقين');
    try { await engine.setAdminPin(c1, c0); ['#c0', '#c1', '#c2'].forEach((i) => ($(i).value = '')); toast('تم تغيير الرمز السري', true); } catch (e) { toast(errText(e)); }
  };
}

try { ({ read, engine } = await boot()); go('gate'); } catch { /* error already shown */ }
