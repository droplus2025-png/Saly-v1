setTitle('مصاريف');
try { const { read, engine } = await boot(); await mountExpenses({ read, engine, root: $('#view') }); } catch { /* error already shown */ }
