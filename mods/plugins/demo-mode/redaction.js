/**
 * Replace everything on screen that belongs to somebody.
 *
 * This is the engine behind Demo Mode, and it is also what `pnpm shoot --mods`
 * runs before it photographs a real workspace: one implementation, so the
 * screenshots in this repository and the ones you take yourself hide the same
 * things. `scripts/shoot-mods.mjs` bundles this file into the page.
 *
 * It replaces rather than hides. Blurring leaves shapes and lengths, and a
 * blurred name is still a name that was on the screen; a black box says the
 * picture had something to hide. Substitution gives a screen that looks like
 * Slack in use and contains nobody.
 *
 * The rule is whitelist, not blacklist: inside the containers listed below,
 * *every* text node is rewritten unless it is BetterSlack's own interface.
 * Deciding what looks sensitive is how a real name survives into a picture.
 *
 * Substitutions are derived from a hash of the original, so the same person is
 * the same invented person everywhere on screen -- the sidebar, the messages,
 * the member list -- and two runs produce the same picture.
 *
 * Everything it writes, it can put back. That is the one thing this needs and
 * the screenshot recipe never did: the recipe was about to close Slack, and
 * Demo Mode is switched off in a client somebody keeps using.
 */

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

/** The workspace's name, wherever it is written. */
const WORKSPACE = 'Northwind';

/*
 * Code blocks.
 *
 * A `pre` full of somebody's SQL is as private as a message, so it goes -- but
 * replacing it with prose, which is what the sentence branch does, turns the
 * one screenshot that is supposed to show syntax highlighting into a paragraph
 * in a box. These are code, in languages the highlighter knows.
 */
const SNIPPETS = [
  "const shipped = releases.filter((r) => r.stage === 'live');\nexport function latest(list) {\n  return list.sort((a, b) => b.at - a.at)[0];\n}",
  'def digest(rows):\n    counts = {}\n    for row in rows:\n        counts[row.channel] = counts.get(row.channel, 0) + 1\n    return sorted(counts.items(), key=lambda kv: -kv[1])',
  "select channel, count(*) as messages\nfrom events\nwhere sent_at > now() - interval '7 days'\ngroup by channel\norder by messages desc\nlimit 10;",
  '{\n  "id": "weekly-digest",\n  "enabled": true,\n  "channels": ["releases", "support"],\n  "hour": 9\n}',
];

/*
 * Where somebody's words are, named precisely.
 *
 * Two wrong versions came before this one. The first listed containers and
 * missed three -- the member column a mod draws, the palette's list of real
 * conversations, the signed-in face in the rail. The second swept the whole
 * document and replaced Slack's own labels with it: "Home" became a person's
 * name, every button changed width, and the screen was of an application
 * nobody has ever used.
 *
 * So: the places that hold *content*, and nothing that holds Slack's
 * furniture. What makes this safe is not the list -- a list can always miss
 * one -- it is `remaining()`, which reads the screen afterwards and says what
 * is still there. A missed selector is a warning you can act on before you
 * press the shutter; it is not a silent leak.
 */
