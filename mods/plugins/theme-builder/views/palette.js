// Palette: the two colours you choose and the ten that follow from them.
//
// The seeds are given the weight they deserve -- a background and an accent
// decide a theme, and everything else is arithmetic. The derived ten are
// secondary, and each says what it paints rather than what it is called: "the
// row under the pointer" is something you can picture, "hover" is not.
//
// Readability sits in the same view because it is the one thing about a palette
// you cannot see by looking at it. Each row is real text in the real pair of
// colours, so the number has something beside it to argue with.

import { contrast, formatCss, readability } from '../colour.js';
import { CONTRAST_CHECKS, ROLES } from '../roles.js';

export function createPaletteView(ctx) {
  const { ui, t } = ctx;
  const { el } = ui;

  const seedRow = el('div', { class: 'seed-row' });
  const roleGrid = el('div', { class: 'role-grid' });
  const checkList = el('div', { class: 'checks' });

  const reroll = ui.button(t('reroll'), {
    variant: 'ghost',
    title: t('rerollHint'),
    onClick: () => {
      ctx.state.roleOverrides = {};
      ctx.apply();
    },
  });

  const node = el('div', { class: 'view' }, [
    ui.card(t('seedsTitle'), [seedRow], { subtitle: t('seedsHint') }),
    ui.card(t('derivedTitle'), [roleGrid], { subtitle: t('derivedHint'), actions: [reroll] }),
    ui.card(t('contrastTitle'), [checkList], { subtitle: t('contrastHint') }),
  ]);

  /** Open the picker on a role, anchored to the card that was clicked. */
  const edit = (role, anchor) => {
    // Kept up while the editor is open: the point of the highlight is to see
    // what is changing, and what is changing is being changed right now.
    ctx.highlightRole(role.key);
    const colours = ctx.palette();
    ctx.openPicker(anchor, {
      value: formatCss(colours[role.key]),
      title: `${t(`role_${role.key}`)} — ${t(`role_${role.key}_hint`)}`,
      reset: role.seed || !ctx.state.roleOverrides[role.key] ? null : {
        label: t('rederiveOne'),
        run: () => {
          delete ctx.state.roleOverrides[role.key];
          ctx.apply();
        },
      },
      onChange: (colour) => {
        if (role.seed) ctx.state.seeds[role.key] = colour;
        else ctx.state.roleOverrides[role.key] = colour;
        ctx.apply();
        ctx.highlightRole(role.key);
      },
      onClose: () => ctx.unhighlight(),
    });
  };

  const refresh = () => {
    const colours = ctx.palette();
    const css = (key) => formatCss(colours[key]);

    seedRow.replaceChildren();
    for (const role of ROLES.filter((r) => r.seed)) {
      const card = el('button', { class: 'seed', type: 'button' }, [
        ui.swatch(css(role.key), { size: 'lg' }),
        el('span', { class: 'seed__meta' }, [
          el('strong', { textContent: t(`role_${role.key}`) }),
          el('span', { class: 'seed__hint', textContent: t(`role_${role.key}_hint`) }),
          el('code', { textContent: css(role.key) }),
        ]),
      ]);
      card.addEventListener('click', () => edit(role, card));
      // Hovering a colour lights up everything it paints, in the real client.
      ui.hoverable(card, {
        enter: () => ctx.highlightRole(role.key),
        leave: () => ctx.unhighlight(),
      });
      seedRow.append(card);
    }

    roleGrid.replaceChildren();
    for (const role of ROLES.filter((r) => !r.seed)) {
      const own = Boolean(ctx.state.roleOverrides[role.key]);
      const card = el('button', { class: 'role', type: 'button' }, [
        ui.swatch(css(role.key)),
        el('span', { class: 'role__meta' }, [
          el('strong', { textContent: t(`role_${role.key}`) }),
          el('span', { textContent: t(`role_${role.key}_hint`) }),
        ]),
        own ? el('span', { class: 'tag', textContent: t('own') }) : el('code', { textContent: css(role.key) }),
      ]);
      card.setAttribute('data-own', String(own));
      card.addEventListener('click', () => edit(role, card));
      ui.hoverable(card, {
        enter: () => ctx.highlightRole(role.key),
        leave: () => ctx.unhighlight(),
      });
      roleGrid.append(card);
    }

    checkList.replaceChildren();
    for (const [fg, bg, label] of CONTRAST_CHECKS) {
      const ratio = contrast(colours[fg], colours[bg]);
      const verdict = readability(ratio);
      const sample = el('span', { class: 'check__sample', textContent: t(label) });
      sample.style.color = css(fg);
      sample.style.background = css(bg);
      const grade = el('span', { class: 'grade', textContent: verdict.grade });
      grade.setAttribute('data-ok', String(verdict.ok));
      checkList.append(el('div', { class: 'check' }, [
        sample,
        el('span', { class: 'check__ratio', textContent: `${ratio.toFixed(1)}:1` }),
        grade,
      ]));
    }
  };

  return { node, refresh };
}
