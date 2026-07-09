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
