/**
 * User Inspector — everything Slack's API knows about a member.
 *
 * Slack's profile pane shows a handful of fields. `users.info` returns roughly
 * fifty, and `users.getPresence` / `dnd.info` add a few more. This surfaces all
 * of them.
 *
 * Where the data comes from: `api.slack.web`, the audited wrapper around
 * Slack's own API (src/runtime/web-api.ts). Requests can only reach Slack's own
 * origin, and this plugin never touches localStorage or the session token
 * itself. Nothing is sent anywhere; the responses are rendered and dropped.
 */

const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true" width="16" height="16" style="margin-right:6px">
  <path fill="currentColor" fill-rule="evenodd" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM3.5 10a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z" clip-rule="evenodd"/>
  <path fill="currentColor" d="M10 8.75a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .75-.75Zm0-2.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/>
</svg>`;

/** Fields worth showing first, in a sensible reading order. */
const IDENTITY = ['id', 'name', 'real_name', 'team_id', 'color', 'updated'];
const ROLES = [
  'is_admin', 'is_owner', 'is_primary_owner', 'is_bot', 'is_app_user',
  'is_restricted', 'is_ultra_restricted', 'deleted', 'is_email_confirmed',
];
const LOCALE = ['tz', 'tz_label', 'tz_offset', 'locale'];
const PROFILE = [
  'display_name', 'real_name', 'title', 'phone', 'email', 'skype',
  'status_text', 'status_emoji', 'status_expiration', 'avatar_hash', 'is_custom_image',
];

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Slack timestamps are seconds; show something a human can read. */
function formatMaybeDate(key, value) {
  if (typeof value !== 'number' || value <= 0) return formatValue(value);
  if (!/updated|expiration|_ts$/.test(key)) return formatValue(value);
  return `${new Date(value * 1000).toLocaleString()}  (${value})`;
}

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    api.css(`
      .slackmod-profile-row { padding: 8px 20px 12px; }
      .slackmod-profile-row .c-button { width: 100%; display: inline-flex; align-items: center; justify-content: center; }
      .sm-insp-section { margin: 0 0 18px; }
      .sm-insp-section > h3 {
        margin: 0 0 8px; font-size: 11px; letter-spacing: .6px; text-transform: uppercase;
        color: var(--dt_color-content-sec, #454447);
      }
      .sm-insp-grid { display: grid; grid-template-columns: minmax(120px, auto) 1fr; gap: 4px 16px; font-size: 13px; }
      .sm-insp-grid dt { color: var(--dt_color-content-sec, #454447); }
      .sm-insp-grid dd { margin: 0; word-break: break-word; font-variant-numeric: tabular-nums; }
      .sm-insp-images { display: flex; flex-wrap: wrap; gap: 8px; }
      .sm-insp-images a {
        font-size: 12px; padding: 4px 8px; border-radius: 6px; text-decoration: none;
        border: 1px solid var(--dt_color-otl-sec, rgba(94,93,96,.35));
        color: var(--dt_color-content-hgl-1, #1264a3);
      }
      .sm-insp-raw {
        width: 100%; min-height: 220px; font: 12px/1.5 Monaco, Menlo, monospace;
        border-radius: 8px; padding: 10px; color: inherit;
        background: var(--dt_color-base-sec, #f8f8f8);
        border: 1px solid var(--dt_color-otl-sec, rgba(94,93,96,.35));
      }
    `);

    const section = (title, rows) => {
      const grid = api.dom.h('dl', { class: 'sm-insp-grid' });
      for (const [key, value] of rows) {
        grid.append(api.dom.h('dt', {}, [key]));
        grid.append(api.dom.h('dd', {}, [formatMaybeDate(key, value)]));
      }
      return api.dom.h('div', { class: 'sm-insp-section' }, [
        api.dom.h('h3', {}, [title]),
        grid,
      ]);
    };

    const pick = (source, keys) =>
      keys.filter((k) => source && k in source).map((k) => [k, source[k]]);

    const render = (body, data) => {
      const { user, presence, dnd, error } = data;
      body.replaceChildren();

      if (error) {
        body.append(api.dom.h('p', {}, [error]));
        return;
      }

      const profile = user.profile ?? {};

      body.append(section('Identity', pick(user, IDENTITY)));
      body.append(section('Roles', pick(user, ROLES)));
      body.append(section('Locale and time', pick(user, LOCALE)));
      body.append(section('Profile', pick(profile, PROFILE)));

      // Custom workspace fields, which vary per organisation.
      const custom = profile.fields;
      if (custom && typeof custom === 'object' && Object.keys(custom).length > 0) {
        body.append(
          section(
            'Custom fields',
            Object.entries(custom).map(([id, field]) => [id, field?.value ?? field?.alt ?? '']),
          ),
        );
      }

      if (presence) body.append(section('Presence', Object.entries(presence).filter(([k]) => k !== 'ok')));
      if (dnd) body.append(section('Do not disturb', Object.entries(dnd).filter(([k]) => k !== 'ok')));

      // Every avatar size Slack has, largest first.
      const images = Object.keys(profile)
        .filter((k) => k.startsWith('image_'))
        .sort((a, b) => (a === 'image_original' ? -1 : b === 'image_original' ? 1 : Number(b.slice(6)) - Number(a.slice(6))));
      if (images.length > 0) {
        const row = api.dom.h('div', { class: 'sm-insp-images' });
        for (const key of images) {
          row.append(
            api.dom.h('a', { href: profile[key], target: '_blank', rel: 'noreferrer' }, [
              key.replace('image_', ''),
            ]),
          );
        }
        body.append(api.dom.h('div', { class: 'sm-insp-section' }, [
          api.dom.h('h3', {}, ['Avatars']),
          row,
        ]));
      }

      const raw = api.dom.h('textarea', { class: 'sm-insp-raw', readonly: 'readonly', spellcheck: 'false' });
      raw.value = JSON.stringify(data, null, 2);
      body.append(api.dom.h('div', { class: 'sm-insp-section' }, [
        api.dom.h('h3', {}, ['Raw response']),
        raw,
      ]));
    };

    const inspect = async (userId) => {
      if (!userId) {
        api.ui.toast('Could not tell which user this is', { variant: 'error' });
        return;
      }
      if (!api.slack.web.available) {
        api.ui.toast('No Slack session token for this workspace', { variant: 'error' });
        return;
      }

      const handle = api.ui.modal({
        title: 'User details',
        subtitle: `Loading ${userId}…`,
        content: api.dom.h('p', {}, ['…']),
        width: 720,
        actions: [
          {
            label: 'Copy JSON',
            onClick: async () => {
              const raw = handle.body.querySelector('.sm-insp-raw');
              if (!raw) return false;
              await navigator.clipboard.writeText(raw.value);
              api.ui.toast('Copied', { variant: 'success' });
              return false; // keep the dialog open
            },
          },
          { label: 'Close', variant: 'primary' },
        ],
      });

      try {
        const user = await api.slack.web.userInfo(userId);
        // These two are allowed to fail: bots have no presence, and dnd.info
        // is not readable in every workspace.
        const [presence, dnd] = await Promise.all([
          api.slack.web.presence(userId).catch(() => null),
          api.slack.web.dndInfo(userId).catch(() => null),
        ]);
        render(handle.body, { user, presence, dnd });
      } catch (err) {
        api.log.error(err);
        render(handle.body, { error: `Slack refused the request: ${err.message}` });
      }
    };

    api.slack.addProfileButton({
      id: 'details',
      label: 'Details',
      icon: ICON,
      onClick: (pane) => inspect(pane.userId),
    });
  },

  stop() {},
};
