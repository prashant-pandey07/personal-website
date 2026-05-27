/* ============================================================
   TOC JS — Prashant Pandey
   Table of Contents · Active heading highlight · Reading progress
   ============================================================ */

(function () {
  'use strict';

  const tocContainer = document.querySelector('.toc-list');
  const articleContent = document.querySelector('.article-content');

  if (!tocContainer || !articleContent) return;

  /* ---------- Build TOC from headings ---------- */
  const headings = articleContent.querySelectorAll('h2, h3');
  if (!headings.length) return;

  headings.forEach((heading, i) => {
    // Ensure each heading has an ID
    if (!heading.id) {
      heading.id = 'heading-' + i + '-' + heading.textContent.trim()
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    const a = document.createElement('a');
    a.href = '#' + heading.id;
    a.textContent = heading.textContent;
    a.className = heading.tagName === 'H3' ? 'toc-h3' : '';

    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(heading.id);
      if (target) {
        const offset = target.getBoundingClientRect().top + window.scrollY - 84;
        window.scrollTo({ top: offset, behavior: 'smooth' });
      }
    });

    tocContainer.appendChild(a);
  });

  /* ---------- Active heading on scroll ---------- */
  let activeId = null;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        activeId = entry.target.id;
        updateActive();
      }
    });
  }, {
    rootMargin: '-80px 0px -60% 0px',
    threshold: 0
  });

  headings.forEach(h => observer.observe(h));

  function updateActive() {
    tocContainer.querySelectorAll('a').forEach(a => {
      const isActive = a.getAttribute('href') === '#' + activeId;
      a.classList.toggle('active', isActive);
    });
  }
})();
