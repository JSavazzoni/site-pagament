'use strict';
/**
 * Helpers compartilhados pelas 4 paginas: fetch wrapper com cookie de sessao,
 * redireciona para /login em 401, toast(), $()/$all(), menus suspensos,
 * modal de confirmacao, navegador de mes e menu do usuario.
 */
(function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- icones ----------------
     SVG de traco, no lugar dos emoji: emoji muda de desenho a cada sistema,
     nao acompanha a cor do texto e desalinha com a linha de base. */

  var TRACOS = {
    chave:    '<path d="M15 7a4 4 0 1 1-3.9 5H8v2H6v2H3v-3l5.1-5.1A4 4 0 0 1 15 7Z"/><circle cx="16.5" cy="7.5" r=".6" fill="currentColor"/>',
    painel:   '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    sair:     '<path d="M15 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2"/><path d="M10 12h11m0 0-3-3m3 3-3 3"/>',
    engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z"/>',
    subir:    '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>',
    voltar:   '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4"/>',
    busca:    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    pessoa:   '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    predio:   '<path d="M4 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15"/><path d="M14 10h4a2 2 0 0 1 2 2v9"/><path d="M2 21h20M7 8h2M7 12h2M7 16h2"/>',
    prancheta:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6M9 15h4"/>',
    check:    '<path d="m4 12 5 5L20 6"/>',
    alerta:   '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4m0 3v.5"/>',
    duvida:   '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3"/><path d="M12 17v.5"/>',
    dado:     '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>',
    copiar:   '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    abrir:    '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
    olho:     '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    olhoCorte:'<path d="M3 3l18 18"/><path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7c1.6 0 3-.3 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    lixo:     '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1L18 7"/>',
    seta:     '<path d="m9 6 6 6-6 6"/>'
  };

  /**
   * Devolve o SVG do icone. Herda a cor do texto (currentColor) e escala com o
   * tamanho da fonte, entao encaixa em qualquer lugar sem ajuste.
   */
  function ico(nome, tamanho) {
    var d = TRACOS[nome];
    if (!d) return '';
    var s = tamanho || 16;
    return '<svg class="ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + '</svg>';
  }

  /** Troca por SVG todo elemento marcado com data-ico="nome". */
  function pintarIcones(raiz) {
    $all('[data-ico]', raiz).forEach(function (el) {
      if (el.dataset.icoFeito) return;
      el.dataset.icoFeito = '1';
      el.innerHTML = ico(el.dataset.ico, Number(el.dataset.icoTam) || 16) + el.innerHTML;
    });
  }

  /* ---------------- toast ---------------- */

  var toastTimer = null;
  function toast(msg, kind) {
    var el = $('#toast');
    if (!el) return;
    var marca = kind === 'ok' ? ico('check', 15) : kind === 'err' ? ico('alerta', 15) : '';
    el.innerHTML = marca + '<span>' + esc(msg) + '</span>';
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3400);
  }

  /* ---------------- API ---------------- */

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
        location.href = '/login';
        throw new Error('Sess\u00e3o expirada.');
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

  /* ---------------- modais ---------------- */

  var modalStack = [];

  function openModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add('show');
    modalStack.push(id);
    var first = el.querySelector('input:not([type=hidden]), select, textarea, button');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('show');
    modalStack = modalStack.filter(function (x) { return x !== id; });
  }

  // Esc fecha o modal do topo / os menus abertos; clique no fundo escuro tambem fecha.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (modalStack.length) { closeModal(modalStack[modalStack.length - 1]); return; }
    fecharMenus();
  });
  document.addEventListener('mousedown', function (e) {
    var back = e.target.classList && e.target.classList.contains('modal-backdrop') ? e.target : null;
    if (back && back.id) closeModal(back.id);
  });

  /**
   * Confirmacao com visual do app (o confirm() nativo e feio e trava a aba).
   * Uso: App.confirmar({ titulo, texto, ok, perigo }).then(function (sim) { ... })
   */
  function confirmar(opts) {
    var o = opts || {};
    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.className = 'modal-backdrop show';
      back.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<div class="modal-icon' + (o.perigo ? ' danger' : '') + '">' + ico(o.perigo ? 'alerta' : 'duvida', 20) + '</div>' +
          '<h3>' + esc(o.titulo || 'Confirmar') + '</h3>' +
          '<p class="hint" style="margin:6px 0 20px;">' + esc(o.texto || '') + '</p>' +
          '<div class="modal-actions">' +
            '<button class="btn" data-no type="button">' + esc(o.cancelar || 'Cancelar') + '</button>' +
            '<button class="btn ' + (o.perigo ? 'btn-danger' : 'btn-primary') + '" data-yes type="button">' + esc(o.ok || 'Confirmar') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(back);

      function fim(v) {
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); fim(false); }
        if (e.key === 'Enter') { e.stopPropagation(); fim(true); }
      }
      back.querySelector('[data-yes]').addEventListener('click', function () { fim(true); });
      back.querySelector('[data-no]').addEventListener('click', function () { fim(false); });
      back.addEventListener('mousedown', function (e) { if (e.target === back) fim(false); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { back.querySelector('[data-yes]').focus(); }, 30);
    });
  }

  /* ---------------- menus suspensos ---------------- */

  function fecharMenus(exceto) {
    $all('.menu.open').forEach(function (m) { if (m !== exceto) m.classList.remove('open'); });
  }

  // Delegacao global: qualquer <div class="menu"> com [data-menu-trigger] funciona
  // sozinho, sem cada pagina precisar religar eventos depois de re-renderizar.
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-menu-trigger]');
    if (trigger) {
      var menu = trigger.closest('.menu');
      var estavaAberto = menu.classList.contains('open');
      fecharMenus();
      if (!estavaAberto) menu.classList.add('open');
      e.stopPropagation();
      return;
    }
    var dentro = e.target.closest('.menu-panel');
    if (dentro) {
      // um item de menu sempre fecha o menu ao ser acionado
      if (e.target.closest('.menu-item')) fecharMenus();
      return;
    }
    fecharMenus();
  });

  /* ---------------- navegador de mes ---------------- */

  var MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Mar\u00e7o', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  function labelMes(comp) {
    var p = String(comp || '').split('-');
    if (p.length !== 2) return comp || '';
    var m = Number(p[1]) - 1;
    return (MESES_LONGOS[m] || '') + ' ' + p[0];
  }

  function somaMes(comp, delta) {
    var p = String(comp).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /**
   * Liga o widget <div class="month-nav"> a um callback.
   * Devolve { set(comp), get() } para a pagina controlar o valor.
   */
  function montarMonthNav(root, valorInicial, onChange) {
    var el = typeof root === 'string' ? $(root) : root;
    var atual = valorInicial;
    var input = $('input[type=month]', el);
    var label = $('.month-label span', el);

    function pintar() {
      label.textContent = labelMes(atual);
      input.value = atual;
    }
    function mudar(novo) {
      if (!novo || novo === atual) return;
      atual = novo;
      pintar();
      onChange(atual);
    }

    $('[data-mes-prev]', el).addEventListener('click', function () { mudar(somaMes(atual, -1)); });
    $('[data-mes-next]', el).addEventListener('click', function () { mudar(somaMes(atual, 1)); });
    input.addEventListener('change', function () { mudar(input.value); });
    pintar();

    // Alt + setas navega os meses de qualquer lugar da pagina -- mas nunca com o
    // foco dentro de um campo: trocar de mes ali dispara o change do campo com o
    // valor do mes que acabou de sair e sobrescreve a configuracao do outro mes.
    document.addEventListener('keydown', function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      var alvo = e.target;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); mudar(somaMes(atual, -1)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); mudar(somaMes(atual, 1)); }
    });

    return {
      get: function () { return atual; },
      set: function (v) { atual = v; pintar(); }
    };
  }

  /* ---------------- topbar do usuario ---------------- */

  function iniciais(nome) {
    var partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  /** Preenche avatar/nome/papel e liga trocar-senha + sair, iguais nas 3 paginas. */
  function montarUserMenu(user) {
    var av = $('#avatar');
    if (av) {
      av.textContent = iniciais(user.name);
      if (user.role === 'cco') av.classList.add('is-cco');
    }
    var nm = $('#user-name'); if (nm) nm.textContent = user.name;
    var rl = $('#user-role');
    if (rl) rl.textContent = user.role === 'cco' ? 'CCO' : 'Gestor' + (user.sectorName ? ' · ' + user.sectorName : '');

    var senha = $('#mi-senha');
    if (senha) senha.addEventListener('click', function () { openModal('modal-senha'); });

    var sair = $('#mi-sair');
    if (sair) {
      sair.addEventListener('click', function () {
        api('POST', '/api/auth/logout')
          .then(function () { location.href = '/login'; })
          .catch(function () { location.href = '/login'; });
      });
    }

    var cancelar = $('#btn-senha-cancelar');
    if (cancelar) cancelar.addEventListener('click', function () { closeModal('modal-senha'); });

    var form = $('#form-senha');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var errEl = $('#senha-error');
        errEl.textContent = '';
        api('POST', '/api/auth/change-password', {
          currentPassword: $('#senha-atual').value,
          newPassword: $('#senha-nova').value
        }).then(function () {
          closeModal('modal-senha');
          form.reset();
          toast('Senha alterada com sucesso.', 'ok');
        }).catch(function (er) { errEl.textContent = er.message; });
      });
    }
  }

  /** Liga todos os [data-pw-toggle] da pagina (botao de revelar senha). */
  function ligarPwToggles(root) {
    $all('[data-pw-toggle]', root).forEach(function (btn) {
      if (btn.dataset.ligado) return;
      btn.dataset.ligado = '1';
      btn.innerHTML = ico('olho', 16);
      btn.addEventListener('click', function () {
        var inp = $('#' + btn.getAttribute('data-pw-toggle'));
        if (!inp) return;
        var mostrar = inp.type === 'password';
        inp.type = mostrar ? 'text' : 'password';
        btn.innerHTML = ico(mostrar ? 'olhoCorte' : 'olho', 16);
        btn.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
        inp.focus();
      });
    });
  }

  /** Senha forte legivel, para a CCO nao precisar inventar uma na hora. */
  function gerarSenha(tam) {
    var abc = 'abcdefghijkmnopqrstuvwxyz';
    var ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    var num = '23456789';
    var todos = abc + ABC + num;
    var n = tam || 14;
    var bytes = new Uint32Array(n);
    crypto.getRandomValues(bytes);
    var out = [abc[bytes[0] % abc.length], ABC[bytes[1] % ABC.length], num[bytes[2] % num.length]];
    for (var i = 3; i < n; i++) out.push(todos[bytes[i] % todos.length]);
    // embaralha para os 3 obrigatorios nao ficarem sempre no comeco
    for (var j = out.length - 1; j > 0; j--) {
      var k = bytes[j] % (j + 1);
      var tmp = out[j]; out[j] = out[k]; out[k] = tmp;
    }
    return out.join('');
  }

  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto).then(function () { return true; }).catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  function tempoRelativo(iso) {
    var seg = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seg < 60) return 'agora';
    if (seg < 3600) return 'h\u00e1 ' + Math.round(seg / 60) + ' min';
    if (seg < 86400) return 'h\u00e1 ' + Math.round(seg / 3600) + 'h';
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  window.App = {
    $: $, $all: $all, esc: esc, toast: toast, debounce: debounce, mesAtualInput: mesAtualInput,
    openModal: openModal, closeModal: closeModal, confirmar: confirmar,
    montarMonthNav: montarMonthNav, labelMes: labelMes, somaMes: somaMes,
    montarUserMenu: montarUserMenu, ligarPwToggles: ligarPwToggles,
    gerarSenha: gerarSenha, copiar: copiar, iniciais: iniciais, tempoRelativo: tempoRelativo,
    fecharMenus: fecharMenus, ico: ico, pintarIcones: pintarIcones,
    get: function (path) { return api('GET', path); },
    post: function (path, body) { return api('POST', path, body); },
    patch: function (path, body) { return api('PATCH', path, body); },
    del: function (path) { return api('DELETE', path); }
  };
})();
