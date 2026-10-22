'use strict';

/* ============================================================
   NAVBAR — transparent → solid on scroll
   ============================================================ */
const navbar = document.getElementById('navbar');

function updateNavbar() {
  navbar.classList.toggle('is-scrolled', window.scrollY > 30);
}

window.addEventListener('scroll', updateNavbar, { passive: true });
updateNavbar(); // run once on load

/* ============================================================
   MOBILE MENU
   ============================================================ */
const hamburgerBtn = document.getElementById('hamburgerBtn');
const navLinks     = document.getElementById('navLinks');

function openMenu() {
  navLinks.classList.add('is-open');
  hamburgerBtn.classList.add('is-open');
  hamburgerBtn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

function closeMenu() {
  navLinks.classList.remove('is-open');
  hamburgerBtn.classList.remove('is-open');
  hamburgerBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

hamburgerBtn.addEventListener('click', () => {
  navLinks.classList.contains('is-open') ? closeMenu() : openMenu();
});

// Close when any nav link is clicked
navLinks.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));

// Close on outside click
document.addEventListener('click', (e) => {
  if (!navbar.contains(e.target)) closeMenu();
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && navLinks.classList.contains('is-open')) {
    closeMenu();
    hamburgerBtn.focus();
  }
});

/* ============================================================
   SMOOTH SCROLL for anchor links
   ============================================================ */
const NAV_HEIGHT = 70;

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    const href = anchor.getAttribute('href');
    if (!href || href === '#') return;
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

/* ============================================================
   INTERSECTION OBSERVER — fade-in + slide-up on scroll
   ============================================================ */
const animatedEls = document.querySelectorAll('.animate-on-scroll');

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
);

animatedEls.forEach((el) => observer.observe(el));

/* ============================================================
   FLOATING TRIGGER — dismiss logic
   Visible por defecto. El click lo maneja chat-widget.js.
   ============================================================ */
(function () {
  const WA_KEY  = 'wa_float_dismissed';
  const waFloat = document.getElementById('wa-float');
  const waClose = document.getElementById('wa-float-close');
  if (!waFloat || !waClose) return;

  if (localStorage.getItem(WA_KEY) === '1') {
    waFloat.classList.add('is-dismissed');
    return;
  }

  setTimeout(() => waFloat.classList.add('is-visible'), 1200);

  waClose.addEventListener('click', (e) => {
    e.stopPropagation();
    waFloat.classList.remove('is-visible');
    setTimeout(() => waFloat.classList.add('is-dismissed'), 350);
    localStorage.setItem(WA_KEY, '1');
  });
})();

/* ============================================================
   VIDEO DEMO — facade: el iframe se inyecta solo al hacer click.
   Guard obligatorio: main.js tambien lo carga la pagina cornerstone,
   donde este bloque NO existe.
   ============================================================ */
(function () {
  const player = document.getElementById('video-demo-player');
  const facade = document.getElementById('video-demo-facade');
  if (!player || !facade) return;

  const EMBED_URL = 'https://streamable.com/e/lf0tos?autoplay=1';
  let loaded = false;

  facade.addEventListener('click', function () {
    if (loaded) return;
    loaded = true;
    const iframe = document.createElement('iframe');
    iframe.src = EMBED_URL;
    iframe.title = 'Video explicativo de SuscripFy';
    iframe.className = 'video-demo__iframe';
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('loading', 'lazy');
    player.replaceChildren(iframe);
  });
})();

/* ============================================================
   ROTADOR DE ESTRATEGIAS DEL WIDGET (hero + paso 01)
   - El cambio lo dispara el fin de la animación de la barra del chip
     activo (CSS --rc-dur), así pausa y progreso siempre coinciden.
   - Pausa: mouse encima (solo puntero tipo mouse), foco de teclado
     dentro, fuera de pantalla o pestaña oculta.
   - prefers-reduced-motion: sin autoplay; los chips siguen funcionando.
   Guard obligatorio: main.js también lo cargan otras páginas, donde
   estos bloques NO existen.
   ============================================================ */
