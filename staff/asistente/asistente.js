(function () {
  'use strict';

  const MAX_HISTORY = 12;
  const MAX_MSG_LEN = 2000;

  const loginView = document.getElementById('sf-staff-login-view');
  const chatView = document.getElementById('sf-staff-chat-view');
  const loginForm = document.getElementById('sf-staff-login-form');
  const loginBtn = document.getElementById('sf-staff-login-btn');
  const loginErr = document.getElementById('sf-staff-login-error');
  const emailInp = document.getElementById('sf-staff-email');
  const passInp = document.getElementById('sf-staff-password');
  const chatForm = document.getElementById('sf-staff-chat-form');
  const messagesEl = document.getElementById('sf-staff-messages');
  const inputEl = document.getElementById('sf-staff-input');
  const sendBtn = document.getElementById('sf-staff-send');
  const logoutBtn = document.getElementById('sf-staff-logout');
  const newBtn = document.getElementById('sf-staff-new');

  let history = [];

  function showLogin() {
    chatView.hidden = true;
    loginView.hidden = false;
    setTimeout(() => emailInp.focus(), 50);
  }
  function showChat() {
    loginView.hidden = true;
    chatView.hidden = false;
    setTimeout(() => inputEl.focus(), 50);
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function renderMarkdown(raw) {
    let s = escapeHtml(raw);
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return s;
  }
  function scrollBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function appendUserMsg(text) {
    const el = document.createElement('div');
    el.className = 'sf-staff-msg sf-staff-msg--user';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollBottom();
  }
  function appendBotMsg(text, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'sf-staff-msg sf-staff-msg--bot' + (opts.isError ? ' sf-staff-msg--error' : '');
    el.innerHTML = renderMarkdown(text);
    if (!opts.isError) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'sf-staff-msg__copy';
      copyBtn.textContent = 'Copiar';
      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = 'Copiado';
          copyBtn.classList.add('is-copied');
          setTimeout(function () {
            copyBtn.textContent = 'Copiar';
            copyBtn.classList.remove('is-copied');
          }, 1400);
        });
      });
      el.appendChild(copyBtn);
    }
    messagesEl.appendChild(el);
    scrollBottom();
  }
  function appendTyping() {
    const el = document.createElement('div');
    el.className = 'sf-staff-typing';
    el.id = 'sf-staff-typing-indicator';
    el.innerHTML = '<span class="sf-staff-typing__dot"></span><span class="sf-staff-typing__dot"></span><span class="sf-staff-typing__dot"></span>';
    messagesEl.appendChild(el);
    scrollBottom();
  }
  function removeTyping() {
    const el = document.getElementById('sf-staff-typing-indicator');
    if (el) el.remove();
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    loginErr.hidden = true;
    loginBtn.disabled = true;
    try {
      const resp = await fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: emailInp.value.trim().toLowerCase(),
          password: passInp.value,
        }),
      });
      if (resp.ok) {
        passInp.value = '';
        showChat();
        return;
      }
      const data = await resp.json().catch(() => ({}));
      let msg = 'No se pudo iniciar sesión.';
      if (data.error === 'invalid_credentials') msg = 'Correo o contraseña incorrectos.';
      else if (data.error === 'too_many_attempts') msg = 'Demasiados intentos. Espera 15 minutos.';
      else if (data.error === 'misconfigured') msg = 'Servicio mal configurado. Contacta a soporte.';
      loginErr.textContent = msg;
      loginErr.hidden = false;
    } catch {
      loginErr.textContent = 'Sin conexión. Verifica tu internet.';
      loginErr.hidden = false;
    } finally {
      loginBtn.disabled = false;
    }
  });

  async function probeSession() {
    try {
      const resp = await fetch('/api/staff/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message: '', history: [] }),
      });
      if (resp.status === 401) { showLogin(); return; }
      showChat();
    } catch {
      showLogin();
    }
  }

  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  }
  inputEl.addEventListener('input', autoResize);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });

  chatForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    if (text.length > MAX_MSG_LEN) return;

    appendUserMsg(text);
    history.push({ role: 'user', content: text });
    if (history.length > MAX_HISTORY * 2) history = history.slice(-MAX_HISTORY * 2);

    inputEl.value = '';
    autoResize();
    inputEl.disabled = true; sendBtn.disabled = true;
    appendTyping();

    const histSend = history.slice(0, -1).slice(-MAX_HISTORY);

    try {
      const resp = await fetch('/api/staff/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message: text, history: histSend }),
      });
      removeTyping();
      if (resp.status === 401) {
        appendBotMsg('Sesión expirada. Vuelve a iniciar.', { isError: true });
        setTimeout(showLogin, 1200);
        return;
      }
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const msg = data.error === 'rate_limit'
          ? 'Estás enviando mensajes muy rápido. Espera unos segundos.'
          : 'Hubo un problema procesando el mensaje.';
        appendBotMsg(msg, { isError: true });
        return;
      }
      const data = await resp.json();
      const reply = (data.reply || '').trim();
      if (reply) {
        appendBotMsg(reply);
        history.push({ role: 'assistant', content: reply });
      }
    } catch {
      removeTyping();
      appendBotMsg('Sin conexión. Intenta de nuevo.', { isError: true });
    } finally {
      inputEl.disabled = false; sendBtn.disabled = false;
      inputEl.focus();
    }
  });

  newBtn.addEventListener('click', function () {
    history = [];
    messagesEl.innerHTML = '';
    inputEl.focus();
  });
  logoutBtn.addEventListener('click', async function () {
    try {
      await fetch('/api/staff/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {}
    history = [];
    messagesEl.innerHTML = '';
    passInp.value = '';
    showLogin();
  });

  probeSession();
})();
