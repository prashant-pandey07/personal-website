(() => {
  const body = document.body;
  const root = document.documentElement;
  const themeToggle = document.querySelector('#theme-toggle');
  const themeToggleEnabled = root.dataset.themeToggle === 'enabled';
  const copyText = async value => {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(value); return true; } catch { /* Try the local fallback. */ }
    }
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    field.remove();
    return copied;
  };
  const applyTheme = theme => {
    const value = theme === 'light' ? 'light' : 'dark';
    root.dataset.theme = value;
    const next = value === 'dark' ? 'light' : 'dark';
    if (themeToggle) {
      themeToggle.setAttribute('aria-label', `Switch to ${next} theme`);
      themeToggle.title = `Switch to ${next} theme`;
      const icon = themeToggle.querySelector('.theme-icon');
      const label = themeToggle.querySelector('.theme-label');
      if (icon) icon.textContent = value === 'dark' ? '☼' : '☾';
      if (label) label.textContent = value === 'dark' ? 'Light' : 'Dark';
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#0a0f13' : '#f6f7f2');
  };
  applyTheme(themeToggleEnabled ? (root.dataset.theme || 'dark') : 'dark');
  if (themeToggleEnabled) themeToggle?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('site-theme', next); } catch { /* Storage can be disabled. */ }
  });

  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.site-nav');
  const closeMenu = () => {
    if (!toggle || !nav) return;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Menu';
    toggle.setAttribute('aria-label', 'Open menu');
    nav.classList.remove('open');
  };
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Close' : 'Menu';
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      nav.classList.toggle('open', open);
    });
    nav.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
    document.addEventListener('click', event => {
      if (toggle.getAttribute('aria-expanded') === 'true' && !nav.contains(event.target) && !toggle.contains(event.target)) closeMenu();
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
    if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const input = document.querySelector('#site-search');
      if (input) { event.preventDefault(); input.focus(); }
    }
  });

  const motionOkay = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealItems = [...document.querySelectorAll('.content-card, .browse-card, .topic-card, .social-card, .feature-card, .about-profile, .message-card, .home-intro, .section-heading')];
  if (motionOkay && 'IntersectionObserver' in window && revealItems.length) {
    body.classList.add('motion-ready');
    revealItems.forEach((node, index) => { node.classList.add('reveal'); node.dataset.delay = String(index % 4); });
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }), { rootMargin: '0px 0px -7% 0px', threshold: 0.08 });
    revealItems.forEach(node => observer.observe(node));
  }

  const input = document.querySelector('#site-search');
  const results = document.querySelector('#search-results');
  const status = document.querySelector('#search-status');
  const empty = document.querySelector('#search-empty');
  const filters = [...document.querySelectorAll('[data-filter]')];
  const clear = document.querySelector('#clear-search');
  if (input && results && status) {
    let documents = [];
    let activeFilter = 'all';
    const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    const draw = () => {
      const query = input.value.trim();
      const terms = normalize(query).split(/\s+/).filter(Boolean);
      const matches = documents.filter(doc => activeFilter === 'all' || doc.type === activeFilter).map(doc => {
        const title = normalize(doc.title), description = normalize(doc.description), tags = normalize((doc.tags || []).join(' ')), content = normalize(doc.content);
        const fields = `${title} ${description} ${tags} ${content}`;
        if (terms.length && !terms.every(term => fields.includes(term))) return null;
        const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 9 : title.startsWith(term) ? 3 : 0) + (tags.includes(term) ? 5 : 0) + (description.includes(term) ? 3 : 0) + (content.includes(term) ? 1 : 0), 0);
        return { doc, score };
      }).filter(Boolean).sort((a, b) => b.score - a.score || (a.doc.title || '').localeCompare(b.doc.title || '')).slice(0, 60);
      results.replaceChildren();
      matches.forEach(({ doc }) => {
        const article = document.createElement('article');
        article.className = 'content-card search-result-enter';
        const tagHtml = (doc.tags || []).slice(0, 3).map(tag => `<span class="tag">${escape(tag)}</span>`).join('');
        const dateHtml = doc.date_label ? ` <time>${escape(doc.date_label)}</time>` : '';
        article.innerHTML = `<div class="card-meta">${escape(doc.kind_label || doc.type)}${dateHtml}</div><h2><a href="${escape(doc.url)}">${escape(doc.title)}</a></h2><p>${escape(doc.description)}</p><div class="card-bottom"><div class="tag-list">${tagHtml}</div><a class="arrow-link" href="${escape(doc.url)}">Read <span>↗</span></a></div>`;
        results.append(article);
      });
      const hasQuery = Boolean(query) || activeFilter !== 'all';
      if (empty) empty.hidden = !hasQuery || matches.length > 0;
      if (!hasQuery) status.textContent = 'Search every published page by title, summary, topic, or text.';
      else if (!matches.length) status.textContent = query ? `No published pages match “${query}” in ${activeFilter === 'all' ? 'all sections' : activeFilter}.` : `No published pages in ${activeFilter} yet.`;
      else status.textContent = `${matches.length} result${matches.length === 1 ? '' : 's'}${query ? ` for “${query}”` : ''}${activeFilter !== 'all' ? ` in ${activeFilter}` : ''}.`;
      const url = new URL(window.location.href);
      if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
      if (activeFilter !== 'all') url.searchParams.set('section', activeFilter); else url.searchParams.delete('section');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    };
    fetch('../search-index.json').then(response => response.ok ? response.json() : Promise.reject()).then(data => { documents = Array.isArray(data) ? data : []; draw(); }).catch(() => { status.textContent = 'Search data could not load. Browse the sections below instead.'; });
    input.addEventListener('input', draw);
    filters.forEach(button => button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'all';
      filters.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      draw();
    }));
    clear?.addEventListener('click', () => { input.value = ''; input.focus(); draw(); });
    const params = new URLSearchParams(window.location.search);
    input.value = params.get('q') || '';
    const requestedFilter = params.get('section');
    if (filters.some(button => button.dataset.filter === requestedFilter)) {
      activeFilter = requestedFilter;
      filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === activeFilter)));
    }
  }

  document.querySelectorAll('[data-copy-email]').forEach(button => button.addEventListener('click', async () => {
    const value = button.dataset.copyEmail;
    const label = button.textContent;
    const copied = await copyText(value);
    button.textContent = copied ? 'Copied' : 'Select email to copy';
    window.setTimeout(() => { button.textContent = label; }, 1800);
  }));

  document.addEventListener('click', async event => {
    const button = event.target.closest('.copy-btn');
    if (!button) return;
    event.preventDefault();
    const codeBlock = button.closest('.code-block');
    const code = codeBlock?.querySelector('pre code, pre');
    if (!code) {
      button.textContent = 'Code unavailable';
      window.setTimeout(() => { button.textContent = '⌘ Copy'; }, 1800);
      return;
    }
    const originalLabel = button.textContent;
    const copied = await copyText(code.innerText || code.textContent || '');
    button.textContent = copied ? '✓ Copied' : 'Copy unavailable';
    button.setAttribute('aria-label', copied ? 'Code copied' : 'Could not copy code');
    window.setTimeout(() => {
      button.textContent = originalLabel;
      button.setAttribute('aria-label', 'Copy code sample');
    }, 1800);
  });

  const contactForm = document.querySelector('#contact-compose');
  if (contactForm) contactForm.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(contactForm);
    const email = contactForm.dataset.email;
    if (!email) { document.querySelector('#contact-status').textContent = 'Email is not configured yet. Please use one of the social links above.'; return; }
    const subject = `[Website] ${values.get('reason')} — ${values.get('name')}`;
    const bodyText = [`Name: ${values.get('name')}`, `Reply email: ${values.get('reply') || '(not provided)'}`, `Topic: ${values.get('reason')}`, '', String(values.get('message') || '')].join('\n');
    document.querySelector('#contact-status').textContent = 'Opening your email app with the draft. Review it there before sending.';
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
  });
})();
