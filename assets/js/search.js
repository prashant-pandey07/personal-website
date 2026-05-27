/* ============================================================
   SEARCH JS — Prashant Pandey
   Client-side full-text search across all content.
   Reads from /data/content.json so new content is automatically
   searchable — no JS edits needed.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- DOM Elements ---------- */
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  const resultsCount = document.getElementById('search-count');
  const noResults = document.getElementById('search-no-results');

  if (!searchInput || !resultsContainer) return;

  /* ---------- Search Index (loaded from JSON) ---------- */
  let searchIndex = [];

  /* ---------- Load content registry ---------- */
  fetch('/data/content.json')
    .then(res => res.json())
    .then(data => {
      searchIndex = (data.content || []).map(item => ({
        title: item.title,
        url: item.url,
        type: item.type,
        tags: Array.isArray(item.tags) ? item.tags.join(',') : (item.tags || ''),
        desc: item.desc || ''
      }));

      // Also add section index pages for discoverability
      const sectionPages = [
        { title: 'Projects', url: '/projects/', type: 'Section', tags: 'projects,portfolio,software', desc: 'Browse all software projects and tools built by Prashant Pandey.' },
        { title: 'Research', url: '/research/', type: 'Section', tags: 'research,articles,technical', desc: 'Technical research articles and engineering essays by Prashant Pandey.' },
        { title: 'Blog', url: '/blog/', type: 'Section', tags: 'blog,writing,tutorials', desc: 'Technical blog posts, build logs, and tutorials.' },
        { title: 'Ideas & Theories', url: '/ideas/', type: 'Section', tags: 'ideas,theory,future,concepts', desc: 'Original concepts, future systems, and experimental ideas.' },
        { title: 'Contact', url: '/contact/', type: 'Page', tags: 'contact,email,message', desc: 'Get in touch with Prashant Pandey.' }
      ];
      searchIndex = searchIndex.concat(sectionPages);

      // If URL has ?q= param, run search immediately
      const params = new URLSearchParams(window.location.search);
      const initQuery = params.get('q');
      if (initQuery) {
        searchInput.value = initQuery;
        doSearch(initQuery);
      } else {
        searchInput.focus();
      }
    })
    .catch(() => {
      // Fallback: if fetch fails, search will just return no results
      searchInput.focus();
    });

  /* ---------- Debounce ---------- */
  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /* ---------- Highlight match ---------- */
  function highlight(text, query) {
    if (!query) return text;
    const regex = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  /* ---------- Render Results ---------- */
  function renderResults(results, query) {
    resultsContainer.innerHTML = '';

    if (resultsCount) {
      resultsCount.textContent = results.length + ' result' + (results.length !== 1 ? 's' : '');
    }

    if (results.length === 0) {
      if (noResults) noResults.style.display = 'block';
      return;
    }

    if (noResults) noResults.style.display = 'none';

    results.forEach(item => {
      const div = document.createElement('a');
      div.href = item.url;
      div.className = 'search-result card card--link';
      const tagsStr = item.tags || '';
      div.innerHTML = `
        <div class="search-result__type badge">${item.type}</div>
        <h3 class="search-result__title">${highlight(item.title, query)}</h3>
        <p class="search-result__desc">${highlight(item.desc, query)}</p>
        <div class="search-result__tags">
          ${tagsStr.split(',').filter(Boolean).map(t => `<span class="tag-chip">${t.trim()}</span>`).join('')}
        </div>`;
      resultsContainer.appendChild(div);
    });
  }

  /* ---------- Search Function ---------- */
  function doSearch(query) {
    const q = query.trim().toLowerCase();

    if (!q) {
      resultsContainer.innerHTML = '';
      if (resultsCount) resultsCount.textContent = '';
      if (noResults) noResults.style.display = 'none';
      return;
    }

    const results = searchIndex.filter(item => {
      const haystack = (item.title + ' ' + item.desc + ' ' + item.tags + ' ' + item.type).toLowerCase();
      return haystack.includes(q);
    });

    // Sort by relevance: title matches first
    results.sort((a, b) => {
      const aTitle = a.title.toLowerCase().includes(q) ? 0 : 1;
      const bTitle = b.title.toLowerCase().includes(q) ? 0 : 1;
      return aTitle - bTitle;
    });

    renderResults(results, q);
  }

  /* ---------- Event Listeners ---------- */
  searchInput.addEventListener('input', debounce(function () {
    doSearch(this.value);
  }, 220));

  // Global search bar (nav or hero)
  const globalSearch = document.getElementById('global-search');
  if (globalSearch) {
    globalSearch.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && this.value.trim()) {
        window.location.href = '/search/?q=' + encodeURIComponent(this.value.trim());
      }
    });
  }
})();
