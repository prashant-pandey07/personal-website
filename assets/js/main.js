/* ============================================================
   MAIN JS — Prashant Pandey
   Nav · Scroll · Animations · Back-to-Top · Mobile menu
   ============================================================ */

(function () {
  'use strict';

  /* ---------- Nav Scroll Behaviour ---------- */
  const nav = document.querySelector('.nav');
  const scrollProgress = document.querySelector('.scroll-progress');

  function onScroll() {
    const scrollY = window.scrollY;
    const docH = document.documentElement.scrollHeight - window.innerHeight;

    if (nav) {
      nav.classList.toggle('scrolled', scrollY > 30);
    }

    if (scrollProgress) {
      const pct = docH > 0 ? (scrollY / docH) * 100 : 0;
      scrollProgress.style.width = pct + '%';
    }

    if (backToTop) {
      backToTop.classList.toggle('visible', scrollY > 400);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Back to Top ---------- */
  const backToTop = document.querySelector('.back-to-top');
  if (backToTop) {
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- Mobile Nav ---------- */
  const navToggle = document.querySelector('.nav__toggle');
  const navMobile = document.querySelector('.nav__mobile');

  if (navToggle && navMobile) {
    navToggle.addEventListener('click', () => {
      const isOpen = navMobile.classList.toggle('open');
      navToggle.classList.toggle('open', isOpen);
      navToggle.setAttribute('aria-expanded', isOpen);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target)) {
        navMobile.classList.remove('open');
        navToggle.classList.remove('open');
      }
    });

    // Close on nav link click
    navMobile.querySelectorAll('.nav__link').forEach(link => {
      link.addEventListener('click', () => {
        navMobile.classList.remove('open');
        navToggle.classList.remove('open');
      });
    });
  }

  /* ---------- Active Nav Link ---------- */
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav__link').forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;
    const isRoot = href === '/' || href === '/index.html';
    const isActive = isRoot
      ? (currentPath === '/' || currentPath === '/index.html')
      : currentPath.startsWith(href.replace(/\/$/, ''));
    link.classList.toggle('active', isActive);
  });

  /* ---------- Intersection Observer — fade-up animations ---------- */
  const animEls = document.querySelectorAll('.animate-fade-up');
  if ('IntersectionObserver' in window && animEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.animationPlayState = 'running';
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    animEls.forEach(el => {
      el.style.animationPlayState = 'paused';
      io.observe(el);
    });
  }

  /* ---------- Filter Buttons (Projects / Blog / etc.) ---------- */
  const filterBtns = document.querySelectorAll('.filter-btn');
  const filterItems = document.querySelectorAll('[data-tags]');

  if (filterBtns.length && filterItems.length) {
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;

        filterItems.forEach(item => {
          if (filter === 'all') {
            item.style.display = '';
          } else {
            const tags = (item.dataset.tags || '').split(',').map(t => t.trim());
            item.style.display = tags.includes(filter) ? '' : 'none';
          }
        });
      });
    });
  }

  /* ---------- Smooth anchor links ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const id = this.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        const offsetTop = target.getBoundingClientRect().top + window.scrollY - 84;
        window.scrollTo({ top: offsetTop, behavior: 'smooth' });
      }
    });
  });

  /* ---------- Current year in footer ---------- */
  const yearEls = document.querySelectorAll('.js-year');
  const year = new Date().getFullYear();
  yearEls.forEach(el => { el.textContent = year; });

  /* ---------- Initial call ---------- */
  onScroll();
})();
