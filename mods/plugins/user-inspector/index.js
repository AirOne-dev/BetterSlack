/**
 * User Inspector — everything Slack's API knows, shown inside the profile.
 *
 * Slack's profile pane shows a handful of fields. `users.info` returns roughly
 * fifty, and `users.getPresence` / `dnd.info` add a few more. Rather than
 * putting those in a dialog, this appends more sections to the pane itself,
 * built from Slack's own section markup — same headers, same label/value rows,
 * same spacing — so it reads as part of the profile rather than as an add-on.
 *
 * Where the data comes from: `api.slack.web`, the audited wrapper around
 * Slack's own API (src/runtime/web-api.ts). Requests can only reach Slack's own
 * origin, and this plugin never touches localStorage or the session token
 * itself. Nothing is sent anywhere.
 */

/**
 * Anchor on the pane, not on `.p-r_member_profile__container` inside it: that
 * inner container is present in some profile variants and absent in others, so
 * targeting it means the sections silently fail to appear half the time.
 */
const PANE = '[data-qa="member_profile_pane"]';
const NODE_ID = 'slackmod-user-details';

/** Boolean flags worth surfacing, in the order they matter. */
const ROLE_LABELS = [
  ['is_primary_owner', 'Primary owner'],
  ['is_owner', 'Owner'],
  ['is_admin', 'Admin'],
  ['is_bot', 'Bot'],
  ['is_app_user', 'App user'],
  ['is_restricted', 'Guest'],
  ['is_ultra_restricted', 'Single-channel guest'],
  ['deleted', 'Deactivated'],
  ['is_email_confirmed', 'Email confirmed'],
];

const PRESENCE_LABELS = { active: 'Active', away: 'Away' };

function formatTimestamp(seconds) {
  if (typeof seconds !== 'number' || seconds <= 0) return null;
  return new Date(seconds * 1000).toLocaleString();
}

