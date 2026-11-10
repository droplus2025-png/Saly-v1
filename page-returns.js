const KIND = '__KIND__';
setTitle(KIND === 'CUSTOMER' ? 'ارجاع من زبون' : 'ارجاع للمورد');
try { const { read, engine } = await boot(); await mountReturns({ read, engine, kind: KIND, root: $('#view') }); } catch { /* error already shown */ }
