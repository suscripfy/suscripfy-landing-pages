'use strict';

/* ── WhatsApp config ── */
const WA_NUMBER = '573104513138'; // TODO: reemplazar con número colombiano real
const WA_MSG    = encodeURIComponent('Hola, quiero saber más sobre SuscripFy');
const WA_URL    = `https://wa.me/${WA_NUMBER}?text=${WA_MSG}`;

// Inyectar URLs (los elementos se definen en HTML con href="#" como placeholder)
document.addEventListener('DOMContentLoaded', () => {
  const navBtn    = document.getElementById('wa-nav-btn');
  const floatLink = document.getElementById('wa-float-link');
  if (navBtn)    navBtn.href    = WA_URL;
  if (floatLink) floatLink.href = WA_URL;
});

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
   WHATSAPP FLOATING BUTTON — dismiss logic
   ============================================================ */
(function () {
  const WA_KEY  = 'wa_float_dismissed';
  const waFloat = document.getElementById('wa-float');
  const waClose = document.getElementById('wa-float-close');
  if (!waFloat || !waClose) return;

  // Si ya fue descartado, ocultar permanentemente
  if (localStorage.getItem(WA_KEY) === '1') {
    waFloat.classList.add('is-dismissed');
    return;
  }

  // Mostrar con delay para no ser invasivo en carga
  setTimeout(() => waFloat.classList.add('is-visible'), 1200);

  waClose.addEventListener('click', () => {
    waFloat.classList.remove('is-visible');
    // Esperar a que termine la transición antes de ocultar del DOM
    setTimeout(() => waFloat.classList.add('is-dismissed'), 350);
    localStorage.setItem(WA_KEY, '1');
  });
})();

/* ============================================================
   ALIGN WHATSAPP FLOAT ABOVE TIDIO WIDGET
   ============================================================ */
(function () {
  var waFloat = document.getElementById('wa-float');
  if (!waFloat) return;

  function alignAboveTidio() {
    var tidio = document.getElementById('tidio-chat');
    if (!tidio) return;
    var rect = tidio.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    var rightPx = window.innerWidth - rect.right;
    var centerX = rect.left + rect.width / 2;
    var waBtnW = 60;
    waFloat.style.right = (window.innerWidth - centerX - waBtnW / 2) + 'px';
    waFloat.style.bottom = (window.innerHeight - rect.top + 16) + 'px';
    waFloat.querySelector('.wa-float__btn').style.width = rect.width + 'px';
    waFloat.querySelector('.wa-float__btn').style.height = rect.height + 'px';
  }

  var observer = new MutationObserver(function () {
    if (document.getElementById('tidio-chat')) {
      setTimeout(alignAboveTidio, 800);
      window.addEventListener('resize', alignAboveTidio);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
