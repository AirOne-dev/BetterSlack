// What the palette can do to Slack itself.
//
// The rest of the palette moves you somewhere. This is the half that changes
// something: your status, your notifications, whether a conversation still
// counts as unread. Every method here was measured against a live workspace
// before it was offered -- an `xoxc` token is refused by more of Slack's API
// than it is allowed by, and a row that fails is worse than a row that is not
// there.
//
//   users.profile.set   works (set, read back and restored on a real account)
//   users.setPresence   exists
//   dnd.setSnooze       exists, and dnd.endSnooze answers ok with no arguments
//   conversations.mark  exists, and needs the conversation's latest timestamp
//
// Two rules the rows follow, both from actions.js:
//
//   * **Contextual rows only when there is context.** "Mark this conversation
//     as read" on a conversation with nothing in it is a row that does nothing,
//     and after the second one nobody reads the list.
//   * **Idle is a menu, typed is a search.** Six status presets on an untyped
//     palette bury the conversations you opened it for, so they wait until
//     somebody types.

/** Status presets, as minutes. Zero means it stays until you clear it. */
const HOUR = 60;

/**
 * The presets, in the order Slack's own dialog offers its equivalents.
 *
 * `key` names the string; the emoji is not translated, because an emoji is the
 * same picture in every language and a translator given one will eventually
 * pick a different one.
 */
const PRESETS = [
  { key: 'statusMeeting', emoji: ':spiral_calendar_pad:', minutes: HOUR },
  { key: 'statusFocusing', emoji: ':headphones:', minutes: 2 * HOUR },
  { key: 'statusLunch', emoji: ':knife_fork_plate:', minutes: 30 },
  { key: 'statusRemote', emoji: ':house_with_garden:', minutes: 'today' },
  { key: 'statusSick', emoji: ':face_with_thermometer:', minutes: 'today' },
  { key: 'statusOff', emoji: ':palm_tree:', minutes: 0 },
];

/** How long notifications can be paused for, in minutes. */
const SNOOZE = [30, HOUR, 2 * HOUR];

/**
 * When a status set now should stop.
 *
 * Slack takes a unix timestamp in seconds, and zero for "until I clear it".
 * "today" is the end of the local day, which is what Slack's own dialog means
 * by it -- not twenty-four hours from now.
 */
function expiryFor(minutes) {
  if (minutes === 0) return 0;
  if (minutes === 'today') {
    const end = new Date();
    end.setHours(23, 59, 59, 0);
    return Math.floor(end.getTime() / 1000);
  }
  return Math.floor(Date.now() / 1000) + minutes * 60;
}

