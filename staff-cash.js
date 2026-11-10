/* Employee cash screen: blind closing count only */
setTitle('الصندوق');
try { const { read, engine } = await boot(); await mountCashStaff({ read, engine, root: $('#view') }); } catch { /* error already shown */ }
