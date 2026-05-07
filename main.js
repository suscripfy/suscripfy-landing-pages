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
