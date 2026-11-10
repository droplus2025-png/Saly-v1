/* saly-ui.js — helpers shared by every screen (no business logic here) */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const latin = (s) => String(s).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/[،,]/g, '.');
const num = (s) => { const n = parseFloat(latin(s).trim()); return Number.isFinite(n) ? n : NaN; };
const digits = (s) => latin(s).replace(/\D/g, ''); // phone numbers typed with Arabic-Indic digits work too
const fmt = (m) => { const v = m / 100; return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const fmtQty = (q) => q.toLocaleString('en-US', { maximumFractionDigits: 3 });
const smallestFree = (used) => { let n = 1; while (used.has(n)) n++; return n; };
const pad = (n) => String(n).padStart(2, '0');

const CONFIG = { ...DEFAULT_SETTINGS }; // filled from the engine's settings at boot()

const ERRORS = {
  INSUFFICIENT_STOCK: (e) => `الكمية غير كافية في المخزون (المتوفر: ${e.details?.available})`,
  SKU_EXISTS: (e) => `الرقم مستعمل: ${e.details?.product?.produit ?? ''}`,
  INVALID_SKU: () => 'الرقم يجب أن يكون عدداً صحيحاً موجباً',
  PARTY_REQUIRED: () => 'الاسم والهاتف (6 أرقام على الأقل) مطلوبان',
  INVALID_BACKUP: () => 'ملف النسخة الاحتياطية غير صالح',
  NOTE_REQUIRED: () => 'الوصف مطلوب',
  RETURN_EXCEEDS: (e) => `الكمية أكبر من المتبقي في الفاتورة (المتبقي: ${e.details?.left})`,
  OVERPAYMENT: () => 'المبلغ المدفوع أكبر من قيمة الفاتورة',
  NOT_FOUND: () => 'العنصر غير موجود',
  WRONG_PIN: () => 'الرمز السري الحالي غير صحيح',
  INVALID_PIN: () => 'الرمز السري: من 4 إلى 12 رقماً',
  INVALID_SETTINGS: () => 'اسم المحل مطلوب',
  INVALID_QUANTITY: () => 'الكمية غير صحيحة',
};
const errText = (e) => (ERRORS[e.code] ? ERRORS[e.code](e) : e.message || 'حدث خطأ');

let toastTimer;
function toast(msg, ok = false) {
  const t = $('#toast'); t.textContent = msg; t.className = ok ? 'okt' : ''; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.display = 'none'), 3800);
}
function modal(html) {
  const m = document.createElement('div'); m.className = 'ov';
  m.innerHTML = `<div class="box">${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m && m.dismissable !== false) m.remove(); });
  document.body.append(m);
  return m;
}

/* the field being typed in is moved into the UPPER part of the screen, above the on-screen keyboard
   (fields inside pop-ups are already there: pop-ups are drawn in the top half) */
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el.matches?.('input, textarea, select') || el.closest('.ov')) return;
  document.body.classList.add('typing');
  setTimeout(() => {
    const top = el.getBoundingClientRect().top;
    if (top > innerHeight * 0.35 || top < 0) scrollBy({ top: top - innerHeight * 0.18, behavior: 'smooth' });
  }, 280); // after the keyboard has opened
});
document.addEventListener('focusout', () => setTimeout(() => {
  if (!document.activeElement?.matches?.('input, textarea, select')) document.body.classList.remove('typing');
}, 120));

/* unified header: logo (right) · title (center) · back (left) */
let backFn = () => history.back();
const onBack = (fn) => { backFn = fn || (() => history.back()); };
const setTitle = (t) => { $('#title').textContent = t; document.title = 'saly — ' + t; };
$('#back')?.addEventListener('click', () => backFn());

async function boot() {
  try {
    const s = await openSaly();
    Object.assign(CONFIG, await s.read.getSettings());
    return s;
  } catch (err) { toast('تعذر فتح قاعدة البيانات: ' + (err.message || err)); throw err; }
}

function download(name, data, type = 'text/csv;charset=utf-8', bom = true) { // data: text or a Blob/File
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([bom ? '\ufeff' + data : data], { type }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