export function createSlackActions(api, t, { directory }) {
  const web = api.slack.web;

  /**
   * A span, as somebody would say it.
   *
   * "for 60 minutes" is a computer talking. The strings have no plural rules,
   * so one and many are separate keys rather than a placeholder.
   */
  const spanOf = (minutes) => {
    if (minutes % HOUR !== 0) return t('forMinutes', { count: minutes });
    const hours = minutes / HOUR;
    return hours === 1 ? t('forHour') : t('forHours', { count: hours });
  };

  /** Slack answers with errors that read like missing features; say which. */
  const run = async (what, promise) => {
    try {
      await promise;
      api.ui.toast(what, { variant: 'success' });
    } catch (err) {
      api.ui.toast(t('actionFailed', { error: err.message }), { variant: 'error' });
    }
  };

  const setStatus = (text, emoji, minutes) => run(
    text ? t('statusSet', { text }) : t('statusCleared'),
    web.call('users.profile.set', {
      // A JSON string, not fields: `users.profile.set` takes the whole profile
      // object under one key, and sending `status_text` on its own is ignored.
      profile: JSON.stringify({
        status_text: text,
        status_emoji: emoji,
        status_expiration: expiryFor(minutes),
      }),
    }),
  );

  /**
   * Whether you are showing as away, read from the screen rather than asked.
   *
   * `users.getPresence` lags the client badly -- worst right after the window
   * comes back to the front, where it reported away for up to a minute while
   * the app plainly said available. Slack swaps this class the moment it
   * changes, so the screen is both faster and right.
   */
  const isAway = () => {
    const dot = document.querySelector('[data-qa="user-button"] .c-presence');
    return dot ? dot.classList.contains('c-presence--away') : false;
  };

  /** The conversation on screen, as something to act on. */
  const here = () => {
    const id = api.slack.currentChannelId();
    if (!id) return null;
    const entry = directory.conversations().find((row) => (row.conversationId ?? row.id) === id);
    return { id, title: entry?.title ?? '', unread: entry?.unread === true };
  };

  /**
   * A link to a conversation, built rather than fetched.
   *
   * `chat.getPermalink` wants a message; a link to the conversation itself is
   * the archives URL, and the workspace domain is already on the web api
   * because the token file carries it.
   */
  const linkTo = (channelId) => {
    const domain = web.teamDomain;
    return domain ? `https://${domain}.slack.com/archives/${channelId}` : null;
  };

  return {
    /**
     * @param query what has been typed. The presets and the notification rows
     *   wait for it; the two rows about the conversation you are looking at do
     *   not, because those are the ones you would open the palette for.
     */
    list: (query) => {
      if (!web.available) return [];
      const asked = query.trim().length > 0;
      const rows = [];
      const at = here();

      if (at) {
        const link = linkTo(at.id);
        if (link) {
          rows.push({
            id: 'do:copy-link',
            title: t('copyLink'),
            subtitle: at.title || undefined,
            icon: '🔗',
            run: () => void api.helpers.copy(link, t('linkCopied')),
          });
        }
        // Only when there is something to mark. Slack takes the conversation's
        // latest timestamp, which is what the counts answer already carries.
        const latest = directory.latestTs(at.id);
        if (at.unread && latest) {
          rows.push({
            id: 'do:mark-read',
            title: t('markRead'),
            subtitle: at.title || undefined,
            icon: '✓',
            run: () => void run(t('markedRead'),
              web.call('conversations.mark', { channel: at.id, ts: latest })),
          });
        }
      }

      rows.push({
        id: 'do:status-editor',
        title: t('setStatus'),
        icon: '💬',
        run: () => void api.slack.openStatusEditor(),
      });

      if (asked) {
        for (const preset of PRESETS) {
          const text = t(preset.key);
          rows.push({
            id: `do:status:${preset.key}`,
            title: t('statusPreset', { text }),
            subtitle: preset.minutes === 0
              ? t('untilCleared')
              : (preset.minutes === 'today' ? t('untilTonight') : spanOf(preset.minutes)),
            icon: '💬',
            run: () => void setStatus(text, preset.emoji, preset.minutes),
          });
        }
        rows.push({
          id: 'do:status-clear',
          title: t('clearStatus'),
          icon: '💬',
          run: () => void setStatus('', '', 0),
        });

        for (const minutes of SNOOZE) {
          rows.push({
            id: `do:snooze:${minutes}`,
            title: t('pauseNotifications', { span: spanOf(minutes) }),
            icon: '🔕',
            run: () => void run(t('notificationsPaused'), web.call('dnd.setSnooze', { num_minutes: minutes })),
          });
        }
        rows.push({
          id: 'do:snooze-end',
          title: t('resumeNotifications'),
          icon: '🔔',
          run: () => void run(t('notificationsResumed'), web.call('dnd.endSnooze')),
        });

        const away = isAway();
        rows.push({
          id: 'do:presence',
          title: away ? t('setActive') : t('setAway'),
          icon: away ? '🟢' : '⚪',
          // `auto` rather than `active`: Slack decides from the client's own
          // activity, which is what its own menu goes back to.
          run: () => void run(away ? t('nowActive') : t('nowAway'),
            web.call('users.setPresence', { presence: away ? 'auto' : 'away' })),
        });
      }

      return rows.map((row) => ({ ...row, section: t('sectionSlack'), source: 'Slack' }));
    },
  };
}
