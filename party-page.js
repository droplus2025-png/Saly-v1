/* customer debts / supplier receivables: layout and flow are shared, only the kind differs */
const KIND = '__KIND__';
setTitle(KIND === 'debts' ? 'ديون الزبناء' : 'مستحقات الموردين');
try { const { read, engine } = await boot(); mountParties({ read, engine, kind: KIND, root: $('#view') }); } catch { /* error already shown */ }
