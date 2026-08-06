'use strict';
/**
 * Helpers compartilhados pelas 4 paginas: fetch wrapper com cookie de
 * sessao, redireciona para /login.html em 401, toast(), $()/$all().
 */
(function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var toastTimer = null;
  function toast(msg, kind) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
  }

  function isLoginPage() {
    return /\/login\.html$/.test(location.pathname) || location.pathname === '/login';
  }

  function api(method, path, body) {
    var opts = { method: method, credentials: 'include', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (r) {
      if (r.status === 401 && path.indexOf('/api/auth/login') === -1 && !isLoginPage()) {
        location.href = '/login.html';
        throw new Error('Sessao expirada.');
      }
      return r.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
        if (!r.ok) {
          var msg = (data && data.error) || ('Erro ' + r.status);
          var err = new Error(msg);
          err.status = r.status;
          err.body = data;
          throw err;
        }
        return data;
      });
    });
  }

  function apiText(method, path) {
    return fetch(path, { method: method, credentials: 'include' }).then(function (r) {
      if (r.status === 401 && !isLoginPage()) { location.href = '/login.html'; throw new Error('Sessao expirada.'); }
      return r.text().then(function (text) {
        if (!r.ok) throw new Error('Erro ' + r.status);
        return text;
      });
    });
  }

  function baixarArquivo(nome, conteudo, mime) {
    var blob = new Blob([conteudo], { type: (mime || 'text/csv') + ';charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function mesAtualInput() {
    return window.Calc ? window.Calc.mesAtual() : new Date().toISOString().slice(0, 7);
  }

  function openModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('show');
  }
  function closeModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('show');
  }

  window.App = {
    $: $, $all: $all, toast: toast, debounce: debounce, baixarArquivo: baixarArquivo, mesAtualInput: mesAtualInput,
    openModal: openModal, closeModal: closeModal,
    get: function (path) { return api('GET', path); },
    post: function (path, body) { return api('POST', path, body); },
    patch: function (path, body) { return api('PATCH', path, body); },
    del: function (path) { return api('DELETE', path); },
    getText: function (path) { return apiText('GET', path); }
  };
})();
