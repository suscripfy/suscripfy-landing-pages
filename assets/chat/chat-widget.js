/* ════════════════════════════════════════════════════════════════════
   SF Chat Widget — landing chatbot
   IIFE aislado. Lee #sf-chat-trigger + monta UI en #sf-chat-root.
   Persiste estado en sessionStorage (no atraviesa pestañas).
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const TRIGGER_ID = 'sf-chat-trigger';
  const ROOT_ID = 'sf-chat-root';
  const SS_LEAD = 'sf_chat_lead_v1';
  const SS_MSGS = 'sf_chat_msgs_v1';
  const SS_OPEN = 'sf_chat_open_v1';
  const SS_TURNS = 'sf_chat_turns_v1';
  const SS_UNREAD = 'sf_chat_unread_v1';
  const SS_SID = 'sf_chat_sid_v1';
  const MAX_MSG_LEN = 500;
  const MAX_TURNS = 30;
  const CTA_AFTER_TURNS = 6;
  const WA_NUMBER = '573104513138';
  const CAL_URL = 'https://cal.com/suscripfy-comercial/30min';

  const root = document.getElementById(ROOT_ID);
  const trigger = document.getElementById(TRIGGER_ID);
  const badge = document.getElementById('sf-chat-badge');
  if (!root || !trigger) return;

  // ── Estado ──────────────────────────────────────────────────────────
  function getSessionId() {
    let sid = sessionStorage.getItem(SS_SID);
    if (!sid) {
      sid = 'sf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(SS_SID, sid);
    }
    return sid;
  }
  function getLead() {
    try { return JSON.parse(sessionStorage.getItem(SS_LEAD) || 'null'); }
    catch { return null; }
  }
  function setLead(l) { sessionStorage.setItem(SS_LEAD, JSON.stringify(l)); }
  function getMsgs() {
    try { return JSON.parse(sessionStorage.getItem(SS_MSGS) || '[]'); }
    catch { return []; }
  }
  function setMsgs(m) { sessionStorage.setItem(SS_MSGS, JSON.stringify(m)); }
  function getTurns() { return parseInt(sessionStorage.getItem(SS_TURNS) || '0', 10); }
  function setTurns(n) { sessionStorage.setItem(SS_TURNS, String(n)); }
  function getUnread() { return parseInt(sessionStorage.getItem(SS_UNREAD) || '0', 10); }
  function setUnread(n) {
    sessionStorage.setItem(SS_UNREAD, String(n));
    if (!badge) return;
    if (n > 0) { badge.textContent = String(n); badge.hidden = false; }
    else { badge.hidden = true; badge.textContent = ''; }
  }

  // ── Sanitización (anti-XSS para render de mensajes) ─────────────────
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  // Markdown mínimo seguro: **bold**, *italic*, `code`, listas, links http(s)
  function renderMarkdown(raw) {
    var s = escapeHtml(raw);
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    // listas con guión al inicio de línea
    s = s.replace(/(^|\n)- (.+)/g, '$1<li>$2</li>');
    s = s.replace(/(<li>[\s\S]+?<\/li>)/g, function (block) {
      return '<ul>' + block + '</ul>';
    });
    s = s.replace(/<\/ul>\s*<ul>/g, '');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  // ── Validaciones del formulario ─────────────────────────────────────
  var RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var RX_PHONE_CO = /^3\d{9}$/; // 10 dígitos, empieza por 3
  var RX_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

  function normalizePhone(v) {
    return String(v || '').replace(/\D/g, '').replace(/^57/, '');
  }
  function normalizeDomain(v) {
    return String(v || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .trim();
  }
  function isNoStore(v) {
    var s = String(v || '').trim().toLowerCase();
    return s === 'no tengo aún' || s === 'no tengo aun' || s === 'no tengo' || s === 'aún no' || s === 'aun no';
  }
  function validateForm(d) {
    var errors = {};
    if (!d.nombre || d.nombre.trim().length < 2) errors.nombre = 'Mínimo 2 caracteres';
    if (!RX_EMAIL.test(d.email || '')) errors.email = 'Correo no válido';
    var phone = normalizePhone(d.whatsapp);
    if (!RX_PHONE_CO.test(phone)) errors.whatsapp = 'Número colombiano de 10 dígitos (3XXXXXXXXX)';
    var raw = (d.shopify_url || '').trim();
    if (!raw) errors.shopify_url = 'Escribe tu dominio o "no tengo aún"';
    else if (!isNoStore(raw)) {
      var norm = normalizeDomain(raw);
      if (!RX_DOMAIN.test(norm)) errors.shopify_url = 'Dominio no válido (ejemplo: mitienda.com.co)';
    }
    return errors;
  }

  // ── Construcción del DOM del panel ──────────────────────────────────
  function buildPanel() {
    var panel = document.createElement('div');
    panel.className = 'sf-chat-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Chat con SuscripFy');
    panel.innerHTML = '<div class="sf-chat-header">' +
        '<div class="sf-chat-header__avatar" aria-hidden="true">S</div>' +
        '<div class="sf-chat-header__meta">' +
          '<div class="sf-chat-header__title">SuscripFy</div>' +
          '<div class="sf-chat-header__status">Activo ahora</div>' +
        '</div>' +
        '<button class="sf-chat-header__btn" id="sf-chat-min" aria-label="Minimizar chat">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="sf-chat-body" id="sf-chat-body"></div>';
    return panel;
  }

  function buildForm() {
    var wrap = document.createElement('form');
    wrap.className = 'sf-chat-form';
    wrap.id = 'sf-chat-form';
    wrap.noValidate = true;
    wrap.innerHTML = '<p class="sf-chat-form__intro">\u00A1Hola! \uD83D\uDC4B Antes de empezar, d\u00E9janos saber <strong>qui\u00E9n eres</strong> para personalizar la conversaci\u00F3n.</p>' +
      '<div class="sf-chat-field">' +
        '<label class="sf-chat-field__label" for="sf-chat-nombre">Nombre</label>' +
        '<input class="sf-chat-field__input" id="sf-chat-nombre" name="nombre" type="text" autocomplete="name" maxlength="80" required>' +
        '<div class="sf-chat-field__error" id="sf-chat-err-nombre" hidden></div>' +
      '</div>' +
      '<div class="sf-chat-field">' +
        '<label class="sf-chat-field__label" for="sf-chat-email">Correo electr\u00F3nico</label>' +
        '<input class="sf-chat-field__input" id="sf-chat-email" name="email" type="email" autocomplete="email" maxlength="120" inputmode="email" required>' +
        '<div class="sf-chat-field__error" id="sf-chat-err-email" hidden></div>' +
      '</div>' +
      '<div class="sf-chat-field">' +
        '<label class="sf-chat-field__label" for="sf-chat-whatsapp">WhatsApp</label>' +
        '<input class="sf-chat-field__input" id="sf-chat-whatsapp" name="whatsapp" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="3XXXXXXXXX" required>' +
        '<div class="sf-chat-field__hint">N\u00FAmero colombiano de 10 d\u00EDgitos.</div>' +
        '<div class="sf-chat-field__error" id="sf-chat-err-whatsapp" hidden></div>' +
      '</div>' +
      '<div class="sf-chat-field">' +
        '<label class="sf-chat-field__label" for="sf-chat-shopify">Dominio de tu tienda</label>' +
        '<input class="sf-chat-field__input" id="sf-chat-shopify" name="shopify_url" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="200" placeholder="mitienda.com.co" required>' +
        '<div class="sf-chat-field__hint">Por ejemplo: <em>mitienda.com.co</em>. Si a\u00FAn no tienes tienda, escribe: <em>no tengo a\u00FAn</em></div>' +
        '<div class="sf-chat-field__error" id="sf-chat-err-shopify" hidden></div>' +
      '</div>' +
      '<div class="sf-chat-field sf-chat-field--hp" aria-hidden="true">' +
        '<label>Sitio web</label>' +
        '<input type="text" name="website" tabindex="-1" autocomplete="off">' +
      '</div>' +
      '<p class="sf-chat-form__consent">' +
        'Al continuar autorizas el tratamiento de tus datos seg\u00FAn nuestra ' +
        '<a href="/privacy.html" target="_blank" rel="noopener">pol\u00EDtica de privacidad</a> ' +
        '(Ley 1581 de 2012).' +
      '</p>' +
      '<button type="submit" class="sf-chat-submit" id="sf-chat-submit">' +
        '<span class="sf-chat-submit__spinner" aria-hidden="true"></span>' +
        '<span class="sf-chat-submit__label">Comenzar conversaci\u00F3n</span>' +
      '</button>';
    return wrap;
  }

  function buildChat() {
    var wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.flex = '1';
    wrap.style.minHeight = '0';
    wrap.innerHTML = '<div class="sf-chat-messages" id="sf-chat-messages" role="log" aria-live="polite"></div>' +
      '<div class="sf-chat-footer">' +
        '<textarea class="sf-chat-footer__input" id="sf-chat-input" rows="1" ' +
          'placeholder="Escribe tu pregunta\u2026" maxlength="' + MAX_MSG_LEN + '" ' +
          'aria-label="Mensaje"></textarea>' +
        '<button class="sf-chat-footer__send" id="sf-chat-send" aria-label="Enviar mensaje">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>' +
          '</svg>' +
        '</button>' +
      '</div>';
    return wrap;
  }

  // ── Persistencia y renderizado ──────────────────────────────────────
  var panel = null;
  var isOpen = false;

  function open() {
    if (!panel) mount();
    isOpen = true;
    sessionStorage.setItem(SS_OPEN, '1');
    requestAnimationFrame(function () { panel.classList.add('sf-chat-panel--open'); });
    var waFloat = document.getElementById('wa-float');
    if (waFloat) waFloat.classList.add('is-chat-open');
    setUnread(0);
    setTimeout(function () {
      if (!getLead()) {
        var n = document.getElementById('sf-chat-nombre');
        if (n) n.focus();
      } else {
        var i = document.getElementById('sf-chat-input');
        if (i) i.focus();
        var m = document.getElementById('sf-chat-messages');
        if (m) m.scrollTop = m.scrollHeight;
      }
    }, 340);
  }

  function close() {
    if (!panel) return;
    isOpen = false;
    sessionStorage.setItem(SS_OPEN, '0');
    panel.classList.remove('sf-chat-panel--open');
    var waFloat = document.getElementById('wa-float');
    if (waFloat) waFloat.classList.remove('is-chat-open');
  }

  function mount() {
    panel = buildPanel();
    root.appendChild(panel);
    renderBody();
    panel.querySelector('#sf-chat-min').addEventListener('click', close);
  }

  function renderBody() {
    var body = panel.querySelector('#sf-chat-body');
    body.innerHTML = '';
    if (getLead()) {
      body.appendChild(buildChat());
      restoreMessages();
      bindChatHandlers();
    } else {
      body.appendChild(buildForm());
      bindFormHandlers();
    }
  }

  // ── Form handlers ───────────────────────────────────────────────────
  function bindFormHandlers() {
    var form = document.getElementById('sf-chat-form');
    var submit = document.getElementById('sf-chat-submit');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {
        nombre: form.querySelector('#sf-chat-nombre').value.trim(),
        email: form.querySelector('#sf-chat-email').value.trim(),
        whatsapp: form.querySelector('#sf-chat-whatsapp').value.trim(),
        shopify_url: form.querySelector('#sf-chat-shopify').value.trim(),
        website: form.querySelector('input[name="website"]').value,
      };
      // Honeypot
      if (data.website) { return; }

      var errors = validateForm(data);
      ['nombre','email','whatsapp','shopify_url'].forEach(function (k) {
        var inp = form.querySelector('[name="' + k + '"]');
        var errId = 'sf-chat-err-' + (k === 'shopify_url' ? 'shopify' : k);
        var errEl = form.querySelector('#' + errId);
        if (errors[k]) {
          inp.classList.add('sf-chat-field__input--error');
          errEl.textContent = errors[k];
          errEl.hidden = false;
        } else {
          inp.classList.remove('sf-chat-field__input--error');
          errEl.hidden = true;
        }
      });
      if (Object.keys(errors).length > 0) return;

      submit.disabled = true;
      submit.classList.add('is-loading');

      var payload = {
        nombre: data.nombre,
        email: data.email.toLowerCase(),
        whatsapp: normalizePhone(data.whatsapp),
        shopify_url: isNoStore(data.shopify_url) ? 'sin tienda aún' : normalizeDomain(data.shopify_url),
        session_id: getSessionId(),
        origen: 'landing-chat',
      };

      // Envío al endpoint /api/lead (no bloquea si falla — guardamos lead localmente)
      fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(function (err) {
        console.warn('[sf-chat] lead capture failed:', err);
      }).then(function () {
        setLead(payload);
        renderBody();
        // Mensaje de bienvenida del bot
        var welcome = '\u00A1Hola ' + payload.nombre.split(' ')[0] + '! \uD83D\uDC4B Soy el asistente de SuscripFy y te respondo de inmediato. Puedo contarte c\u00F3mo funciona, planes, instalaci\u00F3n o cualquier duda que tengas.\n\nSi prefieres hablar con un asesor humano o agendar una demo, d\u00EDmelo en cualquier momento y te conecto.';
        appendBotMsg(welcome);
      });
    });

    // Limpiar errores al escribir
    form.querySelectorAll('.sf-chat-field__input').forEach(function (inp) {
      inp.addEventListener('input', function () {
        inp.classList.remove('sf-chat-field__input--error');
        var id = inp.id.replace('sf-chat-', '');
        var errEl = form.querySelector('#sf-chat-err-' + id);
        if (errEl) errEl.hidden = true;
      });
    });
  }

  // ── Chat handlers ───────────────────────────────────────────────────
  function bindChatHandlers() {
    var input = document.getElementById('sf-chat-input');
    var send = document.getElementById('sf-chat-send');
    if (!input || !send) return;

    function autoResize() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    }
    input.addEventListener('input', autoResize);

    function handleSend() {
      var text = input.value.trim();
      if (!text) return;
      if (getTurns() >= MAX_TURNS) {
        appendBotMsg('Esta conversaci\u00F3n lleg\u00F3 al m\u00E1ximo de mensajes. Si necesitas seguir, te recomiendo continuar por WhatsApp:');
        appendCTA();
        return;
      }
      input.value = '';
      autoResize();
      sendMessage(text);
    }

    send.addEventListener('click', handleSend);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }

  function appendUserMsg(text) {
    var messages = document.getElementById('sf-chat-messages');
    var el = document.createElement('div');
    el.className = 'sf-chat-msg sf-chat-msg--user';
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    var arr = getMsgs();
    arr.push({ role: 'user', content: text });
    setMsgs(arr);
  }

  function appendBotMsg(text, opts) {
    opts = opts || {};
    var messages = document.getElementById('sf-chat-messages');
    if (!messages) return;
    var el = document.createElement('div');
    el.className = 'sf-chat-msg sf-chat-msg--bot' + (opts.isError ? ' sf-chat-msg--error' : '');
    el.innerHTML = renderMarkdown(text);
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    if (!opts.skipPersist) {
      var arr = getMsgs();
      arr.push({ role: 'assistant', content: text });
      setMsgs(arr);
    }
    if (!isOpen) setUnread(getUnread() + 1);
  }

  function appendCTA() {
    var messages = document.getElementById('sf-chat-messages');
    if (!messages) return;
    if (messages.querySelector('.sf-chat-cta')) return; // no duplicar
    var lead = getLead() || {};
    var ctx = encodeURIComponent(
      'Hola, vengo del chat de la landing de SuscripFy. Soy ' + (lead.nombre || '') +
      (lead.shopify_url ? ', mi tienda es ' + lead.shopify_url : '') +
      '. Quiero hablar con un asesor.'
    );
    var cta = document.createElement('div');
    cta.className = 'sf-chat-cta';
    cta.innerHTML = '<div class="sf-chat-cta__title">\u00BFPrefieres hablar con un asesor humano?</div>' +
      '<div class="sf-chat-cta__actions">' +
        '<a class="sf-chat-cta__btn sf-chat-cta__btn--wa" ' +
           'href="https://wa.me/' + WA_NUMBER + '?text=' + ctx + '" ' +
           'target="_blank" rel="noopener noreferrer">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
            '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487 2.717 1.174 2.717.783 3.204.733.487-.05 1.578-.645 1.8-1.27.222-.625.222-1.16.156-1.27-.067-.111-.245-.178-.51-.297z"/>' +
          '</svg>' +
          'Continuar por WhatsApp' +
        '</a>' +
        '<a class="sf-chat-cta__btn sf-chat-cta__btn--cal" ' +
           'href="' + CAL_URL + '" target="_blank" rel="noopener noreferrer">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
            '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>' +
            '<line x1="16" y1="2" x2="16" y2="6"/>' +
            '<line x1="8" y1="2" x2="8" y2="6"/>' +
            '<line x1="3" y1="10" x2="21" y2="10"/>' +
          '</svg>' +
          'Agendar demo (15 min)' +
        '</a>' +
      '</div>';
    messages.appendChild(cta);
    messages.scrollTop = messages.scrollHeight;
  }

  function appendTyping() {
    var messages = document.getElementById('sf-chat-messages');
    var el = document.createElement('div');
    el.className = 'sf-chat-typing';
    el.id = 'sf-chat-typing';
    el.innerHTML = '<span class="sf-chat-typing__dot"></span><span class="sf-chat-typing__dot"></span><span class="sf-chat-typing__dot"></span>';
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }
  function removeTyping() {
    var el = document.getElementById('sf-chat-typing');
    if (el) el.remove();
  }

  function sendMessage(text) {
    appendUserMsg(text);
    var turns = getTurns() + 1;
    setTurns(turns);

    var input = document.getElementById('sf-chat-input');
    var send = document.getElementById('sf-chat-send');
    if (input) input.disabled = true;
    if (send) send.disabled = true;
    appendTyping();

    var history = getMsgs().slice(0, -1).slice(-12); // últimos 12 turnos sin contar el actual
    var lead = getLead() || {};

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: history,
        lead: {
          nombre: lead.nombre,
          email: lead.email,
          whatsapp: lead.whatsapp,
          shopify_url: lead.shopify_url,
        },
        session_id: getSessionId(),
      }),
    }).then(function (resp) {
      removeTyping();
      if (!resp.ok) {
        return resp.json().catch(function () { return {}; }).then(function (errData) {
          var msg = errData.error === 'rate_limit'
            ? 'Est\u00E1s enviando mensajes muy r\u00E1pido. Espera unos segundos.'
            : 'Tuvimos un problema procesando tu mensaje. Int\u00E9ntalo de nuevo o cont\u00E1ctanos por WhatsApp.';
          appendBotMsg(msg, { isError: true });
          appendCTA();
        });
      }
      return resp.json().then(function (data) {
        var reply = (data.reply || '').trim();
        var mustTransfer = false;
        if (reply.indexOf('[TRANSFER]') !== -1) {
          mustTransfer = true;
          reply = reply.replace(/\[TRANSFER\]/g, '').trim();
        }
        if (reply) appendBotMsg(reply);
        if (mustTransfer || turns >= CTA_AFTER_TURNS) appendCTA();
      });
    }).catch(function () {
      removeTyping();
      appendBotMsg('Sin conexi\u00F3n. Verifica tu internet y vuelve a intentar.', { isError: true });
    }).then(function () {
      if (input) { input.disabled = false; input.focus(); }
      if (send) send.disabled = false;
    });
  }

  function restoreMessages() {
    var messages = document.getElementById('sf-chat-messages');
    if (!messages) return;
    var arr = getMsgs();
    arr.forEach(function (m) {
      var el = document.createElement('div');
      el.className = 'sf-chat-msg ' + (m.role === 'user' ? 'sf-chat-msg--user' : 'sf-chat-msg--bot');
      if (m.role === 'user') el.textContent = m.content;
      else el.innerHTML = renderMarkdown(m.content);
      messages.appendChild(el);
    });
    if (getTurns() >= CTA_AFTER_TURNS) appendCTA();
    messages.scrollTop = messages.scrollHeight;
  }

  // ── Inicio ──────────────────────────────────────────────────────────
  trigger.addEventListener('click', open);

  // El botón "Escríbenos" del navbar (desktop y mobile) abre el mismo chat.
  // En mobile el menú hamburguesa se cierra solo (handler closeMenu sobre todos los <a> de #navLinks).
  var navBtn = document.getElementById('wa-nav-btn');
  if (navBtn) {
    navBtn.addEventListener('click', function (e) {
      e.preventDefault();
      open();
    });
  }

  // Restaurar estado si la pestaña sigue viva
  if (sessionStorage.getItem(SS_OPEN) === '1' || getMsgs().length > 0) {
    setTimeout(open, 600);
  } else {
    setUnread(getUnread());
  }
})();
