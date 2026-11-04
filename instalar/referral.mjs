// Única fuente de "¿Dónde nos conociste?" (/instalar). La usan el navegador
// (<script type="module">, publica window.SfyReferralOptions) y las funciones
// de Vercel (import desde api/install/_lib.js). Los valores coinciden con la
// allowlist del core (services/install_requests.REFERRAL_SOURCES).
export const REFERRAL_OPTIONS = Object.freeze([
  Object.freeze({ value: 'chatgpt', label: 'ChatGPT' }),
  Object.freeze({ value: 'claude', label: 'Claude' }),
  Object.freeze({ value: 'gemini', label: 'Gemini' }),
  Object.freeze({ value: 'google', label: 'Google' }),
  Object.freeze({ value: 'redes_sociales', label: 'Redes sociales' }),
  Object.freeze({ value: 'recomendacion', label: 'Recomendación' }),
  Object.freeze({ value: 'otro', label: 'Otro' }),
]);

if (typeof window !== 'undefined') window.SfyReferralOptions = REFERRAL_OPTIONS;
