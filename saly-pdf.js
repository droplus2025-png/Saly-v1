/* saly-pdf.js — the invoice, as a modern PDF.
   Each page is drawn on a canvas (so the browser's own Arabic shaping and fonts are used) and packed into a PDF.
   Colours follow the shop's logo (accent picked automatically when the logo is uploaded in Settings).
   Used by: sale (send after saving), invoice archive, returns, Settings (logo + sample). */

const PDF_W = 595, PDF_H = 842, PDF_S = 2.4;   // A4 in points; canvas scale (≈144 dpi)
const PDF_FONT = '"Noto Sans Arabic","Segoe UI",Tahoma,"DejaVu Sans",system-ui,sans-serif';
const ltr = (s) => '\u2066' + s + '\u2069';     // keeps numbers, phones and dates in reading order inside Arabic text
const money = (m) => ltr(`${fmt(m)} ${CONFIG.currency}`);

/* ── colours ── */
const hex2hsl = (hex) => {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  return [h, s, l];
};
const hsl = (h, s, l, a = 1) => `hsla(${h.toFixed(0)},${(s * 100).toFixed(0)}%,${(l * 100).toFixed(0)}%,${a})`;
function pdfPalette() {
  const ok = /^#[0-9a-f]{6}$/i.test(CONFIG.accent || ''), [h, s0] = hex2hsl(ok ? CONFIG.accent : '#2347c5');
  const s = Math.min(Math.max(s0, 0.35), 0.8);
  return {
    dark: hsl(h, s, 0.14), main: hsl(h, s, 0.24), light: hsl(h, 0.5, 0.965), soft: hsl(h, 0.4, 0.93), line: hsl(h, 0.25, 0.86),
    ink: '#1b2236', mute: '#6b7488', gold1: '#f6dd8e', gold2: '#c9962b', red: '#c0392b', green: '#1f9d55', amber: '#d98a00',
  };
}

/* ── drawing helpers ── */
const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
function put(g, s, x, y, o = {}) { // x = the anchor: right edge for 'right', left edge for 'left', middle for 'center'
  const { size = 12, weight = 500, color = '#1b2236', align = 'right', maxW = 0, alpha = 1 } = o;
  let sz = size; g.font = `${weight} ${sz}px ${PDF_FONT}`;
  if (maxW) while (g.measureText(s).width > maxW && sz > size * 0.6) { sz -= 0.5; g.font = `${weight} ${sz}px ${PDF_FONT}`; }
  g.direction = 'rtl'; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillStyle = color; g.globalAlpha = alpha; g.fillText(s, x, y); g.globalAlpha = 1;
}
function wrapText(g, s, maxW, size, weight, maxLines = 2) {
  g.font = `${weight} ${size}px ${PDF_FONT}`;
  const out = []; let line = '';
  for (const w of String(s).split(/\s+/)) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width <= maxW || !line) line = t; else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] += '…'; }
  return out;
}
const pdfImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

const PDF_TITLE = {
  SALE: 'فاتورة', PURCHASE: 'فاتورة شراء', CUSTOMER_RETURN: 'فاتورة إرجاع', SUPPLIER_RETURN: 'إرجاع للمورد', EXPENSE: 'وصل مصروف',
  DEBT_PAYMENT: 'وصل تحصيل', RECEIVABLE_PAYMENT: 'وصل أداء', WITHDRAWAL: 'وصل سحب', DEPOSIT: 'وصل إيداع',
  PREVIOUS_DEBT: 'دين سابق', PREVIOUS_RECEIVABLE: 'مستحق سابق',
};
const PDF_PARTY = {
  SALE: 'الزبون', CUSTOMER_RETURN: 'الزبون', DEBT_PAYMENT: 'الزبون', PREVIOUS_DEBT: 'الزبون',
  PURCHASE: 'المورد', SUPPLIER_RETURN: 'المورد', RECEIVABLE_PAYMENT: 'المورد', PREVIOUS_RECEIVABLE: 'المورد',
};