const TEXT_AREAS = [
  // Conversations, wherever they are named. Measured against the client rather
  // than remembered: the name button's own data-qa is gone from Slack 4.51,
  // and a selector that matches nothing is a hole nothing announces.
  { sel: '[data-qa="channel-sidebar-channel"]', as: CHANNELS },
  { sel: '.p-channel_sidebar__name', as: CHANNELS },
  '[data-qa="channel_name"]', '.p-view_header__text', '.p-view_header__channel_title',
  // The sidebar's section headings, which people name themselves -- "Biz",
  // "Mep", "Paiement". Matched on a class *fragment* on purpose: these are
  // CSS-module names (`labelContent__ND43C`) whose hash changes with every
  // Slack build, and the readable half in front of it does not.
  { sel: '[class*="labelContent"]', as: SECTIONS },
  { sel: '[class*="sectionHeading"]', as: SECTIONS },
  // The grey prompt behind the composer carries the channel's name -- "Message
  // #<name>" -- which is as public as the header. Found by the audit.
  { sel: '.c-texty_input__placeholder', as: CHANNELS },
  { sel: '.ql-placeholder', as: CHANNELS },
  /*
   * Not drawn, but Slack narrates every navigation for screen readers, names
   * and all. Matched on the role rather than the class: a second announcer
   * turned up in a container whose only class was a CSS-module hash
   * (`div.mBgaT`), which changes with every Slack build and could never have
   * been listed. `aria-live` is what they have in common and what they are.
   */
  { sel: '.c-aria_live_announcer_api', as: CHANNELS },
  { sel: '[aria-live]', as: CHANNELS },
  // Messages: who, and what.
  '[data-qa="message_sender"]', '.c-message__sender', '.c-message__sender_button',
  '[data-qa="message-text"]', '.p-rich_text_block', '.c-message_kit__blocks',
  // A link Slack unfurled is a card with somebody's title, text and author in
  // it -- the whole card goes, never a field or two inside it.
  '.c-message_attachment',
  /*
   * The rest of an unfurl. Slack draws a link preview's title, its breadcrumb
   * and its body outside the attachment box, in `p-mrkdwn_element` -- found by
   * the audit, with a real person's name in a `<b>` inside one and a document
   * path ("Biz / 2. Marques, Offres & Marques Blanches") in another.
   */
  '.p-mrkdwn_element',
  // A bare span inside a virtual row: Slack's activity and search views put the
  // message there rather than in a message-kit block, and one slipped through.
  // Direct children only, so the sidebar rows keep their names.
  '.c-virtual_list__item > span',
  // Files, and the boxes Slack builds around them.
  '.p-file_container', '.c-file_gallery', '[data-qa="file_name"]',
  // People, wherever they are listed -- including the card Slack puts at the
  // top of a conversation you have not written in yet, which carries a name and
  // a job title and is not part of the profile pane.
  '[data-qa="member_profile_pane"]', '.p-ia_details_popover',
  '[class*="p-new_im_foreword"]', '.c-base_entity__text-contents',
  /*
   * What the mods themselves draw out of the workspace -- the fields that hold
   * it, not the containers. Sweeping the whole palette turned its own headings
   * ("Conversations", "People") into people's names and its glyphs into
   * channel names, and the screen was of software nobody wrote.
   */
  '.betterslack-members__name', '.betterslack-members__note',
  '.betterslack-me__name', '.betterslack-me__status',
  // Edit Log keeps what a message said, and draws it in nodes of its own: the
  // headstone left where a deleted message was, and the wordings in its
  // dialog. Slack's own selectors above never reach them, so a real sentence
  // would sail past every one of them and be caught only by the audit.
  '.betterslack-editlog-stone__text', '.betterslack-editlog-text',
  // The top bar's search, which remembers what was typed into it.
  '[data-qa="top_nav_search"]', '.p-top_nav__search__container',
];

/**
 * A draft is somebody's words too, so it is swept -- but only once.
 *
 * Rewriting it on every mutation would rewrite what you are typing as you type
 * it, which makes the client unusable. So the composer goes in the first
 * sweep, when it holds whatever was left there earlier, and is left alone
 * afterwards: anything you type during a demo is your own words, on your own
 * screen, and you are the one holding the shutter.
 */
const DRAFT = { sel: '.ql-editor', as: WORDS };

/*
 * BetterSlack's own words: left alone, and left out of the audit.
 *
 * Named one by one rather than by the `betterslack-` prefix, because some of
 * what the mods draw *is* the workspace -- the palette's rows, the member
 * column's names -- and that has to be replaced like everything else. What is
 * listed here is fixed copy: the panel, a toast, a hint under a field, the
 * strip this mod leaves on screen.
 */
const KEEP = '#betterslack-panel, #betterslack-toast-host,'
  + ' #betterslack-demo-indicator, .betterslack-hint, .betterslack-widget_titles';

const hash = (text) => {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};
const pick = (list, seed) => list[hash(seed) % list.length];

/*
 * Long on purpose. Slack shortens a long address to `host/path…` and Full
 * Links puts it back, so a demo of that mod needs an address long enough to
 * have been shortened; a tidy `example.com/449` showed nothing.
 */
const fakeUrl = (seed) => `https://example.com/${pick(CHANNELS, seed)}/2026-08/`
  + `build-${(hash(seed) % 9000) + 1000}/notes?ref=slack-digest&source=weekly`;

