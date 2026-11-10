/* saly-stock.js — inventory screen. admin=false → view/search only; admin=true → owner tools. */
function parseTable(text) {
  const delim = text.includes('\t') ? '\t' : text.includes(';') ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Text → products. Columns: produit, purchasePrice, salePrice, quantity (a leading sku column is ignored). */
function textToProducts(text) {
  const products = [], errors = [];
  parseTable(text.replace(/^\ufeff/, '')).forEach((r0, i) => {
    let r = r0.map((c) => c.trim());
    if (r.length >= 5) r = r.slice(1);
    const [name, buy, sell, qty = ''] = r;
    if (i === 0 && !Number.isFinite(num(buy ?? ''))) return; // header row
    const b = num(buy ?? ''), s = num(sell ?? ''), q = qty === '' ? 0 : num(qty);
    if (!name || !(b >= 0) || !(s >= 0) || !(q >= 0)) { errors.push(i + 1); return; }
    products.push({ produit: name, purchasePrice: Math.round(b * 100), salePrice: Math.round(s * 100), quantity: q });
  });
  return { products, errors };
}

function mountStock({ read, engine, admin, root }) {
  const tools = admin ? `<div class="tools">
      <button class="tbtn gold" data-a="add">➕ إضافة</button>
      <button class="tbtn" data-a="import">⬆️ استيراد CSV</button>
      <button class="tbtn" data-a="export">⬇️ تصدير CSV</button>
      <button class="tbtn gold" data-a="quick">⚡ إدخال سريع</button>
      <button class="tbtn" data-a="paste">📋 لصق من Excel</button>
      <button class="tbtn" data-a="tpl">📄 نموذج CSV</button>
    </div><input type="file" id="file" accept=".csv,.txt,text/csv" hidden>` : '';
  root.innerHTML = `<input id="q" type="search" inputmode="search" autocomplete="off" placeholder="بحث: اسم المنتج أو رقمه">${tools}
    <div class="tbl"><div class="th"><span>المنتج</span><span>شراء</span><span>بيع</span><span>الكمية</span></div><div id="rows"></div></div>`;

  let all = [], seq = 0;
  const LIMIT = 500;
  async function render() {
    const mine = ++seq; all = await read.getProducts(); if (mine !== seq) return;
    const q = latin($('#q').value).trim().toLowerCase();
    const rows = !q ? all : /^\d+$/.test(q) ? all.filter((p) => String(p.sku).startsWith(q)) : all.filter((p) => p.produit.toLowerCase().includes(q));
    $('#rows').innerHTML = rows.length
      ? rows.slice(0, LIMIT).map((p) => `<div class="tr${admin ? ' ed' : ''}" data-sku="${p.sku}"><span><b class="bd">${p.sku}</b>${esc(p.produit)}</span><span>${fmt(p.purchasePrice)}</span><span>${fmt(p.salePrice)}</span><span>${fmtQty(p.quantity)}</span></div>`).join('')
        + (rows.length > LIMIT ? `<div class="empty">يتم عرض ${LIMIT} من ${rows.length} — استخدم البحث</div>` : '')
      : `<div class="empty">${all.length ? 'لا توجد نتائج' : 'لا توجد منتجات'}</div>`;
  }
  $('#q').addEventListener('input', render);
  render();
  if (!admin) return;

  /* ── owner tools (every write goes through the engine) ── */
  function productModal({ title, p = {}, ok = 'حفظ', again = false, submit }) {
    const m = modal(`<h2>${title}</h2>
      <input id="f0" inputmode="numeric" placeholder="الرقم" value="${p.sku ?? smallestFree(new Set(all.map((x) => x.sku)))}">
      <input id="f1" placeholder="اسم المنتج" value="${esc(p.produit ?? '')}">
      <input id="f2" inputmode="decimal" placeholder="سعر الشراء" value="${p.purchasePrice != null ? p.purchasePrice / 100 : ''}">
      <input id="f3" inputmode="decimal" placeholder="سعر البيع" value="${p.salePrice != null ? p.salePrice / 100 : ''}">
      <input id="f4" inputmode="decimal" placeholder="الكمية" value="${p.quantity ?? ''}">
      <div class="hint ok" id="fh"></div>
      <div class="btns"><button class="btn" data-c>إغلاق</button><button class="btn gold" data-ok>${ok}</button></div>`);
    const f = [0, 1, 2, 3, 4].map((i) => m.querySelector('#f' + i)), fh = m.querySelector('#fh');
    f[1].focus();
    /* typing a number that already belongs to another product shows that product with a warning */
    const warn = () => {
      const n = parseInt(latin(f[0].value), 10);
      const c = Number.isFinite(n) && n !== p.sku ? all.find((x) => x.sku === n) : undefined;
      fh.className = 'hint ' + (c ? 'dbt' : 'ok');
      fh.textContent = c ? `⚠ الرقم ${c.sku} مستعمل: ${c.produit} (شراء ${fmt(c.purchasePrice)} · بيع ${fmt(c.salePrice)} · كمية ${fmtQty(c.quantity)})` : '';
      return c;
    };
    f[0].addEventListener('input', warn);
    const send = async () => {
      if (warn()) return;
      const skuTxt = latin(f[0].value).trim(), sku = skuTxt === '' ? undefined : Number(skuTxt);
      const name = f[1].value.trim(), b = num(f[2].value), s = num(f[3].value), q = f[4].value.trim() === '' ? 0 : num(f[4].value);
      if (!name || !(b >= 0) || !(s >= 0) || !(q >= 0) || (sku !== undefined && !(Number.isInteger(sku) && sku >= 1))) return toast('أدخل الرقم والاسم والأسعار والكمية بشكل صحيح');
      try {
        const msg = await submit({ sku, produit: name, purchasePrice: Math.round(b * 100), salePrice: Math.round(s * 100), quantity: q });
        await render();
        if (again) { f.forEach((x) => (x.value = '')); f[0].value = smallestFree(new Set(all.map((x) => x.sku))); f[1].focus(); fh.className = 'hint ok'; fh.textContent = msg; } else m.remove();
      } catch (e) { toast(errText(e)); }
    };
    f.forEach((inp, i) => inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return; e.preventDefault();
      if (i < 4) f[i + 1].focus(); else send();
    }));
    m.querySelector('[data-c]').onclick = () => m.remove();
    m.querySelector('[data-ok]').onclick = send;
  }

  function confirmImport(text) {
    const { products, errors } = textToProducts(text);
    if (errors.length) return toast(`بيانات غير صحيحة في السطر: ${errors.slice(0, 5).join('، ')}`);
    if (!products.length) return toast('لا توجد منتجات للاستيراد');
    const m = modal(`<h2>استيراد المنتجات</h2><div class="big">${products.length}</div>
      <div class="hint">سيتم إضافة ${products.length} منتج جديد (بأرقام جديدة)</div>
      <div class="btns"><button class="btn" data-c>إلغاء</button><button class="btn gold" data-ok>تأكيد</button></div>`);
    m.querySelector('[data-c]').onclick = () => m.remove();
    m.querySelector('[data-ok]').onclick = async () => {
      try { const n = await engine.importProducts(products); m.remove(); toast(`تمت إضافة ${n} منتج`, true); render(); }
      catch (e) { toast(errText(e)); }
    };
  }

  const csvCell = (v) => { // a leading = + - @ would run as a formula in Excel: prefix with an apostrophe
    let t = String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const actions = {
    add: () => productModal({ title: 'إضافة منتج', ok: 'إضافة', submit: async (v) => { const p = await engine.addProduct(v); toast(`تمت الإضافة برقم ${p.sku}`, true); } }),
    quick: () => productModal({ title: 'إدخال سريع', ok: 'إضافة وتالي (Enter)', again: true, submit: async (v) => { const p = await engine.addProduct(v); return `✔ ${p.sku} — ${p.produit}`; } }),
    import: () => $('#file').click(),
    paste: () => {
      const m = modal(`<h2>لصق من Excel</h2>
        <div class="hint">الأعمدة: المنتج · الشراء · البيع · الكمية</div>
        <textarea id="pt" rows="8" style="width:100%;background:var(--field);color:var(--txt);border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit" placeholder="الصق هنا"></textarea>
        <div class="btns"><button class="btn" data-c>إلغاء</button><button class="btn gold" data-ok>متابعة</button></div>`);
      m.querySelector('[data-c]').onclick = () => m.remove();
      m.querySelector('[data-ok]').onclick = () => { const t = m.querySelector('#pt').value; m.remove(); confirmImport(t); };
    },
    export: () => download('saly-products.csv', 'sku,produit,purchasePrice,salePrice,quantity\n' +
      all.map((p) => [p.sku, csvCell(p.produit), p.purchasePrice / 100, p.salePrice / 100, p.quantity].join(',')).join('\n')),
    tpl: () => download('saly-template.csv', 'produit,purchasePrice,salePrice,quantity\nمنتج تجريبي,5,8,10\n'),
  };
  root.querySelector('.tools').addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) actions[a](); });
  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (f) confirmImport(await f.text());
  });
  $('#rows').addEventListener('click', (e) => {
    const r = e.target.closest('.tr[data-sku]'); if (!r) return;
    const p = all.find((x) => String(x.sku) === r.dataset.sku);
    productModal({ title: `تعديل المنتج ${p.sku}`, p, submit: async (v) => { await engine.updateProduct(p.sku, v); toast('تم الحفظ', true); } });
  });
}