/* ── the invoice: returns the list of page canvases ── */
async function renderInvoice(tx, ctx = {}) {
  const P = pdfPalette(), logo = CONFIG.logo ? await pdfImg(CONFIG.logo).catch(() => null) : null;
  const L = 36, R = PDF_W - 36, CW = R - L, FOOT = 72, pages = [];
  const goods = isGoods(tx), mods = ctx.mods ?? [], title = PDF_TITLE[tx.type] ?? opName(tx.type), PH = goods ? 842 : 470;
  const modTotal = mods.reduce((s, m) => s + m.total, 0), cashBack = mods.reduce((s, m) => s + m.paid, 0);
  const netPaid0 = tx.paid - cashBack, rest0 = Math.max(0, tx.total - modTotal - netPaid0); // what is still owed after the returns
  let g, y;

  const chips = [];
  if (tx.type === 'SALE' || tx.type === 'PURCHASE') {
    chips.push(rest0 <= 0 ? ['مدفوعة', P.green] : netPaid0 > 0 ? ['دفع جزئي', P.amber] : ['غير مدفوعة', P.red]);
    if (mods.length) chips.push(['معدلة', P.gold2]);
  }

  function newPage(first) {
    const cv = document.createElement('canvas'); cv.width = PDF_W * PDF_S; cv.height = PH * PDF_S;
    g = cv.getContext('2d'); g.scale(PDF_S, PDF_S); g.fillStyle = '#fff'; g.fillRect(0, 0, PDF_W, PH); pages.push(cv);
    const bandH = first ? 150 : 54;
    const gr = g.createLinearGradient(0, 0, PDF_W, bandH); gr.addColorStop(0, P.dark); gr.addColorStop(1, P.main);
    g.fillStyle = gr; g.fillRect(0, 0, PDF_W, bandH);
    g.globalAlpha = 0.07; g.fillStyle = '#fff'; g.beginPath(); g.arc(70, 10, first ? 120 : 50, 0, 7); g.fill(); g.beginPath(); g.arc(560, bandH, first ? 95 : 40, 0, 7); g.fill(); g.globalAlpha = 1;
    const gl = g.createLinearGradient(0, 0, PDF_W, 0); gl.addColorStop(0, P.gold2); gl.addColorStop(0.5, P.gold1); gl.addColorStop(1, P.gold2);
    g.fillStyle = gl; g.fillRect(0, bandH, PDF_W, 4);
    if (!first) { // compact header of the following pages
      put(g, CONFIG.storeName, R, 33, { size: 16, weight: 800, color: '#fff', maxW: 300 });
      put(g, `${title} ${ltr(tx.no ?? '')}`, L, 33, { size: 13, weight: 700, color: P.gold1, align: 'left' });
      y = 76; return;
    }
    const bx = R - 80, by = 34;
    g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 14; g.shadowOffsetY = 4; rr(g, bx, by, 80, 80, 20); g.fillStyle = '#fff'; g.fill(); g.restore();
    if (logo) { const k = Math.min(64 / logo.width, 64 / logo.height), w = logo.width * k, h = logo.height * k; g.drawImage(logo, bx + 40 - w / 2, by + 40 - h / 2, w, h); }
    else put(g, (CONFIG.storeName || 'S').trim().charAt(0).toUpperCase(), bx + 40, by + 55, { size: 42, weight: 800, color: P.main, align: 'center' });
    const nx = bx - 18, lines = wrapText(g, CONFIG.storeName, 255, 26, 800, 2), sz = lines.length > 1 ? 21 : 26;
    let ty = 62;
    for (const ln of lines) { put(g, ln, nx, ty, { size: sz, weight: 800, color: '#fff', maxW: 255 }); ty += sz + 3; }
    if (CONFIG.address) { put(g, CONFIG.address, nx, ty + 2, { size: 11, color: '#fff', alpha: 0.88, maxW: 255 }); ty += 16; }
    if (CONFIG.phone) { put(g, `هاتف: ${ltr(CONFIG.phone)}`, nx, ty + 2, { size: 11, color: '#fff', alpha: 0.88 }); ty += 16; }
    if (CONFIG.extra) put(g, CONFIG.extra, nx, ty + 2, { size: 9.5, color: '#fff', alpha: 0.72, maxW: 255 });
    put(g, title, L, 70, { size: 34, weight: 800, color: P.gold1, align: 'left', maxW: 190 });
    put(g, `رقم ${ltr(tx.no ?? '—')}`, L, 96, { size: 15, weight: 700, color: '#fff', align: 'left' });
    put(g, ltr(fullDate(tx.timestamp)), L, 115, { size: 11, color: '#fff', alpha: 0.85, align: 'left' });
    let cx = L; // status chips
    for (const [txt, col] of chips) {
      g.font = `700 10.5px ${PDF_FONT}`; const w = g.measureText(txt).width + 22;
      rr(g, cx, 124, w, 20, 10); g.fillStyle = col; g.fill(); put(g, txt, cx + w / 2, 138, { size: 10.5, weight: 700, color: '#fff', align: 'center' }); cx += w + 8;
    }
    y = 176;
  }
  const need = (h, head) => { if (y + h > PH - FOOT) { newPage(false); if (head) head(); } };

  newPage(true);

  /* who + how */
  const pl = PDF_PARTY[tx.type];
  if (tx.party || goods) {
    rr(g, L, y, CW, 58, 14); g.fillStyle = P.light; g.fill(); g.strokeStyle = P.line; g.lineWidth = 1; g.stroke();
    const col = (label, val, x, w) => { put(g, label, x, y + 20, { size: 9.5, color: P.mute }); put(g, val, x, y + 42, { size: 15, weight: 700, color: P.ink, maxW: w }); };
    col(pl ?? 'الزبون', tx.party ? tx.party.nom : 'زبون نقدي', R - 14, 205);
    col('الهاتف', tx.party ? ltr(tx.party.phone) : '—', 328, 140);
    if (isReturn(tx) && ctx.orig) col('مرجع الفاتورة', ltr(ctx.orig.no ?? '—'), 168, 120);
    else col('الدفع', tx.settlement === 'DEBT' ? (tx.paid > 0 ? 'جزئي' : 'دين') : 'نقداً', 168, 120);
    y += 74;
  }

  /* items */
  if (goods) {
    const head = () => {
      rr(g, L, y, CW, 26, 8); g.fillStyle = P.main; g.fill();
      const o = { size: 10.5, weight: 700, color: '#fff' };
      put(g, '#', R - 13, y + 17.5, { ...o, align: 'center' }); put(g, 'المنتج', R - 34, y + 17.5, o);
      put(g, 'الكمية', 268, y + 17.5, { ...o, align: 'center' }); put(g, 'السعر', 192, y + 17.5, { ...o, align: 'center' }); put(g, 'المجموع', 91, y + 17.5, { ...o, align: 'center' });
      y += 32;
    };
    head();
    tx.items.forEach((l, i) => {
      const lines = wrapText(g, l.produit, 218, 12, 700, 2), h = lines.length * 15 + 12;
      need(h, head);
      if (i % 2 === 0) { g.fillStyle = P.light; g.fillRect(L, y, CW, h); }
      g.fillStyle = P.line; g.fillRect(L, y + h - 0.6, CW, 0.6);
      const my = y + h / 2 + 4.2;
      put(g, String(i + 1), R - 13, my, { size: 10.5, color: P.mute, align: 'center' });
      lines.forEach((ln, k) => put(g, ln, R - 34, y + 17 + k * 15 - (lines.length === 1 ? 2 : 0), { size: 12, weight: 700, color: P.ink }));
      put(g, ltr(fmtQty(l.quantity)), 268, my, { size: 12, align: 'center' });
      put(g, ltr(fmt(unitOf(tx, l))), 192, my, { size: 12, align: 'center' });
      put(g, ltr(fmt(l.lineTotal)), 91, my, { size: 12, weight: 700, color: P.ink, align: 'center' });
      y += h;
    });
    y += 16;

    /* totals (left) + stamp box (right) */
    const ml = moneyLabels(tx), qty = tx.items.reduce((s, l) => s + l.quantity, 0), net = tx.total - modTotal, ret = isReturn(tx);
    const rows = [['عدد القطع', ltr(fmtQty(qty)), P.ink]];
    if (mods.length) { rows.push(['المجموع', money(tx.total), P.ink]); mods.forEach((m) => rows.push([`إرجاع ${ltr(m.no ?? '')}`, ltr('−' + fmt(m.total) + ' ' + CONFIG.currency), P.red])); }
    rows.push([ml[0], money(ret ? tx.paid : netPaid0), P.ink]);
    const rest = ret ? tx.total - tx.paid : rest0;
    if (rest > 0) rows.push([ml[1], money(rest), P.red]);
    const cardH = rows.length * 24 + 62; need(cardH);
    const cw = 270;
    rr(g, L, y, cw, cardH, 16); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = P.line; g.stroke();
    rows.forEach(([lab, val, col], i) => {
      put(g, lab, L + cw - 16, y + 25 + i * 24, { size: 11.5, color: P.mute }); put(g, val, L + 16, y + 25 + i * 24, { size: 12, weight: 700, color: col, align: 'left' });
      if (i < rows.length - 1) { g.fillStyle = P.line; g.fillRect(L + 14, y + 33 + i * 24, cw - 28, 0.6); }
    });
    const by = y + rows.length * 24 + 6, gb = g.createLinearGradient(L, by, L + cw, by + 44);
    gb.addColorStop(0, P.gold1); gb.addColorStop(1, P.gold2); rr(g, L + 8, by, cw - 16, 44, 12); g.fillStyle = gb; g.fill();
    put(g, mods.length ? 'الصافي بعد الإرجاع' : isReturn(tx) ? 'إجمالي المرتجع' : 'الإجمالي', L + cw - 24, by + 28, { size: 12.5, weight: 700, color: P.dark });
    put(g, money(mods.length ? net : tx.total), L + 22, by + 29, { size: 18, weight: 800, color: P.dark, align: 'left', maxW: 120 });
    const sx = L + cw + 16, sw = R - sx;
    g.setLineDash([5, 4]); g.strokeStyle = P.line; rr(g, sx, y, sw, cardH, 16); g.stroke(); g.setLineDash([]);
    put(g, 'الختم والتوقيع', sx + sw / 2, y + 22, { size: 10, color: P.mute, align: 'center' });
    y += cardH + 14;
  } else {
    /* receipts: one large amount */
    need(170);
    rr(g, L, y, CW, 150, 18); g.fillStyle = P.light; g.fill(); g.strokeStyle = P.line; g.stroke();
    put(g, title, PDF_W / 2, y + 36, { size: 13, color: P.mute, align: 'center' });
    put(g, money(tx.total), PDF_W / 2, y + 88, { size: 40, weight: 800, color: P.main, align: 'center', maxW: CW - 40 });
    if (tx.note) wrapText(g, tx.note, CW - 60, 13, 500, 2).forEach((ln, i) => put(g, ln, PDF_W / 2, y + 120 + i * 18, { size: 13, color: P.ink, align: 'center' }));
    y += 168;
  }

  /* footer on every page */
  pages.forEach((cv, i) => {
    const c = cv.getContext('2d'); c.setTransform(PDF_S, 0, 0, PDF_S, 0, 0); g = c;
    const gl = c.createLinearGradient(L, 0, R, 0); gl.addColorStop(0, 'rgba(201,150,43,0)'); gl.addColorStop(0.5, P.gold2); gl.addColorStop(1, 'rgba(201,150,43,0)');
    c.fillStyle = gl; c.fillRect(L, PH - 62, CW, 1.6);
    put(c, CONFIG.thanks, PDF_W / 2, PH - 42, { size: 13, weight: 700, color: P.main, align: 'center', maxW: CW });
    const contact = [CONFIG.address, CONFIG.phone && ltr(CONFIG.phone)].filter(Boolean).join('   •   ');
    if (contact) put(c, contact, PDF_W / 2, PH - 25, { size: 9.5, color: P.mute, align: 'center', maxW: CW });
    if (pages.length > 1) put(c, `صفحة ${i + 1} من ${pages.length}`, L, PH - 25, { size: 9, color: P.mute, align: 'left' });
  });
  return pages;
}

