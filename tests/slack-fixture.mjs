// A Slack-shaped fragment: rail, sidebar, a message, a composer, a profile pane.
//
// Its own file because two things need it and neither should own it: the test
// harness hands it to jsdom, and the API page mounts it so `addToolbarButton`
// and friends have somewhere real to land. A second copy would drift, and the
// one that drifts is always the one nobody runs.

export const SLACK_FIXTURE = `
<div class="p-client_container">
  <div class="p-view_header__actions">
    <button data-qa="avatar_stack" aria-label="View all members"></button>
  </div>
  <div class="p-control_strip">
    <div class="c-coachmark-anchor">
      <button data-qa="user-button">
        <span class="c-avatar" data-mask="mask__base-member">
          <img src="https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE1-480e63356723-48">
          <!-- Where Slack keeps your own availability, and swaps the modifier
               the moment it changes. Measured against Slack 4.51. -->
          <span class="c-avatar__presence c-presence c-presence--active block"></span>
        </span>
        <svg data-qa="presence_indicator" aria-label="Active"></svg>
      </button>
    </div>
  </div>

  <div class="p-tab_rail p-tab_rail__desktop" data-qa="tab_rail_desktop">
    <div class="p-tab_rail__tab_container" data-qa="tabs_full_height_class">
      <div class="p-tab_rail__tab_menu" data-qa="tabs_full_width_class">
        <button class="p-tab_rail__button p-tab_rail__button--active" data-qa="tab_rail_home_button">
          <div class="p-tab_rail__button__icon"></div>
          <div class="p-tab_rail__button__label">Home</div>
        </button>
        <button class="p-tab_rail__button" data-qa="tab_rail_dms_button">
          <div class="p-tab_rail__button__icon"></div>
          <div class="p-tab_rail__button__label">DMs</div>
        </button>
      </div>
    </div>
  </div>

  <div class="p-client_workspace__tabpanel">
  <div class="p-channel_sidebar" data-qa="channel-sidebar">
    <div class="p-ia4_sidebar_header p-ia4_home_header">
      <div class="p-ia4_sidebar_header__title">Acme</div>
      <div class="p-ia4_sidebar_header__controls"></div>
    </div>
    <div class="p-channel_sidebar__list"></div>
  </div>

  <div class="p-view_contents p-view_contents--primary">
    <div class="p-message_pane">
      <div data-qa="message_container"
           data-msg-ts="1786386808.130969"
           data-msg-channel-id="C0BFQCYBRAB">
        <div class="c-message_kit__avatar">
          <img src="https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE2-dc5119d9e23c-48">
        </div>
        <a class="c-timestamp" href="https://acme.slack.com/archives/C0BFQCYBRAB/p1786386808130969"></a>
        <div data-qa="message-text">hello world</div>
        <div data-qa="message-actions"></div>
      </div>

      <div data-qa="message_input">
        <div class="ql-editor"><p><br></p></div>
        <div><button data-qa="bold-composer-button"></button></div>
      </div>
    </div>
  </div>
  </div>

  <div data-qa="member_profile_pane">
    <div class="p-r_member_profile__container">
      <img class="p-r_member_profile__avatar__img"
           src="https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE2-dc5119d9e23c-512">
    </div>
  </div>
</div>`;
