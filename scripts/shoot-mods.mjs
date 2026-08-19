// A picture per mod, for the catalogue.
//
// Run through `pnpm shoot:mods`. One Slack launch: each mod is switched on,
// whatever it needs is opened, the frame is taken, and the next one begins --
// the runtime does all of it in place through `window.__betterslack`.
//
// These are taken against a real, signed-in Slack, because that is the only
// place a mod does anything, and a real Slack belongs to somebody. So nothing
// is photographed until Demo Mode's engine has replaced every name, face,
// message and channel on screen, and the recipe *checks* that it did: if a
// string that was there before the sweep is still there after it, the run stops
// without writing a file. A screenshot is forever and a README is public.

import * as esbuild from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.BETTERSLACK_SHOT;
const SIZE = '1600x1000';

/** What to switch on, and what to open, for each mod's picture. */
/*
 * Slack's own vocabulary, which is in every workspace and identifies none.
 *
 * These reached the audit because they are on screen twice: in a message, and
 * in a tab label, a placeholder or a tip the redactor has no business
 * rewriting. Each was found by running the audit and reading where it said the
 * survivor was -- none is here on a hunch, and anything not on this short list
 * still fails the run.
 */
const CHROME = new Set([
  'message', 'messages', 'discussion', 'discussions', 'equipe', 'équipe',
  'importe', 'nouvelle', 'nouveau', 'conversation', 'conversations',
  // The tab rail's own labels, which Slack writes and nobody chose.
  'accueil', 'activité', 'activite', 'fichiers', 'directs', 'brouillons',
  'canaux', 'connexions', 'groupes', 'externes',
  // Tabs above a conversation, and the day dividers and reply bars inside it.
  'marque-pages', 'épingles', 'epingles', 'canevas', 'dossier', 'aujourd',
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
  'réponse', 'réponses', 'reponse', 'reponses', 'dernière', 'derniere',
  'afficher', 'télécharger', 'telecharger', 'modifié', 'modifie',
  'retour', 'ajouter', 'ligne', 'enregistrer', 'chargement', 'envoyer', 'channel',
  'mentions', 'réactions', 'reactions', 'brouillon',
  'janvier', 'février', 'fevrier', 'mars', 'avril', 'juin', 'juillet',
  'août', 'aout', 'septembre', 'octobre', 'novembre', 'décembre', 'decembre',
]);

/*
 * One frame per mod, and each one has to *show* the mod.
 *
 * The first version photographed the client with a mod switched on and nothing
 * else, and got fifteen pictures of the same quiet channel: a message action
 * only exists while the pointer is over a message, a profile section only
 * exists once a profile is open, and a window a mod opens is not in this
 * window at all. So every entry says what to do first.
 */
/** The message the pointer rests on for the shots of a message action. */
const MESSAGE = '[data-qa="message_container"]';

const SHOTS = [
  // Themes: the whole client is the screenshot.
  { id: 'discord-dark' },
  { id: 'discord-light' },
  { id: 'midnight' },
  { id: 'aurora' },
  { id: 'cocoa' },
  { id: 'terminal' },
  { id: 'focus-rings' },
  // Plugins.
  { id: 'demo-mode', expect: '#betterslack-demo-indicator' },
  { id: 'motion', open: 'panel', expect: '#betterslack-panel' },
  { id: 'code-highlight', stage: 'codeblock', reapply: true, expect: '.betterslack-hl' },
  { id: 'full-links', reapply: true },
  { id: 'command-palette', open: 'palette', expect: '.betterslack-palette__box' },
  { id: 'member-sidebar', expect: '#betterslack-member-column' },
  { id: 'sidebar-account', expect: '.betterslack-me' },
  { id: 'channel-notes', open: 'button:channel-notes-notes', expect: '.betterslack-widget_dialog' },
  // No text is typed into the composer: it is the user's real draft, in a real
  // workspace, and a screenshot run has no business writing to it. Whatever is
  // in there is what the counter counts.
  { id: 'composer-char-count', stage: 'compose', undo: 'uncompose', expect: '#betterslack-char-count' },
  { id: 'copy-message-link', hover: MESSAGE },
  { id: 'quote-reply', hover: MESSAGE },
  { id: 'focus-mode', open: 'command:focus-mode' },
  {
    id: 'devtools',
    hover: '.betterslack-toolbar-button:not(#betterslack-control-button)',
    expect: '#betterslack-tb-devtools-devtools',
  },
  { id: 'theme-builder', open: 'command:theme-builder', window: 'betterslack-theme-builder' },
  // Last, and in this order: opening a profile leaves the client in a
  // conversation with that person, which is a poor backdrop for everything
  // else and has no messages to hover.
  { id: 'user-inspector', open: 'profile', expect: '.betterslack-user-details' },
  { id: 'avatar-downloader', open: 'profile', expect: '.betterslack-profile-row' },
];

