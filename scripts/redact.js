// Replace everything on screen that belongs to somebody, before a picture is
// taken of it.
//
// The screenshots in this repository are taken against a real, signed-in Slack,
// because that is the only place the mods do anything. The workspace they are
// taken in belongs to a company: names, faces, messages, channel names, files.
// None of that may end up in a public README, and "I opened a quiet channel
// first" is not a policy.
//
// So this replaces rather than hides. Blurring leaves shapes and lengths, and a
// blurred name is still a name that was on the screen; a black box says the
// picture had something to hide. Substitution gives a picture that looks like
// Slack in use and contains nobody.
//
// The rule is whitelist, not blacklist: inside the containers listed below,
// *every* text node is rewritten unless it is BetterSlack's own interface.
// Deciding what looks sensitive is how a real name survives into a picture.
//
// Substitutions are derived from a hash of the original, so the same person is
// the same invented person everywhere in a frame -- the sidebar, the messages,
// the member list -- and two runs produce the same picture.

(() => {
  const FIRST = ['Ada', 'Bea', 'Cleo', 'Dara', 'Emil', 'Fritz', 'Gil', 'Hana', 'Iris', 'Jonas',
    'Kit', 'Lena', 'Milo', 'Nora', 'Otto', 'Pia', 'Quinn', 'Remy', 'Sasha', 'Tomas', 'Uma', 'Vera'];
  const LAST = ['Almeida', 'Bauer', 'Costa', 'Dubois', 'Engel', 'Ferrand', 'Gray', 'Holm', 'Iversen',
    'Janssen', 'Klein', 'Lindqvist', 'Moreau', 'Novak', 'Oliveira', 'Petit', 'Rossi', 'Silva'];
  const CHANNELS = ['design', 'general', 'releases', 'standup', 'support', 'random', 'incidents',
    'hiring', 'roadmap', 'watercooler', 'frontend', 'infra', 'marketing', 'onboarding'];
  // Names people give the groups in their own sidebar. Short, so the heading
  // stays a heading: run through `invent` they came out as whole sentences and
  // the sidebar read like a second message list.
  const SECTIONS = ['Projets', 'Équipe', 'Produit', 'Design', 'Support', 'Veille', 'Archives'];
  const WORDS = ['the release notes are up', 'shipping this afternoon', 'nice, thanks for the fix',
    'can you take a look when you have a minute', 'that matches what I saw', 'rebased and green',
    'let us do it after the demo', 'good catch', 'I will pick it up tomorrow', 'agreed',
    'that is the last one on my list', 'moved it to next week', 'looks right to me'];

  /*
   * Code blocks.
   *
   * A `pre` full of somebody's SQL is as private as a message, so it goes --
   * but replacing it with prose, which is what the sentence branch did, turns
   * the one screenshot that is supposed to show syntax highlighting into a
   * paragraph in a box. These are code, in the languages the highlighter knows.
   */
  const SNIPPETS = [
    "const shipped = releases.filter((r) => r.stage === 'live');\nexport function latest(list) {\n  return list.sort((a, b) => b.at - a.at)[0];\n}",
    "def digest(rows):\n    counts = {}\n    for row in rows:\n        counts[row.channel] = counts.get(row.channel, 0) + 1\n    return sorted(counts.items(), key=lambda kv: -kv[1])",
    "select channel, count(*) as messages\nfrom events\nwhere sent_at > now() - interval '7 days'\ngroup by channel\norder by messages desc\nlimit 10;",
    "{\n  \"id\": \"weekly-digest\",\n  \"enabled\": true,\n  \"channels\": [\"releases\", \"support\"],\n  \"hour\": 9\n}",
  ];

  const hash = (text) => {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  };
  const pick = (list, seed) => list[hash(seed) % list.length];

  /*
   * Long on purpose. Slack shortens a long address to `host/path…` and Full
   * Links puts it back, so a screenshot of that mod needs an address long
   * enough to have been shortened; a tidy `example.com/449` showed nothing.
   */
  const fakeUrl = (seed) => `https://example.com/${pick(CHANNELS, seed)}/2026-08/`
    + `build-${(hash(seed) % 9000) + 1000}/notes?ref=slack-digest&source=weekly`;

  const memo = new Map();
  const invent = (text) => {
    const original = text.trim();
    if (!original) return text;
    if (memo.has(original)) return memo.get(original);

    let replacement;
    if (/^(https?:\/\/|www\.)/i.test(original) || /\.(com|net|org|io|dev|fr|co)\b/i.test(original)) {
      /*
       * An internal URL is a company's map: hostnames, project names, ticket
       * numbers. The first version left them untouched and a real
       * `gitlab.<company>.com/<team>/<project>/-/merge_requests/719` sat in the
       * middle of an otherwise clean picture.
       */
      replacement = fakeUrl(original);
    } else if (/^[#@]/.test(original)) {
      replacement = original[0] + pick(CHANNELS, original);
    } else if (/^\d{1,2}\s?[h:]\s?\d{2}/.test(original) || /^\d+$/.test(original)) {
      // Times and counts are not anybody's, and inventing them makes a picture
      // look wrong for no gain.
      replacement = original;
    } else if (original.split(/\s+/).length <= 3 && /^[\p{Lu}]/u.test(original)) {
      // Something short that starts with a capital reads as a name.
      replacement = `${pick(FIRST, original)} ${pick(LAST, original + '!')}`;
    } else if (original.length < 24) {
      replacement = pick(CHANNELS, original);
    } else {
      // A sentence: keep roughly the shape, so the layout is honest.
      const parts = [];
      let seed = original;
      while (parts.join(' ').length < original.length && parts.length < 6) {
        parts.push(pick(WORDS, seed));
        seed += '.';
      }
      replacement = parts.join('. ');
    }
    memo.set(original, replacement);
    return text.replace(original, replacement);
  };

  /** A face nobody has: initials on a colour, as a data URL. */
  const face = (seed) => {
    const hue = hash(seed) % 360;
    const initials = `${pick(FIRST, seed)[0]}${pick(LAST, seed + '!')[0]}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
      + `<rect width="64" height="64" fill="hsl(${hue} 45% 45%)"/>`
      + `<text x="32" y="41" font-family="Lato, sans-serif" font-size="26" font-weight="700"`
      + ` fill="#fff" text-anchor="middle">${initials}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  };

  /*
   * Where somebody's words are, named precisely.
   *
   * Two wrong versions came before this one. The first listed containers and
   * missed three -- the member column a mod draws, the palette's list of real
   * conversations, the signed-in face in the rail. The second swept the whole
   * document and replaced Slack's own labels with it: "Accueil" became a
   * person's name, every button changed width, and the picture was of an
   * application nobody has ever used.
   *
   * So: the places that hold *content*, and nothing that holds Slack's
   * furniture. What makes this safe is not the list -- a list can always miss
   * one -- it is that the caller compares the screen before and after and
   * refuses to take the picture if anything survived. A missed selector is a
   * failed run, which is a bug report; it is not a leak.
   */
  const TEXT_AREAS = [
    // Conversations, wherever they are named.
    // Measured against the client rather than remembered: the name button's
    // own data-qa is gone from Slack 4.51, and a selector that matches nothing
    // is a hole in the sweep that nothing announces.
    { sel: '[data-qa="channel-sidebar-channel"]', as: CHANNELS },
    { sel: '.p-channel_sidebar__name', as: CHANNELS },
    '[data-qa="channel_name"]', '.p-view_header__text', '.p-view_header__channel_title',
    // The sidebar's section headings, which people name themselves -- "Biz",
    // "Mep", "Paiement". Matched on a class *fragment* on purpose: these are
    // CSS-module names (`labelContent__ND43C`) whose hash changes with every
    // Slack build, and the readable half in front of it does not.
    { sel: '[class*="labelContent"]', as: SECTIONS },
    { sel: '[class*="sectionHeading"]', as: SECTIONS },
    // A half-written message is still a message, and the grey prompt behind it
    // carries the channel's name -- "Envoyer un message a #<name>" -- which is
    // as public as the header. Found by the audit, not by looking.
    { sel: '.ql-editor', as: WORDS },
    { sel: '.c-texty_input__placeholder', as: CHANNELS },
    { sel: '.ql-placeholder', as: CHANNELS },
    // Not drawn, but Slack narrates every navigation into it for screen
    // readers, names and all.
    { sel: '.c-aria_live_announcer_api', as: CHANNELS },
    // Messages: who, and what.
    '[data-qa="message_sender"]', '.c-message__sender', '.c-message__sender_button',
    '[data-qa="message-text"]', '.p-rich_text_block', '.c-message_kit__blocks',
    // A link Slack unfurled is a card with somebody's title, text and author
    // in it -- the whole card goes, not the two fields it used to be.
    '.c-message_attachment',
    // A bare span inside a virtual row: Slack's activity and search views put
    // the message there rather than in a message-kit block, and one slipped
    // through. Direct children only, so the sidebar rows keep their names.
    '.c-virtual_list__item > span',
    // Files, and the boxes Slack builds around them.
    '.p-file_container', '.c-file_gallery', '[data-qa="file_name"]',
    // People, wherever they are listed -- including the card Slack puts at the
    // top of a conversation you have not written in yet, which carries a name
    // and a job title and is not part of the profile pane.
    '[data-qa="member_profile_pane"]', '.p-ia_details_popover',
    '[class*="p-new_im_foreword"]', '.c-base_entity__text-contents',
    /*
     * What the mods themselves draw out of the workspace -- the fields that
     * hold it, not the containers. Sweeping the whole palette turned its own
     * headings ("Conversations", "People") into people's names and its glyphs
     * into channel names, and the picture was of software nobody wrote.
     */
    '.betterslack-members__name', '.betterslack-members__note',
    '.betterslack-me__name', '.betterslack-me__status',
    // The top bar's search, which remembers what was typed into it.
    '[data-qa="top_nav_search"]', '.p-top_nav__search__container',
  ];
  /*
   * BetterSlack's own words, left alone and left out of the audit.
   *
   * The panel, and the fixed copy in a mod's dialog -- a hint under a field, a
   * title. A word in there is one the mods wrote, so it is neither something
   * to replace nor something that "came back": the run failed once on
   * "machine", from the sentence "kept on this machine only".
   */
  /*
   * BetterSlack's own words: left alone, and left out of the audit.
   *
   * Named one by one rather than by the `betterslack-` prefix, because some of
   * what the mods draw is the workspace -- the palette's rows, the member
   * column's names -- and those have to be replaced like everything else. What
   * is listed here is fixed copy: the panel, a toast, a hint under a field,
   * the strip Focus Mode leaves on screen. The run failed on "sortir", out of
   * that last one.
   */
  const KEEP = '#betterslack-panel, #betterslack-toast-host, #betterslack-focus-indicator,'
    + ' .betterslack-hint, .betterslack-widget_titles';

  /*
   * Nodes already dealt with.
   *
   * Without this the observer below is a loop that freezes the renderer:
   * rewriting a text node is a mutation, the mutation calls the sweep, and the
   * sweep invents a new name for the name it just invented. This project has
   * frozen Slack twice on exactly that shape, so the guard is a WeakSet *and*
   * the observer is disconnected while the sweep runs.
   */
  const done = new WeakSet();

  const redactText = (root, as, index = 0) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    for (const node of nodes) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      if (done.has(node)) continue;
      if (node.parentElement?.closest(KEEP)) continue;
      // `as` is a short list to draw from: a heading stays a heading, a draft
      // stays one line. Without it everything long becomes a paragraph.
      node.nodeValue = as ? as[(index + hash(node.nodeValue)) % as.length] : invent(node.nodeValue);
      done.add(node);
    }
  };

  /** Links carry the address twice: as text, and as somewhere to go. */
  const redactLinks = (root) => {
    for (const anchor of root.querySelectorAll('a[href]')) {
      if (anchor.closest(KEEP)) continue;
      const href = anchor.getAttribute('href') ?? '';
      // A mention is a link to a person: no host, but a user id all the same.
      if (/^\/team\/U/i.test(href)) {
        anchor.setAttribute('href', '/team/U0000000000');
        continue;
      }
      if (!/^https?:/i.test(href)) continue;
      const invented = fakeUrl(href);
      anchor.setAttribute('href', invented);
      /*
       * Kept rather than removed, and set to the same invented address: it is
       * what Slack copies, what Full Links reads to restore a shortened label,
       * and -- left alone -- what would put the real one back on screen the
       * moment that mod ran.
       */
      if (anchor.hasAttribute('data-stringify-link')) anchor.setAttribute('data-stringify-link', invented);
      anchor.removeAttribute('title');
      anchor.removeAttribute('aria-label');
    }
  };

  const redactFaces = (root) => {
    for (const img of root.querySelectorAll('img')) {
      if (done.has(img) || img.closest(KEEP)) continue;
      const src = img.getAttribute('src') ?? '';
      // Everything that came off the network, whatever the host: an avatar, a
      // custom emoji, a file thumbnail, the picture somebody pasted. Matching
      // known hosts left the file thumbnails in the first version, and one of
      // them was a poster somebody had shared.
      if (!/^https?:/i.test(src)) continue;
      img.setAttribute('src', face(src));
      img.removeAttribute('srcset');
      img.removeAttribute('alt');
      done.add(img);
    }
    // Anything painted as a background rather than drawn as an image.
    for (const el of root.querySelectorAll('[style*="url("]')) {
      if (el.closest(KEEP)) continue;
      el.style.backgroundImage = 'none';
      el.style.background = 'rgba(127,127,127,.18)';
    }
    redactLinks(root);
  };

  const run = () => {
    /*
     * Code blocks first, and past the highlighter's own output.
     *
     * Code Highlight replaces the block with a tokenised copy of itself, so by
     * the time the areas below are swept there are two versions of the same
     * code on screen and the sweep turns both into words -- which is how the
     * screenshot of a syntax highlighter came back as coloured prose. Slack's
     * own nodes are the ones to write to; the copy is thrown away and rebuilt
     * when the caller switches that mod off and on again.
     */
    for (const pre of document.querySelectorAll('pre.c-mrkdwn__pre')) {
      if (done.has(pre) || pre.closest(KEEP)) continue;
      const snippet = pick(SNIPPETS, pre.textContent ?? 'x');
      const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement?.closest('.betterslack-hl')) nodes.push(node);
      }
      // Written into the nodes Slack already made rather than through
      // `textContent`: removing a child of a node React owns is what earns a
      // "removeChild on a node that is not a child" at its next render.
      nodes.forEach((node, index) => { node.nodeValue = index === 0 ? snippet : ''; });
      for (const node of nodes) done.add(node);
      done.add(pre);
    }

    for (const entry of TEXT_AREAS) {
      const selector = typeof entry === 'string' ? entry : entry.sel;
      const areas = [...document.querySelectorAll(selector)];
      areas.forEach((area, index) => {
        // Walked in order and seeded by position, so a sidebar of six sections
        // gets six different names: hashing their real names gave "Projets"
        // three times, which reads as a bug in Slack rather than a workspace.
        redactText(area, typeof entry === 'string' ? undefined : entry.as, index);
      });
    }
    /*
     * Pictures and links are swept document-wide rather than by area: Slack's
     * own furniture has no remote images and no outside links, so there is
     * nothing here to spare, and the leaks that mattered -- a file thumbnail, a
     * link to an internal host -- were both outside the text areas above.
     */
    /*
     * The palette lists two different things through one class: the
     * workspace's conversations and people, and the mods' own commands. Only
     * the first is anybody's. The badge on the right is what tells them apart
     * -- a row that says "Canal" came out of Slack, a row that says "Command
     * Palette" came out of a mod -- and a row whose badge is neither is left
     * alone and then fails the audit, which is the outcome to want.
     */
    for (const row of document.querySelectorAll('.betterslack-palette__row')) {
      const source = row.querySelector('.betterslack-palette__source')?.textContent ?? '';
      if (!/canal|channel|message direct|direct message/i.test(source)) continue;
      const text = row.querySelector('.betterslack-palette__text');
      if (text) redactText(text);
    }

    redactFaces(document.body);
    /*
     * Labels a screen reader would read.
     *
     * `aria-label="Afficher le profil de <a real name>"` is on every avatar in
     * the message list. None of it is drawn, so none of it can reach a picture
     * -- but Slack builds a tooltip out of a `title`, and a picture taken with
     * the pointer resting anywhere is a picture with a real name in it.
     */
    for (const el of document.querySelectorAll('[aria-label], [title], [alt]')) {
      if (el.closest(KEEP) || done.has(el)) continue;
      for (const name of ['aria-label', 'title', 'alt']) {
        const value = el.getAttribute(name);
        if (value && value.trim()) el.setAttribute(name, invent(value));
      }
      done.add(el);
    }
    // The workspace, wherever it is written.
    for (const el of document.querySelectorAll('.p-ia4_sidebar_header__title, .p-team_sidebar__item, [data-qa="team-name"]')) {
      if (el.textContent?.trim()) el.textContent = 'Northwind';
    }
    document.title = 'Slack';
  };

  const watch = { childList: true, subtree: true, characterData: true };
  const observer = new MutationObserver(() => {
    // Disconnected around the sweep, or its own writes call it back.
    observer.disconnect();
    try { run(); } finally { observer.observe(document.body, watch); }
  });

  /*
   * Installed, not started.
   *
   * The caller has to read the screen *before* anything is replaced -- that
   * sample is what it audits against afterwards -- so sweeping on injection
   * would destroy the only evidence there is. `start()` is the sweep.
   */
  window.__betterslackRedaction = {
    run,
    start: () => {
      run();
      // Slack keeps rendering: a message arriving after the first sweep would
      // be real, and the picture is taken seconds later.
      observer.observe(document.body, watch);
      return 'redacted';
    },
    /*
     * What this script puts on screen.
     *
     * The caller compares before and after to prove nothing survived, and its
     * first run failed on "support", "agreed" and "minute" -- words that were
     * in the workspace *and* are in the vocabulary below, so they were both
     * removed and put back. Without this list the check cries wolf, and a
     * check that cries wolf gets switched off.
     */
    vocabulary: [...FIRST, ...LAST, ...CHANNELS, ...SECTIONS,
      ...WORDS.join(' ').split(/\s+/), 'Northwind', 'example.com', 'Slack'],
    /** The places this sweeps, named. */
    areas: TEXT_AREAS.map((entry) => (typeof entry === 'string' ? entry : entry.sel)),
    stop: () => observer.disconnect(),
    /** What is left on screen, for the caller to check before it presses the shutter. */
    /**
     * What is left, and what must never be there at all.
     *
     * Two dimensions, because a word list alone is a weak audit: it only knows
     * what it saw before. The second is absolute -- after this script has run,
     * no picture and no link on the page may point anywhere but at
     * example.com, whatever was there before and whatever arrived since.
     */
    remoteThings: () => [
      ...[...document.querySelectorAll('img[src^="http"]')].map((i) => `img ${i.getAttribute('src')}`),
      ...[...document.querySelectorAll('a[href^="http"]')]
        // slack.com and its status page are Slack's own support links, the same
        // in every workspace on earth; they say nothing about this one.
        .filter((a) => !a.closest(KEEP)
          && !/^https:\/\/(example\.com|slack\.com|slack-status\.com)/.test(a.getAttribute('href') ?? ''))
        .map((a) => `link ${a.getAttribute('href')}`),
    ],
    /**
     * Where a word that should have gone still is.
     *
     * An audit that says "ten strings survived" sends you hunting; one that
     * says which element each is in tells you which selector is missing. Every
     * round of this cost a Slack launch, so it is worth the twenty lines.
     */
    locate: (words) => {
      const found = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue ?? '';
        if (!text.trim() || node.parentElement?.closest(KEEP)) continue;
        for (const word of words) {
          if (!text.includes(word)) continue;
          const el = node.parentElement;
          const path = [];
          for (let n = el, i = 0; n && i < 3; n = n.parentElement, i += 1) {
            path.push(n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(/\s+/)[0] : ''));
          }
          found.push({ word, where: path.join(' < '), text: text.trim().slice(0, 60) });
          break;
        }
      }
      // Attributes carry them too: a title, an aria-label, an alt.
      for (const el of document.querySelectorAll('[title], [aria-label], [alt], [data-stringify-link]')) {
        if (el.closest(KEEP)) continue;
        const bag = ['title', 'aria-label', 'alt', 'data-stringify-link']
          .map((name) => el.getAttribute(name) ?? '').join(' ');
        for (const word of words) {
          if (bag.includes(word)) {
            found.push({ word, where: 'attribute on ' + el.tagName.toLowerCase()
              + (el.className ? '.' + String(el.className).split(/\s+/)[0] : ''), text: bag.slice(0, 60) });
            break;
          }
        }
      }
      return found.slice(0, 40);
    },

    /** Everything still on screen, for the caller to check before it shoots. */
    /*
     * A screenshot is pixels, so this reads what is drawn.
     *
     * Reading `body.textContent` instead put Slack's own inline <script> in the
     * audit -- the word "master" in a bundler path -- and a hidden support link
     * from the network-trouble banner. Both failed the run and neither could
     * ever reach a picture. Attributes are left out for the same reason: a
     * title on a link is a tooltip nobody hovered.
     */
    sample: () => {
      const parts = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!node.nodeValue?.trim() || !el) continue;
        if (el.closest(KEEP) || el.closest('script, style, noscript')) continue;
        if (!el.checkVisibility?.({ checkOpacity: false, checkVisibilityCSS: true })) continue;
        parts.push(node.nodeValue);
      }
      for (const el of document.querySelectorAll('a[href], img[src]')) {
        if (el.closest(KEEP) || !el.checkVisibility?.()) continue;
        parts.push(el.getAttribute('href') ?? el.getAttribute('src') ?? '');
      }
      return parts.join(' ');
    },
  };
  return 'installed';
})();