/** A face nobody has: initials on a colour, as a data URL. */
function face(seed) {
  const hue = hash(seed) % 360;
  const initials = `${pick(FIRST, seed)[0]}${pick(LAST, `${seed}!`)[0]}`;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + `<rect width="64" height="64" fill="hsl(${hue} 45% 45%)"/>`
    + '<text x="32" y="41" font-family="Lato, sans-serif" font-size="26" font-weight="700"'
    + ` fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  // encodeURIComponent rather than btoa: this module runs in the page, in the
  // shoot recipe and under jsdom, and only one of the three is guaranteed a
  // working btoa.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Everything this mod says, so an audit can tell its words from the room's. */
export const VOCABULARY = [...FIRST, ...LAST, ...CHANNELS, ...SECTIONS,
  ...WORDS.join(' ').split(/\s+/), WORKSPACE, 'example.com', 'Slack',
  /*
   * The invented address's own words.
   *
   * An audit compares what is on screen against what was there before, and
   * anything this file writes has to be excluded or it reads as a survivor.
   * `?ref=slack-digest&source=weekly` failed a run on the word "source",
   * which had been in a real link on the same screen -- a false alarm, but one
   * that stops a shoot just as dead as a real one.
   */
  'notes', 'ref', 'slack-digest', 'digest', 'source', 'weekly', 'build'];

/** The places it sweeps, named. */
export const AREAS = [...TEXT_AREAS, DRAFT].map((e) => (typeof e === 'string' ? e : e.sel));

export function createRedaction(options = {}) {
  const doc = options.document ?? globalThis.document;
  const keep = options.keep ?? KEEP;
  // Slack mutates constantly, and sweeping on every mutation spends the frame
  // budget of the client somebody is using. Coalesced instead: a burst of
  // renders is one sweep.
  const settle = options.debounceMs ?? 120;

  /*
   * Nodes already dealt with.
   *
   * Without this the observer below is a loop that freezes the renderer:
   * rewriting a text node is a mutation, the mutation calls the sweep, and the
   * sweep invents a new name for the name it just invented. This project has
   * frozen Slack twice on exactly that shape, so the guard is a WeakSet *and*
   * the observer is disconnected while the sweep runs.
   */
  let done = new WeakSet();
  const memo = new Map();

  /*
   * How to put it back.
   *
   * One entry per write, holding what was there and what we replaced it with.
   * The second half is what makes restoring safe: if Slack has re-rendered
   * that node since, what is on screen is not what we wrote, and writing the
   * old value over it would put a stale message back on screen.
   */
  let undo = [];
  /** The document's title is not a node, so it carries its own restore. */
  let titleUndo = null;
  const record = (entry) => {
    undo.push(entry);
    /*
     * Slack's message list is virtual: rows are thrown away as you scroll, and
     * an entry for a node no longer in the document can never be restored. Left
     * alone this grows for as long as the demo runs, so it is pruned once it is
     * large enough for the walk to be worth it.
     */
    if (undo.length > 4000) undo = undo.filter((e) => e.node.isConnected);
  };

  const setText = (node, value) => {
    const was = node.nodeValue;
    if (was === value) return;
    node.nodeValue = value;
    record({ node, was, wrote: value, put: () => { node.nodeValue = was; } });
  };

  const setAttr = (el, name, value) => {
    const was = el.getAttribute(name);
    if (was === value) return;
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
    record({
      node: el,
      wrote: value,
      read: () => el.getAttribute(name),
      put: () => { if (was === null) el.removeAttribute(name); else el.setAttribute(name, was); },
    });
  };

  const invent = (text) => {
    const original = text.trim();
    if (!original) return text;
    if (memo.has(original)) return memo.get(original);

    let replacement;
    if (/^(https?:\/\/|www\.)/i.test(original) || /\.(com|net|org|io|dev|fr|co)\b/i.test(original)) {
      /*
       * An internal URL is a company's map: hostnames, project names, ticket
       * numbers. The first version left them alone and a real
       * `gitlab.<company>.com/<team>/<project>/-/merge_requests/719` sat in the
       * middle of an otherwise clean screen.
       */
      replacement = fakeUrl(original);
    } else if (/^[#@]/.test(original)) {
      replacement = original[0] + pick(CHANNELS, original);
    } else if (/^\d{1,2}\s?[h:]\s?\d{2}/.test(original) || /^\d{1,4}$/.test(original)) {
      // Times, counts and years belong to nobody, and inventing them makes a
      // screen look wrong for no gain.
      replacement = original;
    } else if (/^[\d\s.-]+$/.test(original)) {
      /*
       * A longer number is not a count. Found by the audit: two six-digit
       * order references sat alone in message bubbles and survived every sweep,
       * because "it is only digits" had been taken to mean "it is nobody's".
       * Replaced digit for digit, so the bubble keeps its width.
       */
      replacement = original.replace(/\d/g, (digit, at) =>
        String((hash(`${original}#${at}`) + Number(digit)) % 10));
    } else if (original.split(/\s+/).length <= 3 && /^[\p{Lu}]/u.test(original)) {
      // Something short that starts with a capital reads as a name.
      replacement = `${pick(FIRST, original)} ${pick(LAST, `${original}!`)}`;
    } else if (original.length < 24) {
      replacement = pick(CHANNELS, original);
    } else {
      // A sentence: keep roughly the shape, so the layout stays honest.
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

  const redactText = (root, as, index = 0) => {
    const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    for (const node of nodes) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      if (done.has(node) || node.parentElement?.closest(keep)) continue;
      // `as` is a short list to draw from: a heading stays a heading, a draft
      // stays one line. Without it everything long becomes a paragraph.
      setText(node, as ? as[(index + hash(node.nodeValue)) % as.length] : invent(node.nodeValue));
      done.add(node);
    }
  };

  /** Links carry the address twice: as text, and as somewhere to go. */
  const redactLinks = (root) => {
    for (const anchor of root.querySelectorAll('a[href]')) {
      if (anchor.closest(keep)) continue;
      const href = anchor.getAttribute('href') ?? '';
      /*
       * Slack's own paths carry ids: a mention is `/team/U…`, a permalink is
       * `/archives/C…/p…`, an integration is `/services/B…`. No host, so the
       * absolute rule below never sees them, and the audit caught a real app
       * id this way. The path keeps its shape and only the ids go, so
       * `/client/…` is left alone and the client still navigates.
       */
      if (/^\/(team|services|archives|apps|files)\//i.test(href)) {
        setAttr(anchor, 'href', href.replace(/\b[A-Z][A-Z0-9]{6,}\b/g, 'X0000000000'));
        continue;
      }
      if (!/^https?:/i.test(href)) continue;
      const invented = fakeUrl(href);
      setAttr(anchor, 'href', invented);
      /*
       * Rewritten rather than removed, and to the same invented address: it is
       * what Slack copies, what Full Links reads to restore a shortened label,
       * and -- left alone -- what would put the real one back on screen the
       * moment that mod ran.
       */
      if (anchor.hasAttribute('data-stringify-link')) setAttr(anchor, 'data-stringify-link', invented);
    }
  };

  const redactFaces = (root) => {
    for (const img of root.querySelectorAll('img')) {
      if (done.has(img) || img.closest(keep)) continue;
      const src = img.getAttribute('src') ?? '';
      // Everything that came off the network, whatever the host: an avatar, a
      // custom emoji, a file thumbnail, the picture somebody pasted. Matching
      // known hosts left the file thumbnails in the first version, and one of
      // them was a poster somebody had shared.
      if (!/^https?:/i.test(src)) continue;
      setAttr(img, 'src', face(src));
      setAttr(img, 'srcset', null);
      done.add(img);
    }
    // Anything painted as a background rather than drawn as an image.
    for (const el of root.querySelectorAll('[style*="url("]')) {
      if (done.has(el) || el.closest(keep)) continue;
      setAttr(el, 'style', `${el.getAttribute('style') ?? ''};background-image:none;background-color:rgba(127,127,127,.18)`);
      done.add(el);
    }
    redactLinks(root);
  };

  const sweep = ({ first = false } = {}) => {
    /*
     * Code blocks first, and past the highlighter's own output.
     *
     * Code Highlight replaces the block with a tokenised copy of itself, so by
     * the time the areas below are swept there are two versions of the same
     * code on screen and the sweep turns both into words -- which is how the
     * screenshot of a syntax highlighter came back as coloured prose. Slack's
     * own nodes are the ones to write to.
     */
    for (const pre of doc.querySelectorAll('pre.c-mrkdwn__pre')) {
      if (done.has(pre) || pre.closest(keep)) continue;
      const snippet = pick(SNIPPETS, pre.textContent ?? 'x');
      const walker = doc.createTreeWalker(pre, 4 /* SHOW_TEXT */);
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement?.closest('.betterslack-hl')) nodes.push(node);
      }
      // Written into the nodes Slack already made rather than through
      // `textContent`: removing a child of a node React owns is what earns a
      // "removeChild on a node that is not a child" at its next render.
      nodes.forEach((node, index) => {
        setText(node, index === 0 ? snippet : '');
        done.add(node);
      });
      done.add(pre);
    }

    for (const entry of first ? [...TEXT_AREAS, DRAFT] : TEXT_AREAS) {
      const selector = typeof entry === 'string' ? entry : entry.sel;
      [...doc.querySelectorAll(selector)].forEach((area, index) => {
        // Walked in order and seeded by position, so a sidebar of six sections
        // gets six different names: hashing their real names gave "Projets"
        // three times, which reads as a bug in Slack rather than a workspace.
        redactText(area, typeof entry === 'string' ? undefined : entry.as, index);
      });
    }

    /*
     * The palette lists two different things through one class: the
     * workspace's conversations and people, and the mods' own commands. Only
     * the first belongs to anybody. The badge on the right is what tells them
     * apart -- a row that says "Channel" came out of Slack, a row that says
     * "Command Palette" came out of a mod -- and a row whose badge is neither
     * is left alone and then shows up in `remaining()`, which is the outcome
     * to want.
     */
    for (const row of doc.querySelectorAll('.betterslack-palette__row')) {
      const source = row.querySelector('.betterslack-palette__source')?.textContent ?? '';
      /*
       * A row sourced "Slack" is one of the palette's own actions -- set a
       * status, pause notifications, copy a link -- so its title is the mod's
       * own words and must survive. Its second line is not: "Copy a link to
       * this conversation" carries the conversation's name under it.
       */
      if (/^\s*slack\s*$/i.test(source)) {
        const sub = row.querySelector('.betterslack-palette__sub');
        if (sub) redactText(sub);
        continue;
      }
      // Everything else Slack answered for: a channel, a DM, a group DM (whose
      // title is a list of real people) and a line out of a real conversation.
      if (!/canal|channel|message|groupe|group/i.test(source)) continue;
      const text = row.querySelector('.betterslack-palette__text');
      if (text) redactText(text);
    }

    /*
     * Pictures and links are swept document-wide rather than by area: Slack's
     * own furniture has no remote images and no outside links, so there is
     * nothing here to spare, and the leaks that mattered -- a file thumbnail,
     * a link to an internal host -- were both outside the text areas above.
     */
    redactFaces(doc.body);

    /*
     * Labels a screen reader would read.
     *
     * `aria-label="View <a real name>'s profile"` is on every avatar in the
     * message list. None of it is drawn, so none of it can reach a picture --
     * but Slack builds a tooltip out of a `title`, and a screenshot taken with
     * the pointer resting anywhere is a screenshot with a real name in it.
     */
    for (const el of doc.querySelectorAll('[aria-label], [title], [alt]')) {
      if (done.has(el) || el.closest(keep)) continue;
      for (const name of ['aria-label', 'title', 'alt']) {
        const value = el.getAttribute(name);
        if (value && value.trim()) setAttr(el, name, invent(value));
      }
      done.add(el);
    }

    /*
     * The workspace, wherever it is written.
     *
     * Walked rather than assigned through `textContent`, which would throw
     * away nodes this mod has to be able to put back -- but walking only the
     * *direct* children missed it, because Slack wraps the name in a span, and
     * the audit failed on a real company name. First text node gets the
     * invented one, the rest are emptied: the same result as assigning
     * `textContent`, one undo entry at a time.
     */
    for (const el of doc.querySelectorAll('.p-ia4_sidebar_header__title, .p-team_sidebar__item, [data-qa="team-name"]')) {
      if (el.closest(keep)) continue;
      const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
      let first = true;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue?.trim()) continue;
        setText(node, first ? WORKSPACE : '');
        done.add(node);
        first = false;
      }
    }
    if (doc.title !== WORKSPACE) {
      const was = doc.title;
      doc.title = WORKSPACE;
      titleUndo ??= () => { doc.title = was; };
    }
  };

  let observer = null;
  let timer = null;

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!observer) return;
      // Disconnected around the sweep, or its own writes call it back.
      observer.disconnect();
      try { sweep(); } finally { observer.observe(doc.body, watch); }
    }, settle);
  };

  const watch = { childList: true, subtree: true, characterData: true };

  return {
    sweep,

    /** Sweep what is here, then keep sweeping what arrives. */
    start() {
      sweep({ first: true });
      observer ??= new (doc.defaultView?.MutationObserver ?? globalThis.MutationObserver)(schedule);
      observer.observe(doc.body, watch);
    },

    stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      observer?.disconnect();
      observer = null;
    },

    /**
     * Put it all back.
     *
     * Only what is still ours: if Slack has re-rendered a node since, what is
     * on screen is newer than what we wrote, and writing the old value over it
     * would put a stale message back on screen. Detached nodes are skipped for
     * the same reason -- they are already gone.
     */
    restore() {
      for (const entry of undo.reverse()) {
        if (!entry.node.isConnected) continue;
        const now = entry.read ? entry.read() : entry.node.nodeValue;
        if (now !== entry.wrote) continue;
        entry.put();
      }
      undo = [];
      titleUndo?.();
      titleUndo = null;
      // A fresh screen next time: the WeakSet remembers nodes we have already
      // seen, and after a restore every one of them holds the real thing again.
      done = new WeakSet();
      memo.clear();
    },

    vocabulary: VOCABULARY,
    areas: AREAS,

    /**
     * What is still on screen that this mod did not write.
     *
     * A word list alone would be a weak check -- it only knows what it saw
     * before -- so the rule here is absolute and needs no memory: after a
     * sweep, nothing drawn may point anywhere but at example.com, and no
     * remote picture may be left. It is what turns "I think it worked" into
     * something you can read before pressing the shutter.
     */
    remaining() {
      const found = [];
      for (const img of doc.querySelectorAll('img[src^="http"]')) {
        if (img.closest(keep)) continue;
        found.push({ what: 'image', where: describe(img), text: img.getAttribute('src') ?? '' });
      }
      for (const anchor of doc.querySelectorAll('a[href^="http"]')) {
        const href = anchor.getAttribute('href') ?? '';
        // slack.com and its status page are Slack's own support links, the same
        // in every workspace on earth; they say nothing about this one.
        if (anchor.closest(keep) || /^https:\/\/(example\.com|slack\.com|slack-status\.com)/.test(href)) continue;
        found.push({ what: 'link', where: describe(anchor), text: href });
      }
      return found;
    },

    /**
     * Where a word that should have gone still is.
     *
     * "Ten strings survived" sends you hunting; "and each is in this element"
     * tells you which selector is missing. Every round of this cost a Slack
     * launch while the recipe was being written, so it is worth the ten lines.
     */
    locate(words) {
      const found = [];
      const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue ?? '';
        if (!text.trim() || node.parentElement?.closest(keep)) continue;
        const hit = words.find((word) => text.includes(word));
        if (hit) found.push({ word: hit, where: describe(node.parentElement), text: text.trim().slice(0, 60) });
      }
      return found.slice(0, 40);
    },

    /**
     * What is drawn, for a caller that wants to compare before and after.
     *
     * Reading `body.textContent` instead put Slack's own inline `<script>` in
     * the audit -- the word "master" from a bundler path -- and a hidden
     * support link from the network-trouble banner. Both failed runs that were
     * clean. Attributes are left out for the same reason: a title on a link is
     * a tooltip nobody hovered.
     */
    sample() {
      const parts = [];
      const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!node.nodeValue?.trim() || !el) continue;
        if (el.closest(keep) || el.closest('script, style, noscript')) continue;
        if (el.checkVisibility && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) continue;
        parts.push(node.nodeValue);
      }
      for (const el of doc.querySelectorAll('a[href], img[src]')) {
        if (el.closest(keep)) continue;
        if (el.checkVisibility && !el.checkVisibility()) continue;
        parts.push(el.getAttribute('href') ?? el.getAttribute('src') ?? '');
      }
      return parts.join(' ');
    },
  };
}

/** A short, readable path to an element, for a report somebody has to act on. */
function describe(el) {
  const path = [];
  for (let node = el, depth = 0; node && depth < 3; node = node.parentElement, depth += 1) {
    const name = node.tagName?.toLowerCase();
    if (!name) break;
    const cls = String(node.className || '').split(/\s+/)[0];
    path.push(cls ? `${name}.${cls}` : name);
  }
  return path.join(' < ');
}
