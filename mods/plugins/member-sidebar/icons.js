// The glyphs the column and its profile dialog draw with.
//
// Slack's own, lifted path-for-path from its profile pane so the buttons read
// as the ones they stand in for rather than as lookalikes. VIP is drawn to
// match: Slack does not render that button in every workspace, so there was no
// original to copy.

export const icon = (paths) =>
  '<svg viewBox="0 0 20 20" aria-hidden="true" style="height:18px;width:18px;flex:0 0 auto">' +
  paths.map((d) => `<path fill="currentColor" d="${d}"/>`).join('') + '</svg>';

export const HUDDLE_ICON = icon(['M5.094 4.571C3.785 5.825 3 7.444 3 8.966v1.371A3.45 3.45 0 0 1 5.25 9.5h.5c1.064 0 1.75.957 1.75 1.904v5.192c0 .947-.686 1.904-1.75 1.904h-.5c-2.168 0-3.75-1.99-3.75-4.211v-.578q0-.105.005-.211H1.5V8.966c0-2.02 1.024-4.01 2.556-5.478C5.595 2.014 7.711 1 10 1s4.405 1.014 5.944 2.488C17.476 4.956 18.5 6.945 18.5 8.966V13.5h-.005q.005.105.005.211v.578c0 2.221-1.582 4.211-3.75 4.211h-.5c-1.064 0-1.75-.957-1.75-1.904v-5.192c0-.947.686-1.904 1.75-1.904h.5c.864 0 1.635.316 2.25.837V8.966c0-1.522-.785-3.141-2.094-4.395C13.602 3.322 11.844 2.5 10 2.5s-3.602.822-4.906 2.071m9.016 6.508a.5.5 0 0 0-.11.325v5.192c0 .145.05.257.11.325.057.066.109.079.14.079h.5c1.146 0 2.25-1.11 2.25-2.711v-.578C17 12.11 15.896 11 14.75 11h-.5c-.031 0-.083.013-.14.08M3 13.711C3 12.11 4.105 11 5.25 11h.5c.031 0 .083.013.14.08.06.067.11.18.11.324v5.192a.5.5 0 0 1-.11.325c-.057.066-.109.079-.14.079h-.5C4.105 17 3 15.89 3 14.289z']);

export const MESSAGE_ICON = icon(['M10 3a7 7 0 1 0 3.394 13.124.75.75 0 0 1 .542-.074l2.794.68-.68-2.794a.75.75 0 0 1 .073-.542A7 7 0 0 0 10 3m-8.5 7a8.5 8.5 0 1 1 16.075 3.859l.904 3.714a.75.75 0 0 1-.906.906l-3.714-.904A8.5 8.5 0 0 1 1.5 10']);

export const VIP_ICON = icon([
  'M8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M6 6.5a2 2 0 1 1 4 0 2 2 0 0 1-4 0',
  'M8 11.5c-2.9 0-5.25 1.79-5.25 4a.75.75 0 0 0 1.5 0c0-1.24 1.6-2.5 3.75-2.5.62 0 1.2.1 1.72.29a.75.75 0 1 0 .51-1.41A7 7 0 0 0 8 11.5',
  'M15.25 10a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5H16v1.5a.75.75 0 0 1-1.5 0v-1.5H13a.75.75 0 0 1 0-1.5h1.5v-1.5a.75.75 0 0 1 .75-.75',
]);

/** Slack's own overflow glyph, so the button reads as the one it stands in for. */
export const MORE_ICON =
  '<svg data-qa="more-actions" viewBox="0 0 20 20" aria-hidden="true" style="--s:20px;height:20px;width:20px">' +
  '<path fill="currentColor" d="M5 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm6.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z' +
  'm5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>';
