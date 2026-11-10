# saly — offline-first POS & business manager

Arabic (RTL) mobile-first web app. Pure HTML/CSS/JS, no server, no dependencies at runtime.
Data lives in the browser's IndexedDB. Everything is built into single-file pages (and one bundle) so it opens from a phone.

## Files (all in one folder, no sub-folders)
```
saly-db.js          Atomic engine + read-only API (the ONLY code that writes data)
saly-ui.js          Shared helpers (formatting, modal, toast, header, boot)
saly-invoice.js     Operation names, invoice details (screen rows), debt reminder
saly-pdf.js         The PDF invoice: design, PDF writer, one-tap sharing, logo + accent colour
saly-theme.css      Palette (royal blue + gold) and shared components
saly-stock.js  saly-parties.js  saly-cash.js  saly-invoices.js  saly-returns.js  saly-expenses.js   Screen logic
sale.* purchase.* home.* admin.js staff-*.js page-*.js party-page.js *.css   One small file per screen (+ its CSS)
logo.png            Logo embedded in the screen headers
icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png   App icons (static)
manifest.webmanifest   Install information (name, icons, colours)
build.py            Builds saly-<page>.html, saly-app.html, index.html (all screens in one file) and sw.js (offline cache), next to the sources. Standard library only
test_e2e.py         End-to-end regression suite (Playwright + Chromium)
```

## The invoice (PDF)
`saly-pdf.js` draws every invoice/receipt on a canvas (the browser's own Arabic shaping and fonts) and packs it into a PDF
(A4 for invoices — several pages when long — and a shorter sheet for receipts). Colours follow the shop logo uploaded in
Settings (accent picked automatically, royal blue/gold when there is no logo). One tap on «إرسال الفاتورة PDF» opens the
phone's share sheet (WhatsApp); where sharing files is unsupported (desktop) the PDF is downloaded and the customer's
WhatsApp chat opens. There is no text invoice any more; only the debt reminder is still a text message.

## Rules the code follows
- **UI is read-only.** Screens call `read.*` to display and `engine.*` to ask for a change. The engine decides
  (e.g. CASH vs DEBT from paid vs total), and every operation is ONE IndexedDB transaction (all or nothing).
- **Money = integer minor units** (cents). The UI converts with `num()` / `fmt()`.
- **Invoices are never edited.** A return is a new numbered operation linked by `refId`; the archive marks the original «معدلة».
- **One invoice sequence** for all operations: `MMDDooo` (month, day, 3-digit daily order), assigned by the engine.
- The cash box may go negative; the employee never sees the expected balance (blind closing count).

## Build & test
```
# build.py needs only Python 3. The tests also need:  pip install playwright && playwright install chromium
python3 build.py                 # → saly-*.html, saly-app.html and index.html in this same folder
python3 test_e2e.py              # runs against saly-app.html
```

## Publishing (e.g. GitHub Pages) — upload these files, in the SAME folder
`index.html`, `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`.
Open the https link on the phone: Chrome → menu → *Install app*; iPhone Safari → Share → *Add to Home Screen*.
After every new build upload the new `index.html` AND `sw.js` together; the app updates on its next launch.

## Automatic updates
- Every build writes `sw.js` with a name that changes when the code changes. Installed apps check for it every hour and
  whenever they come back to the front. The new version is applied **only when the user is on the home screen** (never in
  the middle of a sale) and a short notice «تم تحديث البرنامج» appears. Data is not touched by an update.
- Settings shows the version (a short hash of the sources).
- **Data migrations:** if you ever change the SHAPE of stored data (new field, rename, new default), append a function to
  `MIGRATIONS` in `saly-db.js`. It runs once per device at the next launch. Never edit an old migration.
- **Publishing without manual uploads:** `.github/workflows/deploy.yml` builds and publishes on every push to `main`.
  One-time setup: repository → Settings → Pages → Source: *GitHub Actions*. (GitHub requires this file to live in that path.)

## Known limits
- The admin PIN is a UI lock (hashed, stored locally) — not a security boundary.
- Sync hooks exist (`outbox`, `_sync` stamps, `applyRemoteChanges`) but no server is connected; they are untested.
- Data is per browser/device: use Settings → Backup regularly.
