/* Home: navigation only. Pages that are not built yet show a notice. */
try { await boot(); } catch { /* error already shown; defaults stay */ }
const now = new Date();
const wd = now.toLocaleDateString('ar-u-nu-latn', { weekday: 'long' });
const dm = now.toLocaleDateString('ar-u-nu-latn', { day: 'numeric', month: 'long' });
$('#store').textContent = CONFIG.storeName; // shop / company name from Settings, always shown above the date
$('#sub').textContent = `${wd} · ${dm}`;
document.addEventListener('click', (e) => { if (e.target.closest('[data-soon]')) toast('هذه الصفحة قيد البناء'); });