const only = (ids) => `(async () => {
  const m = window.__betterslack.manager;
  const want = new Set(${JSON.stringify(ids)});
  // A theme that names a plugin in \`requires\` is incomplete without it --
  // Discord Dark without the member column is not what anyone installs -- and
  // switching mods on from here does not go through the panel's ask-first path.
  for (const mod of m.list()) {
    if (want.has(mod.id)) for (const required of mod.requires ?? []) want.add(required);
  }
  for (const mod of m.list()) {
    if (m.isEnabled(mod.id) !== want.has(mod.id)) await m.setEnabled(mod.id, want.has(mod.id));
  }
  window.__betterslack.close();
  return m.getSettings().enabled.join(',');
})()`;

const openFor = (what) => {
  if (!what) return 'true';
  if (what === 'panel') return `(() => { window.__betterslack.panel.open('plugins'); return true; })()`;
  if (what === 'palette') return `(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, ctrlKey: true, bubbles: true }));
    return true;
  })()`;
  if (what === 'profile') return `(async () => {
    /*
     * Slack keeps a profile out of the address bar, but its own deep link
     * opens one in place: it navigates to the conversation with that person
     * and slides their profile in beside it. The ids were read before the
     * sweep, since the avatars they come off have been replaced by drawings.
     *
     * Tried in turn, because not every id in a message list belongs to
     * somebody with a profile -- apps post messages too, and the first one
     * here opened a conversation with no pane at all.
     */
    const team = (location.pathname.match(/\\/client\\/([^/]+)/) ?? [])[1];
    if (!team) return 'no team in the url';
    for (const id of (window.__betterslackPeople ?? []).slice(0, 14)) {
      window.location.href = 'slack://user?team=' + team + '&id=' + id;
      await new Promise((resolve) => setTimeout(resolve, 4500));
      if (document.querySelector('[data-qa="member_profile_pane"]')) return id;
    }
    return 'no profile opened';
  })()`;
  if (what === 'compose') return `(() => {
    /*
     * The counter counts what is in the composer, so an empty one photographs
     * as nothing at all. Written only into an empty composer, and taken back
     * out after the picture: this is somebody's real Slack, and a screenshot
     * run has no business leaving a draft behind in it.
     */
    const editor = document.querySelector('[data-qa="message_input"] .ql-editor');
    if (!editor) return 'no composer';
    if ((editor.textContent ?? '').trim()) return 'left the draft alone';
    editor.focus();
    document.execCommand('insertText', false,
      'shipping this afternoon, rebased and green. good catch -- moved it to next week.');
    return 'typed';
  })()`;
  if (what === 'uncompose') return `(() => {
    const editor = document.querySelector('[data-qa="message_input"] .ql-editor');
    if (!editor) return 'no composer';
    editor.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    return 'cleared';
  })()`;
  if (what === 'codeblock') return `(() => {
    /*
     * A channel with a code block in it is not something to hope for.
     *
     * Slack's own markup, appended to the last message rather than replacing
     * anything -- adding a child is safe, removing one from a node React owns
     * is what earns a "removeChild on a node that is not a child" at its next
     * render. The highlighter then finds it the way it finds any other, so
     * what the picture shows is the mod really working.
     */
    if (document.querySelector('pre.c-mrkdwn__pre')) return 'already one here';
    const bodies = [...document.querySelectorAll('[data-qa="message-text"]')];
    const body = bodies[bodies.length - 2] ?? bodies[bodies.length - 1];
    if (!body) return 'no message to add it to';
    const pre = document.createElement('pre');
    pre.className = 'c-mrkdwn__pre';
    pre.setAttribute('data-stringify-type', 'pre');
    pre.textContent = [
      'const shipped = releases.filter((r) => r.stage === "live");',
      'export function latest(list) {',
      '  return list.sort((a, b) => b.at - a.at)[0];',
      '}',
    ].join('\\n');
    body.append(pre);
    return 'added one';
  })()`;
  if (what.startsWith('button:')) {
    // Not every mod puts a command in the palette; some are only a button in
    // Slack's chrome, and `addToolbarButton` gives it a predictable id.
    const selector = `#betterslack-tb-${what.slice('button:'.length)}`;
    return `(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      button?.click();
      return Boolean(button);
    })()`;
  }
  if (what.startsWith('command:')) {
    const id = what.slice('command:'.length);
    return `(() => {
      const command = window.__betterslack.manager.commands?.get?.(${JSON.stringify(id)});
      const all = [...(window.__betterslack.manager.commands?.values?.() ?? [])];
      const wanted = all.find((c) => String(c.id ?? '').includes(${JSON.stringify(id)}));
      (command ?? wanted)?.run?.();
      return Boolean(command ?? wanted);
    })()`;
  }
  return 'true';
};

