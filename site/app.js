// The site's only script. No framework, nothing fetched.
//
// Four small jobs: render the catalogue from data.js, colour the code samples,
// switch the page between English and French, and the usual copy button.
//
// The language toggle exists because every mod in this repository is required
// to ship English and French, and the panel is held to the same rule. A page
// presenting that project in one language would be the odd one out.

(() => {
  const catalogue = window.CATALOGUE ?? { themes: [], plugins: [] };

  /* Catalogue --------------------------------------------------------- */

  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
  };

  /*
   * A mod's sentence, in both languages, handed to the toggle below.
   *
   * The page already swaps anything carrying data-en/data-fr, so a card's
   * description only has to declare both and the existing machinery does the
   * rest -- rather than a second, parallel way of being bilingual.
   */
  const describe = (mod) => {
    const node = el('p', { textContent: mod.description });
    node.dataset.en = mod.description;
    node.dataset.fr = mod.descriptions?.fr ?? mod.description;
    return node;
  };

  /** The mark, inlined by the build so a card needs no extra request. */
  const mark = (mod) => {
    if (!mod.icon) return null;
    const box = el('span', { className: 'card__icon' });
    box.innerHTML = mod.icon;
    return box;
  };

  const gallery = document.getElementById('theme-gallery');
  for (const theme of catalogue.themes) {
    const strip = el('div', { className: 'theme__strip' });
    for (const colour of theme.palette) {
      const band = el('span');
      band.style.background = colour;
      strip.append(band);
    }

    const heading = el('div', { className: 'card__heading' });
    const themeMark = mark(theme);
    if (themeMark) heading.append(themeMark);
    heading.append(el('h3', { textContent: theme.name }));

    const body = el('div', { className: 'theme__body' }, [heading, describe(theme)]);

    if (theme.requires.length) {
      body.append(el('div', { className: 'card__meta' }, [
        el('span', {
          className: 'tag',
          textContent: `needs ${theme.requires.join(', ')}`,
        }),
      ]));
    }

    const card = el('article', { className: 'theme reveal' });
    if (theme.shot) {
      card.append(el('img', {
        className: 'theme__shot',
        src: theme.shot,
        alt: `Slack wearing the ${theme.name} theme`,
        loading: 'lazy',
      }));
    }
    card.append(strip, body);
    gallery?.append(card);
  }

  const plugins = document.getElementById('plugin-list');
  for (const plugin of catalogue.plugins) {
    const meta = el('div', { className: 'card__meta' });
    for (const tag of plugin.tags.slice(0, 3)) meta.append(el('span', { className: 'tag', textContent: tag }));
    if (plugin.settings > 0) {
      meta.append(el('span', {
        className: 'tag tag--settings',
        textContent: `${plugin.settings} setting${plugin.settings > 1 ? 's' : ''}`,
      }));
    }
    const heading = el('div', { className: 'card__heading' });
    const pluginMark = mark(plugin);
    if (pluginMark) heading.append(pluginMark);
    heading.append(el('h3', { textContent: plugin.name }));

    const card = el('article', { className: 'card reveal' });
    // A plugin is a thing you can see, so the card shows it rather than
    // describing it. Same file the panel shows on the mod's own page.
    if (plugin.shot) {
      card.append(el('img', {
        className: 'card__shot',
        src: plugin.shot,
        alt: `${plugin.name} at work inside Slack`,
        loading: 'lazy',
      }));
    }
    card.append(heading, describe(plugin), meta);
    plugins?.append(card);
  }

  const count = document.getElementById('mod-count');
  if (count) count.textContent = String(catalogue.themes.length + catalogue.plugins.length);

  const version = document.getElementById('version');
  if (version && catalogue.version) version.textContent = `v${catalogue.version}`;

  /* Syntax colours ----------------------------------------------------- */

  // Deliberately not a parser: comments, strings, keys, keywords and numbers,
  // which is everything you need to read a twelve-line sample. It runs over
  // escaped HTML, so it works on the markup already in the page.
  const RULES = [
    [/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, 'tok-comment'],
    [/('[^'\n]*'|"[^"\n]*"|`[^`]*`)/g, 'tok-string'],
    [/(--[\w-]+|\.[a-z][\w-]*(?=\s*\{)|[\w-]+(?=\s*:))/g, 'tok-key'],
    [/\b(await|const|export|default|function|return|new|import|from|let|true|false|null)\b/g, 'tok-word'],
    [/\b(\d+(?:\.\d+)?(?:px|em|ms|_?\d*)?)\b/g, 'tok-number'],
  ];

  for (const block of document.querySelectorAll('.tabs__panel code, .mini code')) {
    let html = block.innerHTML;
    // Protected spans first, or a later rule would colour inside an earlier
    // one's markup. Each pass skips anything already wrapped.
    for (const [pattern, cls] of RULES) {
      html = html.replace(pattern, (match, ...rest) => {
        const offset = rest[rest.length - 2];
        const source = rest[rest.length - 1];
        const before = source.slice(0, offset);
        const open = before.lastIndexOf('<span');
        const close = before.lastIndexOf('</span>');
        if (open > close) return match;               // already inside a token
        return `<span class="${cls}">${match}</span>`;
      });
    }
    block.innerHTML = html;
  }

  /* Tabs --------------------------------------------------------------- */

  const tabs = document.getElementById('code-tabs');
  tabs?.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      tabs.querySelectorAll('[data-tab]').forEach((other) =>
        other.setAttribute('aria-selected', String(other === button)));
      tabs.querySelectorAll('[data-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== button.dataset.tab;
      });
    });
  });

  /* Copy --------------------------------------------------------------- */

  for (const snippet of document.querySelectorAll('[data-copy]')) {
    const button = snippet.querySelector('.snippet__copy');
    button?.addEventListener('click', async () => {
      const text = snippet.querySelector('code').innerText;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Focus can be elsewhere, and a clipboard write is refused then.
        const area = document.createElement('textarea');
        area.value = text;
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      const was = button.textContent;
      button.textContent = language === 'fr' ? 'Copié' : 'Copied';
      setTimeout(() => { button.textContent = was; }, 1400);
    });
  }

  /* English and French -------------------------------------------------- */

  let language = (navigator.language || 'en').startsWith('fr') ? 'fr' : 'en';

  const apply = () => {
    document.documentElement.lang = language;
    for (const node of document.querySelectorAll('[data-en]')) {
      const text = node.dataset[language];
      if (text) node.textContent = text;
    }
    const toggle = document.getElementById('lang');
    if (toggle) {
      toggle.textContent = language === 'fr' ? 'EN' : 'FR';
      toggle.setAttribute('aria-label', language === 'fr' ? 'English' : 'Français');
    }
  };

  document.getElementById('lang')?.addEventListener('click', () => {
    language = language === 'fr' ? 'en' : 'fr';
    localStorage.setItem('betterslack-site-lang', language);
    apply();
  });

  const saved = localStorage.getItem('betterslack-site-lang');
  if (saved === 'fr' || saved === 'en') language = saved;
  apply();

  /* Reveal on scroll ---------------------------------------------------- */

  const targets = document.querySelectorAll('.card, .theme, .split__shot, .hero__shot, .wide');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    targets.forEach((node) => {
      node.classList.add('reveal');
      observer.observe(node);
    });
  }
})();
