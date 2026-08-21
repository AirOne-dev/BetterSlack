// The BetterSlack mark, for the two places in the client that draw it.
//
// One copy, because there are already several: `assets/mark.svg` is the
// original, `site/mark.svg` is the site's copy (it is published on its own and
// cannot reach assets/), and `assets/icon.icns` is built from it. A fourth,
// pasted into whichever file needed it next, is how a redrawn mark ends up
// shipping in one place and not the other -- so the launcher in Slack's rail
// and the panel's header read this, and `tests/mark.test.mjs` fails if it has
// drifted from the file it was taken from.
//
// Four colours of its own rather than `currentColor`: it sits among Slack's
// outline icons and the one button that is not Slack's should not pretend to
// be. The trade-off is that it cannot dim and brighten with its neighbours on
// hover, which LAUNCHER_CSS does with opacity instead.

export const MARK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 848 848" aria-hidden="true" data-qa="betterslack-mark">
  <rect x="139" y="289" width="121" height="421" rx="60.5" fill="#E01858"/>
  <path d="M288 499C288 465.587 315.087 438 348.5 438H410V499.5C410 532.913 382.413 560 349 560V560C315.587 560 288 532.413 288 499V499Z" fill="#E01858"/>
  <rect x="560" y="139" width="121" height="421" rx="60.5" transform="rotate(90 560 139)" fill="#30C0F0"/>
  <path d="M349 288C382.413 288 410 315.087 410 348.5L410 410L348.5 410C315.087 410 288 382.413 288 349V349C288 315.587 315.587 288 349 288V288Z" fill="#30C0F0"/>
  <rect x="709" y="560" width="121" height="421" rx="60.5" transform="rotate(-180 709 560)" fill="#28B078"/>
  <path d="M560 349C560 382.413 532.913 410 499.5 410L438 410L438 348.5C438 315.087 465.587 288 499 288V288C532.413 288 560 315.587 560 349V349Z" fill="#28B078"/>
  <rect x="288" y="710" width="121" height="421" rx="60.5" transform="rotate(-90 288 710)" fill="#E8B028"/>
  <path d="M499 560C465.587 560 438 532.913 438 499.5L438 438L499.5 438C532.913 438 560 465.587 560 499V499C560 532.413 532.413 560 499 560V560Z" fill="#E8B028"/>
</svg>`;