(function () {
  const heroRoot = document.getElementById('hero-rot');
  const wsRoot = document.getElementById('ws-rot');
  if (!heroRoot && !wsRoot) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function restartClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // fuerza reflow para reiniciar la animación
    el.classList.add(cls);
  }

  function createRotator(root, onShow) {
    const chips = Array.from(root.querySelectorAll('[data-chip]'));
    const scenes = Array.from(root.querySelectorAll('[data-scene]'));
    if (scenes.length < 2 || chips.length !== scenes.length) return null;

    let current = -1;
    let hovered = false;
    let focused = false;
    let inView = true;

    if (reduceMotion) root.classList.add('is-static');

    function show(index) {
      const prev = current;
      current = (index + scenes.length) % scenes.length;
      scenes.forEach((scene, i) => {
        const active = i === current;
        scene.classList.toggle('is-active', active);
        scene.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (!active) scene.classList.remove('is-enter');
      });
      chips.forEach((chip, i) => {
        chip.setAttribute('aria-pressed', i === current ? 'true' : 'false');
        chip.classList.remove('is-run');
      });
      if (!reduceMotion) {
        restartClass(chips[current], 'is-run');
        restartClass(scenes[current], 'is-enter');
      }
      if (onShow) onShow(current, prev, scenes[current]);
    }

    function sync() {
      root.classList.toggle('is-paused', hovered || focused || !inView || document.hidden);
    }

    chips.forEach((chip, i) => {
      chip.addEventListener('click', () => show(i));
      const bar = chip.querySelector('.rc-bar i');
      if (bar && !reduceMotion) {
        bar.addEventListener('animationend', () => { if (i === current) show(current + 1); });
      }
    });

    // Solo mouse: en táctil el "hover" queda pegado tras un toque.
    root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hovered = true; sync(); } });
    root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hovered = false; sync(); } });
    root.addEventListener('focusin', (e) => { if (e.target.matches(':focus-visible')) { focused = true; sync(); } });
    root.addEventListener('focusout', (e) => {
      if (root.contains(e.relatedTarget)) return;
      focused = false;
      sync();
    });
    document.addEventListener('visibilitychange', sync);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((entry) => { inView = entry.isIntersecting; });
        sync();
      }, { threshold: 0.3 }).observe(root);
    }

    show(0);
    return { show };
  }

  /* ---------- Hero: 4 tiendas, 4 estrategias ---------- */
  if (heroRoot) {
    const urlEl = heroRoot.querySelector('[data-url]');
    const notif = heroRoot.querySelector('[data-notif-box]');
    const notifText = heroRoot.querySelector('[data-notif-text]');
    createRotator(heroRoot, (i, prev, scene) => {
      if (urlEl) urlEl.textContent = scene.getAttribute('data-url') || '';
      if (notifText) notifText.textContent = scene.getAttribute('data-notif') || '';
      if (notif && prev !== -1 && !reduceMotion) restartClass(notif, 'is-pop');
    });
  }

  /* ---------- Paso 01: mismo producto, 4 estrategias ---------- */
  if (wsRoot) {
    const links = Array.from(document.querySelectorAll('[data-go]'));
    const fmt = new Intl.NumberFormat('es-CO');
    let rafId = 0;

    function tweenPrice(el, from, to) {
      const suffix = el.getAttribute('data-suffix') || '';
      cancelAnimationFrame(rafId);
      if (reduceMotion || !isFinite(from) || from === to) {
        el.textContent = '$' + fmt.format(to) + suffix;
        return;
      }
      const t0 = performance.now();
      const dur = 650;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = '$' + fmt.format(Math.round((from + (to - from) * eased) / 100) * 100) + suffix;
        if (p < 1) rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    }

    const scenes = wsRoot.querySelectorAll('[data-scene]');
    const rot = createRotator(wsRoot, (i, prev, scene) => {
      links.forEach((link) => {
        const modes = (link.getAttribute('data-modes') || '').split(',');
        link.classList.toggle('is-linked', modes.indexOf(String(i)) !== -1);
      });
      const priceEl = scene.querySelector('[data-price]');
      if (priceEl && prev !== -1) {
        const prevEl = scenes[prev].querySelector('[data-price]');
        tweenPrice(priceEl, Number(prevEl && prevEl.getAttribute('data-price')), Number(priceEl.getAttribute('data-price')));
      }
    });
    if (rot) {
      links.forEach((link) => link.addEventListener('click', () => rot.show(Number(link.getAttribute('data-go')) || 0)));
    }
  }
})();
