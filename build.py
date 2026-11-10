#!/usr/bin/env python3
"""Builds standalone single-file pages (they open straight from a phone: no server, no imports)."""
import re, base64, os, sys, math, hashlib, glob   # standard library only: no pip install needed
R = os.path.dirname(os.path.abspath(__file__)); OUT = sys.argv[1] if len(sys.argv) > 1 else R   # output goes next to the sources (no sub-folders)
os.makedirs(OUT, exist_ok=True)
rd = lambda p: open(f'{R}/{p}', encoding='utf-8').read()
strip = lambda s: re.sub(r'^export (async function|function|const|class) ', r'\1 ', s, flags=re.M)

LOGO = 'data:image/png;base64,' + base64.b64encode(open(f'{R}/logo.png', 'rb').read()).decode()

def gear(cx=24, cy=24, ro=19, ri=15, n=8):
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n; w = math.pi / n * 0.5
        for ang, r in ((a - w, ri), (a - w * .6, ro), (a + w * .6, ro), (a + w, ri)):
            pts.append(f'{cx + r * math.cos(ang):.1f} {cy + r * math.sin(ang):.1f}')
    return 'M' + 'L'.join(pts) + 'Z'
# one icon family: 48-grid, gold gradient stroke, soft gold fill
ICONS = {
 'cart':   '<path d="M5 7h6l5 21h20l5-15H13"/><circle cx="19" cy="38" r="3"/><circle cx="33" cy="38" r="3"/>',
 'users':  '<circle cx="18" cy="16" r="6"/><path d="M6 39c0-7 5-12 12-12s12 5 12 12z"/><circle cx="35" cy="19" r="5"/><path d="M33 28c6 0 10 4 10 11h-8"/>',
 'truck':  '<path d="M3 13h24v20H3z"/><path d="M27 20h9l6 7v6H27z"/><circle cx="12" cy="36" r="4"/><circle cx="34" cy="36" r="4"/>',
 'box':    '<path d="M24 5l17 8v22l-17 8-17-8V13z"/><path d="M7 13l17 8 17-8M24 21v22"/>',
 'coins':  '<path d="M34 22V5m0 0l-6 6m6-6l6 6"/><path d="M6 30c0-2 6-4 13-4s13 2 13 4-6 4-13 4-13-2-13-4zM6 30v7c0 2 6 4 13 4s13-2 13-4v-7"/>',
 'undo':   '<path d="M16 11L6 21l10 10"/><path d="M6 21h22c7 0 12 5 12 12v5"/>',
 'redo':   '<path d="M32 11l10 10-10 10"/><path d="M42 21H20c-7 0-12 5-12 12v5"/>',
 'cash':   '<path d="M14 5h20v11H14z"/><path d="M8 20h32l3 18H5z"/><path d="M5 38h38v5H5z"/><path d="M15 27h2M23 27h2M31 27h2M15 32h2M23 32h2M31 32h2"/>',
 'stock':  '<path d="M4 19L24 6l20 13v23H4z"/><path d="M15 42V28h18v14M15 35h18"/>',
 'invoice':'<path d="M11 4h19l8 8v32H11z"/><path d="M30 4v8h8M17 21h14M17 28h14"/><path d="M17 37l4 4 9-9"/>',
 'gear':   f'<path d="{gear()}"/><circle cx="24" cy="24" r="6"/>',
}
def icon(name, size=52):
    return (f'<svg viewBox="0 0 48 48" width="{size}" height="{size}" fill="rgba(246,185,43,.16)" stroke="url(#gd)" '
            f'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')
def btn(ic, ar, en, href=None):
    inner = f'<span class="ic">{icon(ic)}</span><span><b>{ar}</b><small>{en}</small></span>'
    return f'<a class="hbtn" href="{href}">{inner}</a>' if href else f'<button class="hbtn" data-soon>{inner}</button>'