export default async function shootMods({ evaluate, shoot, shootWindow, click, sleep }) {
  /*
   * The redaction is Demo Mode's, bundled into the page.
   *
   * It used to be a copy living in `scripts/`, which is exactly the shape this
   * repository refuses elsewhere: two implementations of one idea, and the one
   * users run would have been the one nothing checks. This way the pictures in
   * the repository and the ones anybody takes with the mod hide the same
   * things, and this recipe -- which reads the screen afterwards and refuses
   * to shoot if anything survived -- is the mod's test against a real Slack.
   */
  const bundle = await esbuild.build({
    entryPoints: [path.join(root, 'mods/plugins/demo-mode/redaction.js')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__betterslackRedactionModule',
  });
  const redactor = `${bundle.outputFiles[0].text}
    window.__betterslackRedaction = __betterslackRedactionModule.createRedaction({
      // No coalescing here: the mod spares the client somebody is using, and
      // this one is about to press a shutter.
      debounceMs: 0,
    });
    'installed'`;

  // Installed first, and it does not sweep until it is told to: the sample
  // taken below is the only evidence of what was on screen.
  console.log('[mods] redactor:', await evaluate(redactor));


  /*
   * Wait for a client with something in it.
   *
   * The check below compares what was on screen with what is left, and an
   * empty page passes it trivially -- which is exactly what happened the first
   * time: "0 words to be rid of", a clean bill of health, and a picture with a
   * real internal URL in the middle of it. A check that can pass vacuously is
   * not a check.
   */
  /*
   * A conversation with something in it.
   *
   * Slack opens wherever it was left, and one run came up in an empty demo
   * workspace: fifteen pictures of a channel with no messages. So this looks
   * for somewhere with a bit of history -- through the channels in the sidebar
   * first, then the next workspace along, which is what the leftmost column
   * is. Nothing here names a workspace or a channel; the rule is "one with
   * messages in it", which is the thing that actually matters.
   */
  const messageCount = () => evaluate(`document.querySelectorAll('[data-qa="message_container"]').length`);
  const openChannel = (index) => click('[data-qa="channel-sidebar-channel"]', index);
  const describe = () => evaluate(`(() => {
    const count = (sel) => document.querySelectorAll(sel).length;
    return [location.pathname,
      'rows=' + count('[data-qa="channel-sidebar-channel"]'),
      'msgs=' + count('[data-qa="message_container"]'),
      'header=' + (document.querySelector('.p-view_header__text, [data-qa="channel_name"]')?.textContent ?? '-').slice(0, 24),
    ].join(' ');
  })()`);

  const scrollSidebar = () => evaluate(`(() => {
    // The sidebar is a virtual list: only the rows in view exist, so the ones
    // further down cannot be clicked until it has been scrolled to them.
    const list = document.querySelector('.p-channel_sidebar__list, .c-scrollbar__hider');
    if (!list) return 'no sidebar';
    list.scrollTop += 400;
    return 'scrolled to ' + Math.round(list.scrollTop);
  })()`);

  /*
   * The workspaces, by id, and switched with a deep link.
   *
   * Not by clicking: the rail is in the document with all three workspaces in
   * it and measures zero by zero in Slack 4.51, so every click aimed at it
   * landed on the window and reported success while nothing moved. The ids are
   * on the rows all the same -- react-beautiful-dnd puts each one in
   * `data-rbd-draggable-id` -- and `slack://open?team=<id>` switches in place,
   * same document, no reload. Measured, both halves.
   */
  /*
   * Wait for the client before asking it anything. The workspace rail is empty
   * for the first few seconds of a boot, and reading it then came back with no
   * workspaces at all -- after which the search never left whichever
   * conversation Slack happened to open on.
   */
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await evaluate(`Boolean(document.querySelector('[data-qa="team_sidebar_item"], [data-qa="channel-sidebar-channel"]'))`);
    if (ready) break;
    await sleep(1000);
  }

  const workspaces = await evaluate(`[...document.querySelectorAll('[data-qa="team_sidebar_item"]')]
    .map((team) => team.getAttribute('data-rbd-draggable-id')).filter(Boolean)`);
  console.log(`[mods] ${workspaces.length} workspace(s) to look through`);
  const openWorkspace = (team) => evaluate(`(window.location.href = 'slack://open?team=${'${team}'}', true)`
    .replace('${team}', team));

  let messages = 0;
  find: for (const team of workspaces.length ? workspaces : [null]) {
    if (team) {
      await openWorkspace(team);
      await sleep(7000);
      console.log(`[mods] ${await describe()}`);
    }
    for (let batch = 0; batch < 3; batch += 1) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        messages = await messageCount();
        if (messages >= 5) break find;
        await openChannel(attempt);
        await sleep(2500);
      }
      await scrollSidebar();
      await sleep(1500);
    }
  }
  if (messages < 5) {
    throw new Error(`only ${messages} messages on screen: no conversation with any history was found`);
  }
  console.log(`[mods] ${messages} messages on screen`);

  let before = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    /*
     * Read exactly the way the audit reads afterwards, so before and after are
     * the same measurement taken twice. An earlier version sampled the content
     * areas here and the whole window later, and every difference between the
     * two readings arrived as a leak.
     */
    before = await evaluate(`(() => {
      const seen = window.__betterslackRedaction.sample();
      return [...new Set(seen.split(/[^\\p{L}\\p{N}_.:/-]+/u))]
        .filter((word) => word && word.length >= 6).slice(0, 800);
    })()`);
    if (before.length >= 60) break;
    await sleep(1000);
  }
  if (before.length < 60) {
    throw new Error(`only ${before.length} strings on screen: the client is not loaded, and a redaction check against an empty page proves nothing`);
  }

  /*
   * Who is in the room.
   *
   * A profile is opened by user id, and the only place the ids are is the URL
   * of each avatar -- which the redactor is about to replace with a drawing.
   * Read after the sweep this comes back empty; read before the client has
   * drawn a message it comes back empty too, which is why it is here, between
   * the wait above and the sweep below.
   */
  console.log('[mods] people:', await evaluate(`(() => {
    const ids = [...document.querySelectorAll('img[src]')]
      .flatMap((img) => (img.getAttribute('src') ?? '').match(/\\b(U[A-Z0-9]{7,})\\b/g) ?? []);
    window.__betterslackPeople = [...new Set(ids)];
    // The sample comes back too: when this found nothing, the reason was in the
    // shape of the URLs and there was no way to see it from here.
    const sample = document.querySelector('[data-qa="message_container"] img[src^="http"]');
    return window.__betterslackPeople.length + ' ' + (sample?.getAttribute('src') ?? 'no avatar');
  })()`));

  console.log(`[mods] ${before.length} strings on screen to be rid of`);
  console.log('[mods] sweeping:', await evaluate('(window.__betterslackRedaction.start(), "swept")'));
  await sleep(1500);

  /*
   * Anything the redactor itself writes cannot count as a survivor: it removed
   * the original and put its own word in the same place. Filtered here rather
   * than in the redactor so the two halves stay independent -- one replaces,
   * the other audits.
   */
  const invented = new Set(
    (await evaluate('window.__betterslackRedaction.vocabulary')).map((word) => String(word).toLowerCase()),
  );
  /*
   * A word this script wrote is still this script's word with a full stop
   * after it. "agreed.", "minute." and "afternoon." all failed the run on that
   * alone. An address is never split this way -- one of its dot-separated
   * pieces matching a common word would excuse the whole URL.
   */
  const ours = (word) => {
    const lower = String(word).toLowerCase();
    if (invented.has(lower) || CHROME.has(lower)) return true;
    if (/[:/]/.test(lower)) return false;
    return lower.split('.').filter(Boolean).every((piece) => invented.has(piece) || CHROME.has(piece));
  };
  before = before.filter((word) => !ours(word));
  console.log(`[mods] ${before.length} of them are neither Slack's own words nor this script's`);

  /** Re-checked before every frame, not once: Slack keeps rendering. */
  const assertClean = async (label) => {
    const still = await evaluate(`(() => {
      const after = window.__betterslackRedaction.sample();
      return ${JSON.stringify(before)}.filter((word) => after.includes(word));
    })()`);
    if (still.length > 0) {
      const where = await evaluate(`JSON.stringify(window.__betterslackRedaction.locate(${JSON.stringify(still.slice(0, 12))}))`);
      console.error(`[mods] survivors:\n${where}`);
      throw new Error(`${label}: ${still.length} original string(s) came back — ${still.slice(0, 6).join(', ')}`);
    }
    // And the absolute rule, which knows nothing about what was there before.
    const remote = await evaluate('window.__betterslackRedaction.remaining()');
    if (remote.length > 0) {
      const named = remote.slice(0, 4).map((item) => `${item.what} ${item.text}`);
      throw new Error(`${label}: ${remote.length} address(es) still point outside — ${named.join(', ')}`);
    }
  };

  await assertClean('after the first sweep');
  console.log('[mods] nothing of the workspace is left on screen');

  // `pnpm shoot --mods --only=demo-mode`, for one picture that has gone stale.
  const wanted = (process.env.BETTERSLACK_SHOT_ONLY ?? '').split(',').filter(Boolean);
  const todo = wanted.length ? SHOTS.filter((shot) => wanted.includes(shot.id)) : SHOTS;
  if (wanted.length && todo.length !== wanted.length) {
    throw new Error(`no such mod to photograph: ${wanted.filter((id) => !SHOTS.some((s) => s.id === id)).join(', ')}`);
  }

  for (const shot of todo) {
    await evaluate(only([shot.id]));
    await sleep(1200);
    // Anything the picture needs on screen that Slack will not have put there.
    let staged = null;
    if (shot.stage) {
      staged = await evaluate(openFor(shot.stage));
      console.log(`[mods] ${shot.id} stage: ${staged}`);
    }
    // Slack re-renders as mods come and go; sweep whatever it just drew.
    await evaluate('window.__betterslackRedaction.sweep(), true');
    /*
     * Some mods read the screen once and decorate what they found. They ran
     * before the sweep, so what they decorated was the real thing and what is
     * on screen now is untouched invented text -- code with no highlighting on
     * it. Switched off and on, they read the screen as it is.
     */
    if (shot.reapply) {
      await evaluate(only([]));
      await sleep(400);
      await evaluate(only([shot.id]));
      await sleep(1200);
    }
    if (shot.open) console.log(`[mods] ${shot.id} <- ${await evaluate(openFor(shot.open))}`);
    // Long enough for a mod that asks Slack for something -- the member column
    // fetches the channel's people, and a shorter wait photographed one of them.
    await sleep(shot.open === 'profile' ? 4200 : 2600);
    await evaluate('window.__betterslackRedaction.sweep(), true');
    /*
     * A picture that does not show the mod is worse than no picture: it goes
     * into the catalogue looking like every other one and nobody notices for a
     * month. Each entry names something of its own that has to be on screen.
     */
    if (shot.expect) {
      const there = await evaluate(`Boolean(document.querySelector(${JSON.stringify(shot.expect)}))`);
      if (!there) throw new Error(`${shot.id}: nothing matches ${shot.expect}, so the shot would not show it`);
    }
    await assertClean(shot.id);
    if (shot.window) {
      // Tight to the content: the builder's door is one short column, and a
      // taller frame is mostly empty background.
      const taken = await shootWindow(shot.window, shot.id, '900x640');
      if (!taken) throw new Error(`${shot.id}: no window matching ${shot.window} was open`);
    } else {
      await shoot(shot.id, SIZE, 0, shot.hover);
    }
    console.log(`[mods] ${shot.id}`);
    /*
     * Only what this script did. It cleared a composer it had not written to
     * once, which threw away a draft somebody had left there -- a screenshot
     * run may stage what it needs, but only ever undoes its own staging.
     */
    if (shot.undo && staged === 'typed') console.log(`[mods] ${shot.id} undo: ${await evaluate(openFor(shot.undo))}`);
    if (shot.open) await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), window.__betterslack.close(), true`);
  }

  await toJpeg(OUT);
}

async function toJpeg(dir) {
  for (const file of await fs.readdir(dir)) {
    if (!file.endsWith('.png')) continue;
    const png = path.join(dir, file);
    const jpg = png.replace(/\.png$/, '.jpg');
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', png, '--out', jpg]);
    await run('sips', ['--resampleWidth', '1400', jpg]);
    await fs.rm(png);
  }
  console.log(`[mods] wrote ${dir}`);
}
