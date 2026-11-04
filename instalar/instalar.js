'use strict';

/* ============================================================
   /instalar — autoinstalación de SuscripFy
   Paso 1: verificar tienda   → POST /api/install/check
   Paso 2: correo + código    → POST /api/install/request, POST /api/install/verify
   Paso 3: estado             → GET  /api/install/status?t=... (cada 30 s con la pestaña visible)
   ============================================================ */
(function () {
  var CONTACT_EMAIL = 'comercial@suscripfy.co';
  var TOKEN_RX = /^[A-Za-z0-9_-]{20,128}$/;
  var EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var STORAGE_KEY = 'sf_install_token';
  var POLL_MS = 30000;
  var INSTALL_LINK_PREFIX = 'https://admin.shopify.com/';
  var CATEGORY_BLOCKED_TEXT = 'Por acuerdos comerciales vigentes, SuscripFy no está disponible para tiendas de suplementación nutricional (proteínas, colágenos y similares). Para cualquier otro tipo de negocio estamos listos.';
  var ALMOST_READY_TEXT = 'Tu app está casi lista. Te enviaremos el link de instalación a tu correo en menos de 24 horas hábiles. Mientras tanto, ten lista tu cuenta de Wompi activa, con tus llaves de producción y de prueba (sandbox).';

  var ICONS = {
    ok: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    fail: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    skip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    clock: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    link: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    check: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    search: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  };

  function $(id) { return document.getElementById(id); }
  function show(el, on) { if (el) el.hidden = !on; }

  function storageGet() { try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; } }
  function storageSet(v) { try { if (v) localStorage.setItem(STORAGE_KEY, v); else localStorage.removeItem(STORAGE_KEY); } catch (e) { /* modo privado */ } }

  function statusUrl(token) { return location.origin + '/instalar/estado?t=' + encodeURIComponent(token); }

  function api(method, url, body) {
    var opts = { method: method, headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        return { status: r.status, data: data || {} };
      });
    }, function () {
      return { status: 0, data: { error: 'network' } };
    });
  }

  function setLoading(btn, on, text) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.dataset.label || btn.innerHTML;
      btn.classList.add('is-loading');
      btn.disabled = true;
      btn.textContent = text || 'Un momento...';
    } else {
      btn.classList.remove('is-loading');
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  }

  function setError(el, msg, input) {
    if (!el) return;
    el.textContent = msg || '';
    show(el, !!msg);
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function genericError(status, data) {
    if (status === 429) return 'Hiciste varios intentos seguidos. Espera unos minutos y vuelve a intentarlo.';
    if (status === 0) return 'No pudimos conectarnos. Revisa tu conexión a internet e inténtalo de nuevo.';
    if (data && data.error === 'service_unavailable') return 'La instalación en línea no está disponible en este momento. Intenta más tarde o agenda una demo.';
    return 'No pudimos completar la solicitud. Intenta de nuevo en unos minutos.';
  }

  function setStepIndicator(step) {
    document.querySelectorAll('.install-steps__item').forEach(function (li) {
      var n = Number(li.getAttribute('data-indicator'));
      li.classList.toggle('is-active', n === step);
      li.classList.toggle('is-done', n < step);
      if (n === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }

  var params = new URLSearchParams(location.search);
  var statusToken = params.get('t');
  var isStatusPage = /^\/instalar\/estado\/?$/.test(location.pathname) || statusToken !== null;

  if (isStatusPage) initStatus(statusToken || '');
  else initWizard();

  /* ============================================================
     PASOS 1 y 2
     ============================================================ */
  function initWizard() {
    var state = { shopInput: '', domain: '', storeName: '', email: '', token: '' };

    var shopForm = $('shop-form');
    var shopInput = $('shop-input');
    var shopSubmit = $('shop-submit');
    var shopError = $('shop-error');
    var shopResult = $('shop-result');
    var shopMessage = $('shop-message');
    var shopContinue = $('shop-continue');

    var emailForm = $('email-form');
    var emailInput = $('email-input');
    var termsInput = $('terms-input');
    var emailError = $('email-error');
    var emailSubmit = $('email-submit');

    var codeForm = $('code-form');
    var codeInput = $('code-input');
    var codeError = $('code-error');
    var codeSubmit = $('code-submit');
    var codeResend = $('code-resend');

    // Solicitud previa guardada en este dispositivo
    var saved = storageGet();
    if (TOKEN_RX.test(saved)) {
      $('pending-link').href = '/instalar/estado?t=' + encodeURIComponent(saved);
      show($('pending-banner'), true);
    }

    function goStep(step) {
      setStepIndicator(step);
      show($('step-shop'), step === 1);
      show($('step-email'), step === 2);
      if (step === 2) {
        $('email-store').textContent = state.storeName ? state.storeName + ' (' + state.domain + ')' : state.domain;
        var title = $('step-email-title');
        if (title) title.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    function renderCheck(name, value) {
      var li = document.querySelector('[data-check="' + name + '"]');
      if (!li) return;
      var stateName = value === true ? 'ok' : value === false ? 'fail' : 'skip';
      li.setAttribute('data-state', stateName);
      li.querySelector('.install-checks__icon').innerHTML = ICONS[stateName];
      li.querySelector('[data-sr]').textContent = stateName === 'ok' ? ': cumple' : stateName === 'fail' ? ': no cumple' : ': no verificado';
    }

    function setMessage(html, tone) {
      shopMessage.className = 'install-note' + (tone ? ' install-note--' + tone : '');
      shopMessage.innerHTML = html;
      show(shopMessage, !!html);
    }

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function mailto(subject, body) {
      return 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    }

    function renderResult(d) {
      show(shopResult, true);
      var name = $('shop-result-name');
      if (d.myshopify_domain) {
        name.innerHTML = esc(d.store_name || d.myshopify_domain) + '<small>' + esc(d.myshopify_domain) + '</small>';
        show(name, true);
      } else {
        show(name, false);
      }
      var c = d.checks || {};
      renderCheck('shopify', c.shopify);
      renderCheck('cop', c.cop);
      renderCheck('no_suscripfy', c.no_suscripfy);
      renderCheck('category', c.category);

      var msgs = [];
      var tone = 'fail';
      switch (d.reason) {
        case 'unreachable':
          msgs.push('<p>No pudimos abrir esa dirección. Revisa que esté bien escrita e inténtalo de nuevo. También puedes usar la dirección de tu admin de Shopify (admin.shopify.com/store/NOMBRE).</p>');
          break;
        case 'not_shopify':
          msgs.push('<p>No encontramos una tienda Shopify en esa dirección. Revisa que sea la dirección de tu tienda o pega la de tu admin de Shopify (admin.shopify.com/store/NOMBRE).</p>');
          break;
        case 'already_installed':
          msgs.push('<p>SuscripFy ya está instalada en esta tienda. Puedes abrirla desde la sección Apps de tu admin de Shopify.</p>');
          tone = 'warn';
          break;
        case 'not_cop':
          msgs.push('<p>Tu tienda usa la moneda ' + esc(d.currency || 'distinta a COP') + '. Por ahora SuscripFy funciona solo con tiendas en pesos colombianos (COP). Si cambias la moneda de tu tienda a COP, vuelve a verificarla.</p>');
          tone = 'warn';
          break;
        case 'category_blocked':
          msgs.push('<p>' + esc(CATEGORY_BLOCKED_TEXT) + '</p>' +
            '<p><a href="' + esc(mailto('Revisión de categoría: ' + (d.myshopify_domain || ''), 'Hola, intenté instalar SuscripFy en ' + (d.myshopify_domain || '') + ' y creo que mi tienda no es de suplementación nutricional.')) + '">Creo que es un error, escribir</a></p>');
          break;
        default:
          break;
      }
      if (d.ok && d.open_request) {
        msgs.push('<p>Ya hay una solicitud de instalación en curso para esta tienda. Si la hiciste tú, revisa tu correo. También puedes continuar y hacerla de nuevo.</p>');
        tone = '';
      }
      setMessage(msgs.join(''), tone);
      show(shopContinue, !!d.ok);
      if (d.ok) shopContinue.focus({ preventScroll: true });
    }

    shopInput.addEventListener('input', function () { setError(shopError, '', shopInput); });

    shopForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = shopInput.value.trim();
      setError(shopError, '', shopInput);
      show(shopResult, false);
      if (!value) {
        setError(shopError, 'Escribe la dirección de tu tienda.', shopInput);
        shopInput.focus();
        return;
      }
      setLoading(shopSubmit, true, 'Verificando...');
      api('POST', '/api/install/check', { shop: value }).then(function (r) {
        setLoading(shopSubmit, false);
        if (r.status === 400 && r.data.error === 'invalid_shop') {
          setError(shopError, 'Esa dirección no parece válida. Escribe algo como mitienda.com o mitienda.myshopify.com.', shopInput);
          shopInput.focus();
          return;
        }
        if (r.status !== 200) {
          setError(shopError, r.data.error === 'verification_unavailable'
            ? 'No pudimos completar la verificación. Intenta de nuevo en unos minutos.'
            : genericError(r.status, r.data));
          return;
        }
        state.shopInput = value;
        state.domain = r.data.myshopify_domain || '';
        state.storeName = r.data.store_name || '';
        renderResult(r.data);
      });
    });

    shopContinue.addEventListener('click', function () {
      if (!state.domain) return;
      goStep(2);
      setTimeout(function () { emailInput.focus(); }, 50);
    });

    $('change-store').addEventListener('click', function () {
      show(codeForm, false);
      show(emailForm, true);
      goStep(1);
      shopInput.focus();
    });

    function requestCode(btn) {
      var email = emailInput.value.trim().toLowerCase();
      setError(emailError, '', emailInput);
      setError(codeError, '', codeInput);
      if (!EMAIL_RX.test(email) || email.length > 254) {
        setError(emailError, 'Revisa tu correo electrónico.', emailInput);
        emailInput.focus();
        return;
      }
      if (!termsInput.checked) {
        setError(emailError, 'Para continuar debes aceptar los Términos y Condiciones para Tiendas.');
        termsInput.focus();
        return;
      }
      setLoading(btn, true, btn === codeResend ? 'Enviando...' : 'Enviando código...');
      api('POST', '/api/install/request', {
        myshopify_domain: state.domain,
        email: email,
        terms_accepted: true,
        shop_input: state.shopInput,
      }).then(function (r) {
        setLoading(btn, false);
        var d = r.data;
        if (r.status === 200 && d.status_token && TOKEN_RX.test(d.status_token)) {
          state.email = email;
          state.token = d.status_token;
          storageSet(d.status_token);
          $('code-email').textContent = email;
          show(emailForm, false);
          show(codeForm, true);
          codeInput.value = '';
          if (btn === codeResend) setError(codeError, '');
          setTimeout(function () { codeInput.focus(); }, 50);
          if (btn === codeResend) {
            codeResend.textContent = 'Código reenviado';
            codeResend.disabled = true;
            setTimeout(function () { codeResend.textContent = 'Reenviar código'; codeResend.disabled = false; }, 30000);
          }
          return;
        }
        var target = btn === codeResend ? codeError : emailError;
        var msg;
        switch (d.error) {
          case 'invalid_email': msg = 'Revisa tu correo electrónico.'; break;
          case 'terms_required': msg = 'Para continuar debes aceptar los Términos y Condiciones para Tiendas.'; break;
          case 'already_installed': msg = 'SuscripFy ya está instalada en esta tienda.'; break;
          case 'not_cop': msg = 'Tu tienda no está en pesos colombianos (COP). Por ahora SuscripFy funciona solo con tiendas en COP.'; break;
          case 'not_shopify':
          case 'invalid_shop': msg = 'No pudimos confirmar tu tienda. Vuelve al paso anterior y verifícala de nuevo.'; break;
          case 'category_blocked': msg = CATEGORY_BLOCKED_TEXT; break;
          case 'verification_unavailable': msg = 'No pudimos completar la verificación. Intenta de nuevo en unos minutos.'; break;
          default: msg = genericError(r.status, d);
        }
        setError(target, msg, btn === codeResend ? null : emailInput);
      });
    }

    emailForm.addEventListener('submit', function (e) { e.preventDefault(); requestCode(emailSubmit); });
    codeResend.addEventListener('click', function () { requestCode(codeResend); });

    $('code-change-email').addEventListener('click', function () {
      show(codeForm, false);
      show(emailForm, true);
      setError(codeError, '');
      emailInput.focus();
    });

    codeInput.addEventListener('input', function () {
      var digits = codeInput.value.replace(/\D/g, '').slice(0, 6);
      if (digits !== codeInput.value) codeInput.value = digits;
      setError(codeError, '', codeInput);
    });

    codeForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = codeInput.value.trim();
      if (!/^\d{6}$/.test(code)) {
        setError(codeError, 'El código tiene 6 dígitos.', codeInput);
        codeInput.focus();
        return;
      }
      setLoading(codeSubmit, true, 'Confirmando...');
      api('POST', '/api/install/verify', { status_token: state.token, code: code }).then(function (r) {
        if (r.status === 200 && r.data.ok) {
          location.assign('/instalar/estado?t=' + encodeURIComponent(state.token));
          return;
        }
        setLoading(codeSubmit, false);
        var d = r.data;
        var msg;
        if (d.error === 'expired' || r.status === 410) {
          msg = 'El código venció. Pide uno nuevo con "Reenviar código".';
        } else if (r.status === 400 || r.status === 409) {
          msg = 'El código no es correcto.';
          if (typeof d.attempts_left === 'number') {
            msg += d.attempts_left > 0
              ? ' Te quedan ' + d.attempts_left + (d.attempts_left === 1 ? ' intento.' : ' intentos.')
              : ' Ya no quedan intentos: pide un código nuevo con "Reenviar código".';
          }
        } else if (r.status === 404) {
          msg = 'Tu solicitud ya no está activa. Pide un código nuevo con "Reenviar código".';
        } else {
          msg = genericError(r.status, d);
        }
        setError(codeError, msg, codeInput);
        codeInput.select();
      });
    });
  }

  /* ============================================================
     PASO 3: ESTADO
     ============================================================ */
  function initStatus(token) {
    setStepIndicator(3);
    show($('step-shop'), false);
    show($('step-email'), false);
    show($('step-status'), true);
    $('install-title').innerHTML = 'Estado de tu <em class="title-brand">instalación</em>';
    $('install-subtitle').textContent = 'Aquí ves en qué va tu solicitud. Esta página se actualiza sola.';

    var loading = $('status-loading');
    var body = $('status-body');
    var timer = null;
    var stopped = false;
    var inFlight = false;

    if (!TOKEN_RX.test(token)) {
      render({ kind: 'invalid' });
      return;
    }

    storageSet(token);
    var link = statusUrl(token);
    $('status-link').value = link;
    show($('status-save'), true);

    $('status-link').addEventListener('focus', function () { this.select(); });
    $('status-copy').addEventListener('click', function () {
      var label = $('status-copy-label');
      function done(ok) {
        label.textContent = ok ? 'Copiado' : 'Copia el link';
        setTimeout(function () { label.textContent = 'Copiar'; }, 2500);
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(link).then(function () { done(true); }, function () { fallbackCopy(); });
      } else {
        fallbackCopy();
      }
      function fallbackCopy() {
        var input = $('status-link');
        input.focus();
        input.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        done(ok);
      }
    });

    function setIcon(name, tone) {
      var el = $('status-icon');
      el.innerHTML = ICONS[name];
      if (tone) el.setAttribute('data-tone', tone); else el.removeAttribute('data-tone');
    }

    function render(s) {
      show(loading, false);
      show(body, true);
      var title = $('status-title');
      var text = $('status-text');
      var store = $('status-store');
      var install = $('status-install');
      var restart = $('status-restart');
      show(install, false);
      show(restart, false);
      store.textContent = s.store_name || '';
      show(store, !!s.store_name);

      if (s.kind === 'invalid' || s.kind === 'not_found') {
        setIcon('search', 'muted');
        title.textContent = s.kind === 'invalid' ? 'Este link no es válido' : 'No encontramos esta solicitud';
        text.textContent = 'Revisa que hayas copiado el link completo o haz una nueva solicitud.';
        show(restart, true);
        show($('status-save'), false);
        if (s.kind === 'not_found') storageSet('');
        return;
      }

      if (s.kind === 'unavailable') {
        setIcon('clock', 'muted');
        title.textContent = 'No pudimos consultar el estado';
        text.textContent = 'Lo intentaremos de nuevo en unos segundos.';
        $('status-updated').textContent = '';
        return;
      }

      switch (s.stage) {
        case 'link_sent': {
          var valid = typeof s.install_link === 'string' && s.install_link.indexOf(INSTALL_LINK_PREFIX) === 0;
          setIcon('link', 'ok');
          title.textContent = 'Tu link de instalación está listo';
          if (valid) {
            text.textContent = 'También te lo enviamos a tu correo.';
            $('status-install-btn').href = s.install_link;
            show(install, true);
          } else {
            text.textContent = 'Te enviamos el link de instalación a tu correo. Ábrelo con la cuenta dueña de la tienda o con una cuenta con permiso para instalar apps.';
          }
          break;
        }
        case 'installed':
          setIcon('check', 'ok');
          title.textContent = 'Ya instalaste SuscripFy';
          text.textContent = 'Sigue la guía de configuración dentro de SuscripFy. La encuentras en la sección Apps de tu admin de Shopify.';
          storageSet('');
          break;
        case 'rejected':
          setIcon('x', 'fail');
          title.textContent = 'No pudimos aprobar tu solicitud';
          text.innerHTML = 'Por ahora no podemos habilitar SuscripFy para esta tienda. Si tienes dudas, escríbenos a <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a>.';
          storageSet('');
          break;
        case 'expired':
          setIcon('clock', 'muted');
          title.textContent = 'Tu solicitud venció';
          text.textContent = 'Puedes hacer una nueva solicitud en un par de minutos.';
          show(restart, true);
          storageSet('');
          break;
        case 'error':
          setIcon('search');
          title.textContent = 'Estamos revisando tu solicitud, te escribiremos';
          text.innerHTML = 'Si tienes dudas, escríbenos a <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a>.';
          break;
        default: // email_pending, verified, provisioning, awaiting_link
          setIcon('clock');
          title.textContent = 'Tu app está casi lista';
          text.textContent = ALMOST_READY_TEXT.replace(/^Tu app está casi lista\. /, '');
          break;
      }
      var now = new Date();
      $('status-updated').textContent = 'Actualizado a las ' + now.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    }

    function isFinal(stage) { return stage === 'installed' || stage === 'rejected' || stage === 'expired'; }

    function schedule() {
      clearTimeout(timer);
      if (stopped || document.visibilityState !== 'visible') return;
      timer = setTimeout(poll, POLL_MS);
    }

    function poll() {
      if (stopped || inFlight) return;
      inFlight = true;
      api('GET', '/api/install/status?t=' + encodeURIComponent(token)).then(function (r) {
        inFlight = false;
        if (r.status === 200 && r.data.ok) {
          render(r.data);
          if (isFinal(r.data.stage)) { stopped = true; return; }
        } else if (r.status === 404 || r.status === 400) {
          render({ kind: r.status === 404 ? 'not_found' : 'invalid' });
          stopped = true;
          return;
        } else if (!body.hidden) {
          $('status-updated').textContent = 'No pudimos actualizar el estado. Lo intentaremos de nuevo en unos segundos.';
        } else {
          render({ kind: 'unavailable' });
        }
        schedule();
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') poll();
      else clearTimeout(timer);
    });

    poll();
  }
})();