HOME_BODY = ('<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="gd" x1="0" y1="0" x2="1" y2="1">'
  '<stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#f6b92b"/></linearGradient></defs></svg>'
  f'<a class="hero" href="saly-sale.html"><span class="tile">{icon("cart", 56)}</span><span><b>بيع</b><small>سريع أو حسب الطلب</small></span><span class="chev">›</span></a>'
  '<div class="grid">' + ''.join([
    btn('truck', 'مستحقات الموردين', 'Suppliers Receivables', 'saly-receivables.html'), btn('users', 'ديون الزبناء', 'Customers Debts', 'saly-debts.html'),
    btn('coins', 'مصاريف', 'Expenses', 'saly-expenses.html'),                         btn('box', 'شراء', 'Purchases', 'saly-purchase.html'),
    btn('redo', 'ارجاع للمورد', 'Supplier Returns', 'saly-sreturns.html'),            btn('undo', 'ارجاع من زبون', 'Customer Returns', 'saly-creturns.html'),
    btn('stock', 'المخزون', 'Inventory', 'saly-stock.html'),     btn('cash', 'الصندوق', 'Cash Register', 'saly-cash.html'),
    btn('gear', 'الإدارة', 'Administration', 'saly-admin.html'), btn('invoice', 'الفواتير', 'Invoices', 'saly-invoices.html'),
  ]) + '</div><div class="foot">أول خطوة للنجاح · saly</div>')

HEAD_STD = '<header><img src="%(logo)s" alt="saly"><h1 id="title"></h1><button class="back" id="back">العودة →</button></header>'
HEAD_HOME = '<header class="home-hd"><img src="%(logo)s" alt="saly"><div class="ht"><div id="store"></div><div id="sub"></div></div></header>'
TPL = '''<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>saly</title><style>%(css)s</style></head><body>
<div id="app">
%(header)s
%(body)s
</div><div id="toast"></div>
<script type="module">
%(js)s
</script></body></html>
'''
# version = short hash of every source file (shown in Settings; the same sources always give the same version)
_src = sorted(f for f in glob.glob(f'{R}/*') if f.endswith(('.js', '.css', '.png', '.webmanifest')) or f.endswith('.body.html'))
_src = [f for f in _src if os.path.basename(f) != 'sw.js']
VERSION = hashlib.sha1(b''.join(os.path.basename(f).encode() + open(f, 'rb').read() for f in _src)).hexdigest()[:7]
core_js = f"const SALY_VERSION = '{VERSION}';\n" + strip(rd('saly-db.js')) + '\n' + rd('saly-ui.js')
T, S = 'saly-theme.css', None
PAGES = {
  'saly-home.html':  dict(css=[T, 'home.css'],  body=HOME_BODY, head=HEAD_HOME, js=[rd('home.js')]),
  'saly-sale.html':  dict(css=[T, 'sale.css'],  body=rd('sale.body.html'), js=[rd('saly-invoice.js'), rd('saly-pdf.js'), rd('sale.js')]),
  'saly-invoices.html': dict(css=[T, 'invoices.css'], body='<div id="view"></div>', js=[rd('saly-invoice.js'), rd('saly-pdf.js'), rd('saly-invoices.js'), rd('staff-invoices.js')]),
  'saly-purchase.html': dict(css=[T, 'purchase.css'], body=rd('purchase.body.html'), js=[rd('purchase.js')]),
  'saly-debts.html': dict(css=[T, 'parties.css'], body='<div id="view"></div>', js=[rd('saly-invoice.js'), rd('saly-parties.js'), rd('party-page.js').replace('__KIND__', 'debts')]),
  'saly-receivables.html': dict(css=[T, 'parties.css'], body='<div id="view"></div>', js=[rd('saly-invoice.js'), rd('saly-parties.js'), rd('party-page.js').replace('__KIND__', 'receivables')]),
  'saly-cash.html': dict(css=[T, 'cash.css'], body='<div id="view"></div>', js=[rd('saly-cash.js'), rd('staff-cash.js')]),
  'saly-expenses.html': dict(css=[T, 'cash.css'], body='<div id="view"></div>', js=[rd('saly-invoice.js'), rd('saly-expenses.js'), rd('page-expenses.js')]),
  'saly-creturns.html': dict(css=[T, 'parties.css', 'returns.css'], body='<div id="view"></div>', js=[rd('saly-invoice.js'), rd('saly-pdf.js'), rd('saly-returns.js'), rd('page-returns.js').replace('__KIND__', 'CUSTOMER')]),
  'saly-sreturns.html': dict(css=[T, 'parties.css', 'returns.css'], body='<div id="view"></div>', js=[rd('saly-invoice.js'), rd('saly-pdf.js'), rd('saly-returns.js'), rd('page-returns.js').replace('__KIND__', 'SUPPLIER')]),
  'saly-stock.html': dict(css=[T, 'stock.css'], body='<div id="view"></div>', js=[rd('saly-stock.js'), rd('staff-stock.js')]),
  'saly-admin.html': dict(css=[T, 'stock.css', 'cash.css'], body='<div id="view"></div>', js=[rd('saly-invoice.js'), rd('saly-pdf.js'), rd('saly-stock.js'), rd('saly-cash.js'), rd('admin.js')]),
}
for name, p in PAGES.items():
    html = TPL % dict(css='\n'.join(rd(c) for c in p['css']), header=(p.get('head') or HEAD_STD) % dict(logo=LOGO),
                      body=p['body'], js=core_js + '\n' + '\n'.join(p['js']))
    open(f'{OUT}/{name}', 'w', encoding='utf-8').write(html)
    open(f'/tmp/{name}.mjs', 'w', encoding='utf-8').write(re.search(r'<script type="module">(.*)</script>', html, re.S).group(1))
    print(name, len(html))

