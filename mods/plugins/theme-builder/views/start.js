// The screen the builder opens on.
//
// Three questions get asked every single time this window appears -- am I
// starting something, am I editing a theme I have, or am I carrying on with
// what I was doing -- and the first version of this answered none of them: it
// opened on a palette of two colours nobody had chosen, over whatever theme
// happened to be switched on, and the work was gone the moment the window
// closed.
//
// A gallery rather than a list, because a theme is a set of colours and a
// dropdown of names says nothing about any of them. Each card shows the
// theme's own palette, read out of its stylesheet -- so the choice is made by
// looking, which is the whole point of a tool like this.
//
// Work is kept through api.settings (the loader's file on disk, not
// localStorage, which is Slack's storage and is wiped by an app update). The
// door is shown every time, draft or no draft: "carry on" has to be a choice,
// or the window can never be used to start anything.

import { stripFrom } from '../read-theme.js';
import { formatCss } from '../colour.js';

export function createStartView(ctx) {
  const { ui, t } = ctx;
  const { el } = ui;

  const node = el('div', { class: 'start' });
  const gallery = el('div', { class: 'gallery' });

  /** One theme, as a card you can see the colours of. */
  const themeCard = (theme, colours) => {
    const strip = el('div', { class: 'gallery__strip' });
    for (const colour of colours) {
      const band = el('span', { class: 'gallery__band' });
      band.style.background = colour;
      strip.append(band);
    }

    const card = el('button', { class: 'gallery__card', type: 'button', title: theme.description }, [
      strip,
      el('span', { class: 'gallery__meta' }, [
        el('strong', { textContent: theme.name }),
        theme.enabled
          ? el('span', { class: 'gallery__badge', textContent: t('startOn') })
          : el('span', { class: 'gallery__hint', textContent: t('startEdit') }),
      ]),
    ]);
    card.addEventListener('click', () =>
      ctx.begin({ base: theme.id, name: t('startCopyName', { name: theme.name }) }));
    return card;
  };

  const refresh = async () => {
    node.replaceChildren();
    const themes = ctx.api.themes.list();
    const active = themes.find((theme) => theme.enabled);
    const draft = ctx.savedDraft();

    node.append(el('header', { class: 'start__head' }, [
      el('h1', { textContent: t('startTitle') }),
      el('p', { textContent: t('startBody') }),
    ]));

    if (draft) {
      const resume = ui.button(t('startResumeGo'), {
        variant: 'primary',
        onClick: () => ctx.resume(draft),
      });
      node.append(el('div', { class: 'resume' }, [
        el('div', { class: 'resume__text' }, [
          el('strong', { textContent: t('startResume') }),
          el('span', {
            textContent: t('startResumeMeta', {
              name: draft.name,
              when: new Date(draft.savedAt).toLocaleString(ctx.api.i18n.locale),
              tokens: Object.keys(draft.tokenOverrides ?? {}).length,
            }),
          }),
        ]),
        resume,
      ]));
    }

    node.append(el('h2', { class: 'start__title', textContent: t('startPick') }));
    node.append(gallery);
    node.append(el('p', { class: 'start__foot', textContent: t('startFoot') }));

    // "New" first, and it says what it will start from -- which is whatever is
    // on screen behind this window.
    gallery.replaceChildren();
    const fresh = el('button', { class: 'gallery__card gallery__card--new', type: 'button' }, [
      el('span', { class: 'gallery__plus', textContent: '+' }),
      el('span', { class: 'gallery__meta' }, [
        el('strong', { textContent: t('startNew') }),
        el('span', {
          class: 'gallery__hint',
          textContent: active ? t('startNewOn', { theme: active.name }) : t('startNewScratch'),
        }),
      ]),
    ]);
    fresh.addEventListener('click', () =>
      ctx.begin({ base: active?.id ?? '', name: t('defaultName') }));
    gallery.append(fresh);

    // The cards go in immediately and colour in as each stylesheet arrives:
    // reading a dozen themes off disk is a round trip each, and a gallery that
    // appears all at once a second late feels slower than one that fills in.
    for (const theme of themes) {
      const placeholder = themeCard(theme, []);
      gallery.append(placeholder);
      void ctx.api.themes.source(theme.id)
        .then((css) => placeholder.replaceWith(themeCard(theme, stripFrom(css).map(formatCss))))
        .catch(() => undefined); // a theme that will not read keeps its card, without colours
    }
  };

  return { node, refresh: () => void refresh() };
}