/* ── a minimal PDF writer: one JPEG per A4 page ── */
function buildPdf(pages) {
  const enc = new TextEncoder(), parts = [], off = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const jpgs = pages.map((cv) => { const b = atob(cv.toDataURL('image/jpeg', 0.92).split(',')[1]), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; });
  const n = pages.length;
  push('%PDF-1.4\n');
  off[1] = len; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  off[2] = len; push(`2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`);
  pages.forEach((cv, i) => {
    const p = 3 + 3 * i, H = cv.height / PDF_S, c = `q ${PDF_W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    off[p] = len; push(`${p} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W} ${H}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>\nendobj\n`);
    off[p + 1] = len; push(`${p + 1} 0 obj\n<< /Length ${c.length} >>\nstream\n${c}\nendstream\nendobj\n`);
    off[p + 2] = len; push(`${p + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpgs[i].length} >>\nstream\n`);
    push(jpgs[i]); push('\nendstream\nendobj\n');
  });
  const total = 2 + 3 * n, xr = len;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n` + off.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

/* ── related operations (the original invoice of a return; the returns made on an invoice) ── */
async function pdfContext(tx, read) {
  if (!read || !(tx.refId || tx.type === 'SALE' || tx.type === 'PURCHASE') || !tx.id) return {};
  const all = await read.getTransactions({ limit: 100000 });
  return { orig: tx.refId ? all.find((t) => t.id === tx.refId) : undefined, mods: all.filter((t) => t.refId === tx.id) };
}
const makeInvoicePdf = async (tx, ctx) => buildPdf(await renderInvoice(tx, ctx));

/** One tap: builds the PDF and opens the phone's share sheet (WhatsApp is right there).
 *  Where sharing files is not supported (desktop) the PDF is downloaded and the customer's WhatsApp chat is opened. */
async function shareInvoice(tx, read) {
  toast('جارٍ تجهيز الفاتورة…', true);
  let file;
  try { file = new File([await makeInvoicePdf(tx, await pdfContext(tx, read))], `invoice-${tx.no ?? 'saly'}.pdf`, { type: 'application/pdf' }); }
  catch (e) { return toast('تعذر إنشاء الفاتورة'); }
  const text = `${CONFIG.storeName} — فاتورة ${tx.no ?? ''}`.trim();
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: text, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(file.name, file);
  toast('تم حفظ الفاتورة PDF — أرفقها في المحادثة', true);
  const n = tx.party && waNumber(tx.party.phone);
  if (n) window.open(`https://wa.me/${n}?text=${encodeURIComponent(text)}`, '_blank');
}

/** Full-screen preview of exactly what the customer receives. */
async function previewInvoice(tx, read) {
  const pv = document.createElement('div'); pv.className = 'pv';
  pv.innerHTML = '<div class="pvbar"><button class="btn" data-x>إغلاق</button><button class="btn p" data-s>إرسال PDF</button></div><div class="empty" data-i>جارٍ التجهيز…</div>';
  document.body.append(pv);
  pv.querySelector('[data-x]').onclick = () => pv.remove();
  pv.querySelector('[data-s]').onclick = () => shareInvoice(tx, read);
  try {
    const pages = await renderInvoice(tx, await pdfContext(tx, read));
    pv.querySelector('[data-i]').outerHTML = pages.map((cv) => `<img alt="" src="${cv.toDataURL('image/jpeg', 0.85)}">`).join('');
  } catch (e) { pv.querySelector('[data-i]').textContent = 'تعذر إنشاء الفاتورة'; }
}

/* ── shop logo (Settings): shrink it, and pick the invoice accent colour from it ── */
function dominantColor(src) {
  const c = document.createElement('canvas'); c.width = c.height = 48; const g = c.getContext('2d'); g.drawImage(src, 0, 0, 48, 48);
  const d = g.getImageData(0, 0, 48, 48).data, bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const hex = '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''), [h, s, l] = hex2hsl(hex);
    if (s < 0.28 || l > 0.9 || l < 0.1) continue;                   // skip white, black and greys
    const b = bins[Math.floor(h / 30) % 12], w = s * (1 - Math.abs(l - 0.5));
    b.w += w; b.r += d[i] * w; b.g += d[i + 1] * w; b.b += d[i + 2] * w;
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a), bins[0]);
  return best.w > 0 ? '#' + [best.r, best.g, best.b].map((v) => Math.round(v / best.w).toString(16).padStart(2, '0')).join('') : '';
}
async function prepareLogo(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let url = c.toDataURL('image/png');
  if (url.length > 220000) { // photo-like logo: flatten on white and compress
    const f = document.createElement('canvas'); f.width = c.width; f.height = c.height; const g = f.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, f.width, f.height); g.drawImage(c, 0, 0);
    url = f.toDataURL('image/jpeg', 0.88);
  }
  return { logo: url, accent: dominantColor(c) };
}
/** A made-up invoice, to see the design in Settings. */
const sampleInvoice = () => ({
  type: 'SALE', no: '1109001', timestamp: Date.now(), total: 679000, paid: 89000, settlement: 'DEBT', party: { nom: 'زبون تجريبي', phone: '0612345678' }, note: '',
  items: [{ produit: 'اسمنت 50 كغ', quantity: 80, unitPrice: 1800, lineTotal: 144000 }, { produit: 'حديد التسليح 8 ملم', quantity: 50, unitPrice: 5000, lineTotal: 250000 }, { produit: 'دهان داخلي أبيض 20 لتر', quantity: 19, unitPrice: 15000, lineTotal: 285000 }],
});
