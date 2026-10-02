// What BetterSlack writes into Slack's own settings file, and where.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withPrefs, checkPref } from '../dist/slack-settings.mjs';

const fileWith = (extra = {}) => ({
  settings: {
    notificationPlayback: 'system',
    windowVibrancy: false,
    slackDefaults: { notificationPlayback: 'web', windowVibrancy: false },
    userChoices: { notificationPlayback: 'system' },
    itPolicy: {},
    ...extra,
  },
  webapp: { teams: { T1: { notificationPrefs: { notificationSound: 'knock_brush.mp3' } } } },
});

test('a value reaches the layer Slack rebuilds its settings from', () => {
  const { changed, state } = withPrefs(fileWith(), { notificationPlayback: 'web' });
  assert.equal(changed, true);
  assert.equal(state.settings.notificationPlayback, 'web');
  // The one that wins at the next launch: without it, "system" came back.
  assert.equal(state.settings.userChoices.notificationPlayback, 'web');
});

test('the window material is mirrored into Slack\'s defaults as well', () => {
  const { state } = withPrefs(fileWith(), { windowVibrancy: true });
  assert.equal(state.settings.slackDefaults.windowVibrancy, true);
  assert.equal(state.settings.userChoices.windowVibrancy, true);
});

test('nothing else in the file is touched, and an administrator\'s policy least of all', () => {
  const before = fileWith({ itPolicy: { notificationPlayback: 'system' } });
  const { state } = withPrefs(before, { notificationPlayback: 'web' });
  assert.deepEqual(state.settings.itPolicy, { notificationPlayback: 'system' });
  assert.deepEqual(state.webapp, fileWith().webapp);
});

test('a key off the list is refused by name', () => {
  assert.match(checkPref('signInMethod', 'browser'), /not a Slack preference/);
  const { changed } = withPrefs(fileWith(), { signInMethod: 'browser' });
  assert.equal(changed, false);
});