# ───── single-file bundle: one HTML that holds every screen (works from a phone, no folder needed)
import json
NAV = '<script>document.addEventListener("click",function(e){var a=e.target.closest("[data-nav]");if(a){e.preventDefault();parent.__nav(a.dataset.nav);}});</script>'
pages = {}
for name in PAGES:
    h = open(f'{OUT}/{name}', encoding='utf-8').read()
    h = re.sub(r'href="saly-(\w+)\.html"', r'href="#" data-nav="\1"', h)
    h = h.replace('history.back()', '(parent.__back ? parent.__back() : history.back())')
    pages[name[5:-5]] = h.replace('</head>', NAV + '</head>', 1)
payload = json.dumps(pages, ensure_ascii=False).replace('</', '<\\/').replace('<!--', '<\\u0021--')
SHELL = '''<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>saly</title>
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#040a1f">
<link rel="icon" type="image/png" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="saly">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>html,body{margin:0;height:100%%;background:#040a1f}iframe{position:fixed;inset:0;width:100%%;height:100%%;border:0}</style></head>
<body><iframe id="f" title="saly" allow="web-share"></iframe>
<script>
const PAGES = %s;
const stack = ['home'];
let canPush = true;
const cur = () => stack[stack.length - 1];
const show = (n) => { document.getElementById('f').srcdoc = PAGES[n]; if (n === 'home') setTimeout(applyUpdate, 0); };
let updatePending = false;
const notice = (t) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;top:14px;left:50%%;transform:translateX(-50%%);z-index:9;background:#0b1a52;color:#ffe08a;border:1px solid #f6b92b;border-radius:14px;padding:10px 18px;font:600 15px system-ui,sans-serif;box-shadow:0 0 14px rgba(47,107,255,.6)'; document.body.append(d); setTimeout(() => d.remove(), 3500); };
// a new version is applied only on the home screen, so a sale in progress is never interrupted
const applyUpdate = () => {
  if (!updatePending || cur() !== 'home') return;
  try { sessionStorage.setItem('saly-updated', '1'); } catch (e) {}
  location.reload();
};
window.__nav = (n) => { stack.push(n); try { history.pushState(null, ''); } catch (e) { canPush = false; } show(n); };
window.__back = () => { if (stack.length < 2) return; if (canPush) history.back(); else { stack.pop(); show(cur()); } };
addEventListener('popstate', () => { if (stack.length > 1) { stack.pop(); show(cur()); } });
show('home');
try { if (sessionStorage.getItem('saly-updated')) { sessionStorage.removeItem('saly-updated'); notice('تم تحديث البرنامج ✔'); } } catch (e) {}
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  let hadController = !!navigator.serviceWorker.controller; // the very first install is not an update
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController) { hadController = true; return; } updatePending = true; applyUpdate(); });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const check = () => reg.update().catch(() => {});
    setInterval(check, 3600000);                                  // look for a new version every hour
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { check(); applyUpdate(); } }); // and when the app comes back to the front
  }).catch(() => {});
}
</script></body></html>
''' % payload
open(f'{OUT}/saly-app.html', 'w', encoding='utf-8').write(SHELL)
print('saly-app.html', len(SHELL))
# index.html = the same single-file bundle under the name web hosts and browsers look for
open(f'{OUT}/index.html', 'w', encoding='utf-8').write(SHELL)

# sw.js: caches the app so it opens offline. The cache name carries a hash of index.html, so a new build
# produces a new sw.js, the browser installs it, and the next launch runs the new version.
SW = """/* saly service worker (generated by build.py) */
const CACHE = 'saly-%s';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.match(r, { ignoreSearch: true }).then((hit) => hit || fetch(r).catch(() => Response.error())));
});
""" % hashlib.sha1(SHELL.encode('utf-8')).hexdigest()[:10]
open(f'{OUT}/sw.js', 'w', encoding='utf-8').write(SW)
print('sw.js', len(SW))
