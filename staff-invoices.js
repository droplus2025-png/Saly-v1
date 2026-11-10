/* Invoice archive (read-only) */
setTitle('الفواتير');
try { const { read } = await boot(); await mountInvoices({ read, root: $('#view') }); } catch { /* error already shown */ }
