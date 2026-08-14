// The screen the builder opens on.
//
// Three questions get asked every single time this window appears -- am I
// starting something, am I editing a theme I have, or am I carrying on with
// what I was doing -- and the version before this answered none of them: it
// opened on a palette of two colours nobody had chosen, over whatever theme
// happened to be switched on, and the work was gone the moment the window
// closed.
//
// So work is kept (api.settings, which the loader persists to disk, not
// localStorage -- the renderer is wiped on every Slack update) and this is the
// door. It is shown on every open, including when there is a draft: "carry on"
// has to be a choice, or the window can never be used to start anything.

export function createStartView(ctx) {
  const { ui, t } = ctx;
  const { el } = ui;

  const node = el('div', { class: 'start' });

  /** One of the three doors: a title, a sentence, and what it does. */
  const choice = ({ title, body, action, onPick, primary, meta }) => {
    const card = el('button', { class: 'start__card', type: 'button' }, [
      el('div', { class: 'start__text' }, [
        el('strong', { textContent: title }),
        el('span', { textContent: body }),
        meta ? el('em', { textContent: meta }) : null,
      ]),
      el('span', { class: `start__go${primary ? ' start__go--primary' : ''}`, textContent: action }),
    ]);
    card.addEventListener('click', onPick);
    return card;
  };

  const refresh = () => {
    node.replaceChildren();

    const themes = ctx.api.themes.list();
    const active = themes.find((theme) => theme.enabled);
    const draft = ctx.savedDraft();

    node.append(el('header', { class: 'start__head' }, [
      el('h1', { textContent: t('startTitle') }),
      el('p', { textContent: t('startBody') }),
    ]));

    const list = el('div', { class: 'start__choices' });

    list.append(choice({
      title: t('startNew'),
      body: active ? t('startNewOn', { theme: active.name }) : t('startNewScratch'),
      action: t('startNewGo'),
      primary: true,
      onPick: () => ctx.begin({ base: active?.id ?? '', name: t('defaultName') }),
    }));

    // Editing an existing theme means using it as the base and working on top:
    // its CSS cannot be turned back into twelve roles, and pretending it can
    // would quietly throw away everything it does that a palette cannot say.
    const picker = ui.select(
      [{ value: '', label: t('startPickPlaceholder') }, ...themes.map((theme) => ({
        value: theme.id,
        label: theme.enabled ? t('startThemeActive', { name: theme.name }) : theme.name,
      }))],
    );
    const openIt = ui.button(t('startOpenGo'), {
      variant: 'default',
      onClick: () => {
        if (!picker.value) return;
        const theme = themes.find((item) => item.id === picker.value);
        ctx.begin({ base: theme.id, name: t('startCopyName', { name: theme.name }) });
      },
    });
    list.append(el('div', { class: 'start__card start__card--form' }, [
      el('div', { class: 'start__text' }, [
        el('strong', { textContent: t('startOpen') }),
        el('span', { textContent: t('startOpenBody') }),
      ]),
      el('div', { class: 'start__form' }, [picker, openIt]),
    ]));

    if (draft) {
      list.append(choice({
        title: t('startResume'),
        body: t('startResumeBody'),
        meta: t('startResumeMeta', {
          name: draft.name,
          when: new Date(draft.savedAt).toLocaleString(ctx.api.i18n.locale),
          tokens: Object.keys(draft.tokenOverrides ?? {}).length,
        }),
        action: t('startResumeGo'),
        onPick: () => ctx.resume(draft),
      }));
    }

    node.append(list);
    node.append(el('p', { class: 'start__foot', textContent: t('startFoot') }));
  };

  return { node, refresh };
}
