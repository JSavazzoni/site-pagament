'use strict';

fetch('/api/auth/me', { credentials: 'include' }).then(function (r) {
  if (!r.ok) { location.replace('/login'); return null; }
  return r.json();
}).then(function (data) {
  if (!data) return;
  location.replace(data.user.role === 'cco' ? '/painel' : '/setor');
}).catch(function () { location.replace('/login'); });
