/* Mensajes del paso de código (/instalar). UMD mínimo: navegador (window.SfyInstallMessages)
   y Node (tests/install-messages.test.mjs). attempts_left viene del core (N real). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SfyInstallMessages = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function attemptsText(n) {
    return n === 1 ? 'Te queda 1 intento.' : 'Te quedan ' + n + ' intentos.';
  }
  function codeErrorMessage(status, data) {
    var d = data || {};
    var n = typeof d.attempts_left === 'number' ? d.attempts_left : null;
    if (d.error === 'expired' || status === 410) {
      return 'El código venció. Pide uno nuevo con "Reenviar código".';
    }
    if (d.error === 'too_many_attempts' || (n === 0 && (status === 400 || status === 429))) {
      return 'Ya no quedan intentos. Pide un código nuevo con "Reenviar código".';
    }
    if (status === 400 || status === 409) {
      return n !== null && n > 0 ? 'Código incorrecto. ' + attemptsText(n) : 'Código incorrecto.';
    }
    if (status === 404) {
      return 'Tu solicitud ya no está activa. Pide un código nuevo con "Reenviar código".';
    }
    return null;
  }
  return { codeErrorMessage: codeErrorMessage };
});