function localTimeFor(offsetSeconds) {
  if (typeof offsetSeconds !== 'number') return null;
  const now = new Date();
  const local = new Date(now.getTime() + (offsetSeconds + now.getTimezoneOffset() * 60) * 1000);
  return local.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Roles a user actually has, as readable labels. */
export function rolesOf(user) {
  return ROLE_LABELS.filter(([key]) => user?.[key] === true).map(([, label]) => label);
}

/** The rows this plugin adds, as [label, value] pairs, ready to render. */
export function buildRows({ user, presence, dnd }) {
  const profile = user?.profile ?? {};
  const rows = [];
  const push = (label, value) => {
    if (value !== null && value !== undefined && value !== '') rows.push([label, String(value)]);
  };

  push('User ID', user?.id);
  push('Username', user?.name);
  push('Roles', rolesOf(user).join(' · '));
  push('Title', profile.title);
  push('Phone', profile.phone);

  if (user?.tz) {
    const local = localTimeFor(user.tz_offset);
    push('Time zone', local ? `${user.tz_label ?? user.tz} — ${local} their time` : user.tz_label ?? user.tz);
  }
  push('Locale', user?.locale);

  if (presence?.presence) {
    const label = PRESENCE_LABELS[presence.presence] ?? presence.presence;
    push('Presence', presence.auto_away ? `${label} (auto)` : label);
  }
  if (dnd?.dnd_enabled) {
    const until = formatTimestamp(dnd.next_dnd_end_ts);
    push('Do not disturb', until ? `On until ${until}` : 'On');
  }

  push('Status', [profile.status_emoji, profile.status_text].filter(Boolean).join(' '));
  push('Profile updated', formatTimestamp(user?.updated));

  // Workspace-defined fields vary per organisation; show whatever is filled in.
  const custom = profile.fields;
  if (custom && typeof custom === 'object') {
    for (const [id, field] of Object.entries(custom)) {
      push(field?.label ?? id, field?.value ?? field?.alt);
    }
  }

  return rows;
}

/** Avatar renditions Slack holds, largest first. */
export function avatarSizes(profile) {
  return Object.keys(profile ?? {})
    .filter((key) => key.startsWith('image_') && typeof profile[key] === 'string')
    .sort((a, b) => {
      if (a === 'image_original') return -1;
      if (b === 'image_original') return 1;
      return Number(b.slice(6)) - Number(a.slice(6));
    })
    .map((key) => ({
      key,
      label: key === 'image_original' ? 'original' : `${key.slice(6)}px`,
      url: profile[key],
    }));
}

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    // Slack's own classes do the heavy lifting; this only covers the few things
    // it has no class for.
    api.css(`
      #${NODE_ID} .slackmod-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
      #${NODE_ID} .slackmod-chip {
        font-size: 12px; padding: 2px 8px; border-radius: 999px;
        border: 1px solid var(--dt_color-otl-sec, rgba(94, 93, 96, .35));
        color: var(--dt_color-content-sec, #454447);
      }
      #${NODE_ID} .slackmod-muted { color: var(--dt_color-content-ter, #5e5d60); font-size: 13px; }
      #${NODE_ID} .slackmod-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    `);

    const cache = new Map();

    const field = (label, value) =>
      api.dom.h('div', { class: 'p-rimeto_member_profile_field__contact_info' }, [
        api.dom.h('div', { class: 'p-rimeto_member_profile_field' }, [
          api.dom.h('div', { class: 'p-rimeto_member_profile_field__primary' }, [
            api.dom.h('div', { class: 'p-rimeto_member_profile_field__label' }, [label]),
            api.dom.h('div', { class: 'p-rimeto_member_profile_field__value' }, [value]),
          ]),
        ]),
      ]);

    /** Slack's section shell: a header row and a content block. */
    const section = (title, children) =>
      api.dom.h('div', { class: 'p-r_member_profile_section' }, [
        api.dom.h('div', { style: 'display: flex;' }, [
          api.dom.h('div', { class: 'p-r_member_profile_section_header', style: 'flex: 1 1 0%;' }, [title]),
        ]),
        api.dom.h('div', { class: 'p-r_member_profile_section_content' }, children),
      ]);

    const render = (host, data) => {
      host.replaceChildren();

      if (data.error) {
        host.append(section('More details', [
          api.dom.h('div', { class: 'slackmod-muted' }, [data.error]),
        ]));
        return;
      }
      if (!data.user) {
        host.append(section('More details', [
          api.dom.h('div', { class: 'slackmod-muted' }, ['Loading…']),
        ]));
        return;
      }

      const rows = buildRows(data);
      const roleChips = rolesOf(data.user);

      const details = rows
        .filter(([label]) => label !== 'Roles')
        .map(([label, value]) => field(label, value));

      if (roleChips.length > 0) {
        details.unshift(
          api.dom.h('div', { class: 'p-rimeto_member_profile_field__contact_info' }, [
            api.dom.h('div', { class: 'p-rimeto_member_profile_field' }, [
              api.dom.h('div', { class: 'p-rimeto_member_profile_field__primary' }, [
                api.dom.h('div', { class: 'p-rimeto_member_profile_field__label' }, ['Roles']),
                api.dom.h('div', { class: 'slackmod-chips' },
                  roleChips.map((r) => api.dom.h('span', { class: 'slackmod-chip' }, [r]))),
              ]),
            ]),
          ]),
        );
      }

      host.append(section('More details', details));

      const sizes = avatarSizes(data.user.profile);
      if (sizes.length > 0) {
        const links = api.dom.h('div', { class: 'slackmod-chips' });
        for (const size of sizes) {
          links.append(
            api.dom.h('a', {
              class: 'slackmod-chip c-link',
              href: size.url,
              target: '_blank',
              rel: 'noreferrer',
            }, [size.label]),
          );
        }
        host.append(section('Avatar', [
          api.dom.h('div', { class: 'p-rimeto_member_profile_field__label' }, ['Available sizes']),
          links,
        ]));
      }

      // The full response, for anything the rows above do not cover.
      const copy = api.dom.h('button', {
        class: 'c-button c-button--outline c-button--medium',
        type: 'button',
      }, ['Copy raw JSON']);
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
          api.ui.toast('Copied the full API response', { variant: 'success' });
        } catch (err) {
          api.log.error(err);
          api.ui.toast('Could not copy', { variant: 'error' });
        }
      });
      host.append(section('Raw data', [
        api.dom.h('div', { class: 'slackmod-muted' }, [
          `${Object.keys(data.user).length} fields from users.info, plus presence and do-not-disturb.`,
        ]),
        api.dom.h('div', { class: 'slackmod-actions' }, [copy]),
      ]));
    };

    const load = async (userId) => {
      if (cache.has(userId)) return cache.get(userId);
      const data = await (async () => {
        try {
          const user = await api.slack.web.userInfo(userId);
          // Both are allowed to fail: bots have no presence, and dnd.info is
          // not readable in every workspace.
          const [presence, dnd] = await Promise.all([
            api.slack.web.presence(userId).catch(() => null),
            api.slack.web.dndInfo(userId).catch(() => null),
          ]);
          return { user, presence, dnd };
        } catch (err) {
          api.log.error(err);
          return { error: `Slack refused the request: ${err.message}` };
        }
      })();
      cache.set(userId, data);
      return data;
    };

    // keepMounted rather than a one-shot insert: Slack re-renders the pane when
    // presence changes or the profile is reopened, and this puts the sections
    // back without ever producing two copies.
    api.dom.keepMounted(PANE, NODE_ID, () => {
      const host = api.dom.h('div', {});
      const avatar = document.querySelector('.p-r_member_profile__avatar__img');
      const userId = (avatar?.src?.match(/\/T[A-Z0-9]+-(U[A-Z0-9]+)-/i) ?? [])[1]?.toUpperCase();

      if (!userId) {
        render(host, { error: 'Could not tell which user this profile belongs to.' });
        return host;
      }
      if (!api.slack.web.available) {
        render(host, { error: 'No Slack session token for this workspace.' });
        return host;
      }

      // Cached profiles render on the spot; the rest fill in a moment later.
      if (cache.has(userId)) render(host, cache.get(userId));
      else {
        render(host, {});
        void load(userId).then((data) => {
          if (host.isConnected) render(host, data);
        });
      }
      return host;
    });
  },

  stop() {},
};
