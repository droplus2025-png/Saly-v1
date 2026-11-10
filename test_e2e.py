#!/usr/bin/env python3
"""End-to-end regression suite (Playwright + Chromium) for the bundled app.
Usage: python3 build.py && python3 test_e2e.py [saly-app.html]"""
import asyncio, json, os, sys, urllib.parse
from playwright.async_api import async_playwright

APP = 'file://' + os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saly-app.html'))
CASH = "() => new Promise(r => { const q = indexedDB.open('saly'); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('cashBalance'); g.onsuccess = () => r((g.result?.value ?? 0) / 100); }; })"
fails = []
def ok(cond, msg):
    print(('  ✔ ' if cond else '  ✘ ') + msg)
    if not cond: fails.append(msg)

class App:
    def __init__(self, pg): self.pg, self.f = pg, pg.frame_locator('#f')
    async def nav(self, n): await self.pg.evaluate(f"window.__nav('{n}')"); await self.pg.wait_for_timeout(450)
    async def frame(self): return await (await self.pg.query_selector('#f')).content_frame()
    async def cash(self): return await (await self.frame()).evaluate(CASH)
    async def text(self, sel): return (await self.f.locator(sel).inner_text()).replace('\n', ' | ')
    async def wait(self, ms=300): await self.pg.wait_for_timeout(ms)
    async def toast(self): return await self.f.locator('#toast').inner_text()
    async def admin(self, pin='1234', first=False):
        await self.nav('admin')
        await self.f.locator('#p1').fill(pin)
        if first: await self.f.locator('#p2').fill(pin)
        await self.f.locator('#go').click(); await self.wait()
    async def add_product(self, name, buy, sell, qty):
        await self.f.locator('[data-a=add]').click(); await self.f.locator('#f1').fill(name); await self.f.locator('#f2').fill(buy)
        await self.f.locator('#f3').fill(sell); await self.f.locator('#f4').fill(qty); await self.f.locator('.ov [data-ok]').click(); await self.wait()
    async def sell(self, sku, qty, paid, name=None, phone=None, price=None, confirm_loss=False):
        await self.nav('sale'); f = self.f
        await f.locator('#q').fill(str(sku)); await self.wait(150); await f.locator(f'.res[data-sku="{sku}"]').click()
        await f.locator('.line input[data-f=qty]').fill(str(qty))
        if price is not None: await f.locator('.line input[data-f=price]').fill(str(price))
        await f.locator('#pay').click(); await self.wait(150)
        if confirm_loss: await f.locator('[data-yes]').click()
        await f.locator('#pd').fill(str(paid))
        if name: await f.locator('#pn').fill(name); await f.locator('#pp').fill(phone)
        await f.locator('.ov [data-ok]').click(); await self.wait(450)
        return await self.text('.box')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 412, 'height': 900}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(APP); await pg.wait_for_timeout(600); a = App(pg); f = a.f

        print('· admin gate, keyboard handling')
        await a.admin(first=True)
        await f.locator('[data-go=stock]').click(); await a.wait()
        await f.locator('#q').press('Enter'); await a.wait(200)
        ok(await f.locator('#rows').count() == 1, 'Enter in the stock search does not leave the screen')
        await f.locator('#back').click(); await f.locator('[data-go=settings]').click(); await a.wait()
        await f.locator('[data-k=storeName]').fill('متجر الاختبار'); await f.locator('[data-k=storeName]').press('Enter'); await a.wait(200)
        ok(await f.locator('#save').count() == 1, 'Enter in a settings field does not trigger the PIN gate')
        await f.locator('[data-k=phone]').fill('0661000000'); await f.locator('#save').click(); await a.wait()
        await f.locator('#back').click()

        print('· admin gate re-entry (regression: stacked Enter handlers)')
        await a.admin(); await f.locator('[data-go=stock]').click(); await a.wait(); await f.locator('#q').press('Enter'); await a.wait(200)
        ok(await f.locator('.tools').count() == 1, 'after a second login, Enter in a screen does not jump back to the menu')
        await f.locator('#back').click(); await a.wait(300)
        print('· stock')
        await f.locator('[data-go=stock]').click(); await a.wait()
        await a.add_product('مطرقة', '4', '10', '20')
        await a.add_product('=cmd|calc', '1', '2', '5')
        ok('1' in await a.text('#rows') and 'مطرقة' in await a.text('#rows'), 'product 1 created with the first free number')
        await f.locator('[data-a=add]').click(); await f.locator('#f0').fill('1'); await a.wait(100)
        ok('مستعمل' in await a.text('#fh'), 'typing a used number shows the matching product with a warning'); await f.locator('.ov [data-c]').click()
        async with pg.expect_download() as dl: await f.locator('[data-a=export]').click()
        await (await dl.value).save_as('/tmp/e2e_products.csv'); csv = open('/tmp/e2e_products.csv', encoding='utf-8-sig').read()
        ok("'=cmd|calc" in csv, 'CSV export neutralises formula injection')
        await f.locator('#back').click(); await f.locator('[data-go=cash]').click(); await a.wait(200)
        await f.locator('[data-op=deposit]').click(); await f.locator('#oa').fill('100'); await f.locator('.ov [data-ok]').click(); await a.wait()
        ok(await a.cash() == 100, 'deposit 100 → cash 100')

        print('· sale')
        r = await a.sell(1, 3, 30); ok('الباقي: 0' in r and await a.cash() == 130, 'cash sale 3×10 → cash 130')
        async with pg.expect_download() as dl: await f.locator('[data-send]').click()
        await (await dl.value).save_as('/tmp/e2e_invoice.pdf')
        ok(open('/tmp/e2e_invoice.pdf', 'rb').read(5) == b'%PDF-' and os.path.getsize('/tmp/e2e_invoice.pdf') > 20000, 'the sale invoice is sent as a real PDF (one tap)')
        await f.locator('[data-new]').click()
        r = await a.sell(1, 5, 10, 'علي', '0612345678'); ok('دين: 40' in r, 'credit sale 5×10 paid 10 → debt 40'); ok(await a.cash() == 140, 'cash +10')
        await f.locator('[data-new]').click()
        await a.nav('sale'); await f.locator('#q').fill('1'); await a.wait(150); await f.locator('.res[data-sku="1"]').click(); await f.locator('.line input[data-f=qty]').fill('999'); await f.locator('#pay').click(); await f.locator('#pd').fill('99999'); await f.locator('.ov [data-ok]').click(); await a.wait(300)
        ok('غير كافية' in await a.toast(), 'selling more than the stock is refused')
        r = await a.sell(1, 1, 3, price=3, confirm_loss=True); ok('تم حفظ' in r, 'loss sale needs confirmation, then saves'); await f.locator('[data-new]').click()
        await a.nav('sale'); await f.locator('#q').fill('1'); await a.wait(150); await f.locator('.res[data-sku="1"]').click(); await f.locator('.line input[data-f=price]').fill('1'); await f.locator('#pay').click(); await a.wait(150); await f.locator('[data-no]').click(); await a.wait(100)
        ok(await f.locator('#pd').count() == 0, 'cancelling the loss warning stops the payment')
        await f.locator('.line [data-act=del]').click()

        print('· debts & reminder')
        await a.nav('debts'); await (await a.frame()).evaluate("window.open = (u) => { window.__o = u; }")
        await f.locator('.pi [data-wa]').click(); await a.wait(200)
        u = await (await a.frame()).evaluate('window.__o'); ok('wa.me/212612345678' in u and '40' in urllib.parse.unquote(u), 'reminder link has the number and the amount')
        ok('آخر تذكير' in await a.text('#pl'), 'last reminder date is shown')
        await f.locator('.pi').click(); await f.locator('#pa').fill('99'); ok(await f.locator('.ov [data-ok]').is_disabled(), 'collecting more than the debt is blocked')
        await f.locator('#pa').fill('15'); await f.locator('.ov [data-ok]').click(); await a.wait(); ok(await a.cash() == 158, 'collect 15 → cash 158 (after the +3 loss sale)')

        print('· purchase')
        await a.nav('purchase'); await f.locator('#sn').fill('شركة الأمل'); await f.locator('#sp').fill('٠٦٦١٢٣٤٥٦٧')  # Arabic-Indic digits
        for sel, v in (('#fSku', '1'), ('#fQty', '10'), ('#fBuy', '5'), ('#fSell', '12')): await f.locator(sel).fill(v)
        await f.locator('#fSell').press('Enter'); await a.wait(150); ok(await f.locator('.pr').count() == 1, 'Enter on the last field adds the line')
        await f.locator('#fName').fill('مقص'); await f.locator('#fQty').fill('2'); await f.locator('#fBuy').fill('7'); await f.locator('#fSell').fill('15'); await f.locator('#addBtn').click()
        await f.locator('#fSku').fill('3'); await f.locator('#fName').fill('مقص'); await f.locator('#fQty').fill('1'); await f.locator('#fBuy').fill('1'); await f.locator('#fSell').fill('1'); await f.locator('#addBtn').click()
        ok('موجود' in await a.toast(), 'a duplicate product name is refused')
        await f.locator('#pay').click(); await f.locator('#pd').fill('999'); ok(await f.locator('.ov [data-ok]').is_disabled(), 'paying more than the invoice is blocked')
        await f.locator('#pd').fill('30'); await f.locator('.ov [data-ok]').click(); await a.wait(500); ok(await a.cash() == 128, 'purchase 64 paid 30 → cash 128')

        print('· returns')
        await a.nav('creturns'); await f.locator('#q').fill('علي'); await a.wait(200); await f.locator('.pi').first.click(); await f.locator('.rq').first.fill('9'); ok(await f.locator('.ov [data-ok]').is_disabled(), 'return above the sold quantity is blocked')
        await f.locator('.rq').first.fill('5'); await f.locator('.ov [data-ok]').click(); await a.wait(450); await f.locator('.ov [data-ok]').click()
        ok(await a.cash() == 103, 'customer return 50: open debt 25 cut first, 25 paid back in cash → 103'); await a.nav('debts'); ok('لا ديون' in await a.text('#pl'), 'customer debt cleared')
        await a.nav('sreturns'); await f.locator('.pi').first.click(); await f.locator('.rq').first.fill('4'); await f.locator('.ov [data-ok]').click(); await a.wait(450); await f.locator('.ov [data-ok]').click()
        await a.nav('receivables'); ok('14' in await a.text('#pl'), 'supplier return reduces the supplier debt (34 − 20)')
        await a.nav('invoices'); ok('معدلة' in await a.text('#ivl'), 'returned invoices are marked «معدلة»')

        print('· expenses & cash closing')
        await a.nav('expenses'); await f.locator('#esave').click(); ok('أدخل' in await a.toast(), 'expense needs an amount and a description')
        await f.locator('#ea').fill('15'); await f.locator('#en').fill('كراء'); await f.locator('#en').press('Enter'); await a.wait(); ok(await a.cash() == 88, 'expense 15 → cash 88')
        await a.nav('cash'); ok('88' not in await a.text('#view'), 'the employee never sees the expected balance')
        await f.locator('#cc').fill('100'); await f.locator('#close').click(); await f.locator('.ov [data-ok]').click(); await a.wait(); await f.locator('.ov [data-ok]').click(); await a.wait()
        ok(await a.cash() == 100, 'closing count 100 → balance becomes 100 (overage +12 recorded)')
        await a.admin(); await f.locator('[data-go=cash]').click(); await a.wait(); ok('زيادة 12' in await a.text('.alert'), 'owner sees the overage alert')

        print('· backup / restore')
        await a.admin(); await f.locator('[data-go=settings]').click(); await a.wait(200)
        async with pg.expect_download() as dl: await f.locator('#bsave').click()
        await (await dl.value).save_as('/tmp/e2e_backup.json'); bk = json.load(open('/tmp/e2e_backup.json'))
        ok(bk['format'] == 'saly-backup' and len(bk['data']['products']) == 3, 'backup file holds the products')
        await f.locator('#rst').click(); await f.locator('#rp').fill('1234'); await f.locator('.ov [data-ok]').click(); await a.wait(400)
        ok(await a.cash() == 0, 'reset zeroes the cash box'); await f.locator('#back').click(); await f.locator('[data-go=stock]').click(); await a.wait(); ok(await f.locator('.tr').count() == 3, 'reset keeps the inventory')
        await a.admin(); await f.locator('[data-go=settings]').click(); await a.wait(200)
        await f.locator('input#bfile').set_input_files('/tmp/e2e_backup.json'); await a.wait(300); await f.locator('#rp2').fill('1234'); await f.locator('.ov [data-ok]').click(); await a.wait(500)
        ok(await f.locator('#go').count() == 1, 'after a restore the PIN gate is shown')
        await f.locator('#p1').fill('0000'); await f.locator('#p1').press('Enter'); await a.wait(300)
        ok(await f.locator('#go').count() == 1, 'a wrong PIN + Enter on the re-shown gate is rejected (no stale handler)')
        await f.locator('#p1').fill('1234'); await f.locator('#p1').press('Enter'); await a.wait(300)
        ok(await f.locator('[data-go=stock]').count() == 1, 'the right PIN + Enter opens the menu')
        ok(await a.cash() == 100, 'restore brings the cash box back')
        print('ERRORS' if errs else 'no page errors', errs)
        await b.close()
    print('\nFAILED: %d' % len(fails) if fails else '\nALL PASSED'); sys.exit(1 if fails else 0)
asyncio.run(main())
