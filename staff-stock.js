/* Employee inventory: view + search only (no engine writes are even wired in) */
setTitle('المخزون');
try { const { read } = await boot(); mountStock({ read, admin: false, root: $('#view') }); } catch { /* error already shown */ }
