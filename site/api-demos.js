"use strict";
(() => {
  // src/runtime/dom.ts
  var REMOUNT_LIMIT = 25;
  var REMOUNT_WINDOW_MS = 2e3;
  var mountCounts = /* @__PURE__ */ new Map();
  function keepMounted(containerSelector, nodeId, factory, options = {}) {
    const { position = "append", before } = typeof options === "string" ? { position: options, before: void 0 } : options;
    let disposed = false;
    let attempts = [];
    const countAttempt = () => {
      const now = Date.now();
      attempts = attempts.filter((t) => now - t < REMOUNT_WINDOW_MS);
      attempts.push(now);
      if (attempts.length <= REMOUNT_LIMIT) return true;
      disposed = true;
      observer.disconnect();
      console.error(
        `[betterslack] giving up on "${nodeId}": it moved or was re-added ${attempts.length} times in ${REMOUNT_WINDOW_MS}ms, so something else owns "${containerSelector}". Anchor it with \`before\` or pick another container.`
      );
      document.getElementById(nodeId)?.remove();
      return false;
    };
    const mount = () => {
      if (disposed) return;
      const container = document.querySelector(containerSelector);
      if (!container) return;
      const anchor = before ? container.querySelector(before) : null;
      const current = document.getElementById(nodeId);
      if (current && container.contains(current)) {
        const misplaced = anchor !== null && anchor !== current && (current.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING) === 0;
        if (misplaced && countAttempt()) anchor.before(current);
        return;
      }
      if (!countAttempt()) return;
      mountCounts.set(nodeId, (mountCounts.get(nodeId) ?? 0) + 1);
      current?.remove();
      const node = factory();
      node.id = nodeId;
      if (anchor) anchor.before(node);
      else if (position === "prepend") container.prepend(node);
      else container.append(node);
    };
    mount();
    const observer = new MutationObserver(() => mount());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => {
      disposed = true;
      observer.disconnect();
      document.getElementById(nodeId)?.remove();
    };
  }
  function onEach(selector, handler) {
    const seen = /* @__PURE__ */ new WeakSet();
    const scan = () => {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        try {
          handler(element);
        } catch (err) {
          console.error("[betterslack] onEach handler threw", err);
        }
      }
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }
  function onShortcut(match, handler) {
    const listener = (event) => {
      if (!match(event)) return;
      event.preventDefault();
      event.stopPropagation();
      handler(event);
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }
  function h(tag, attrs = {}, children = []) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") element.className = value;
      else element.setAttribute(key, value);
    }
    for (const child of children) {
      element.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return element;
  }

  // src/runtime/ui/tooltip.ts
  var SHOW_DELAY_MS = 150;
  var EDGE_OVERLAP = 4;
  var VIEWPORT_MARGIN = 8;
  function attachTooltip(trigger, options) {
    const { title, subtitle, placement = "right", delayMs = SHOW_DELAY_MS } = options;
    trigger.removeAttribute("title");
    trigger.setAttribute("aria-label", subtitle ? `${title}. ${subtitle}` : title);
    let layer = null;
    let timer;
    const build = () => {
      const tip = h("div", {
        class: `c-tooltip__tip c-tooltip__tip--${placement} c-tooltip__tip--small`,
        "data-qa": "tooltip-tip",
        "data-sk": "tooltip"
      }, [h("div", {}, [title])]);
      if (subtitle) tip.append(h("div", { class: "c-tooltip__subtitle" }, [subtitle]));
      tip.append(h("div", { class: "c-tooltip__tip__arrow", "data-qa": "tooltip-tip-arrow" }));
      return h("div", {
        class: "betterslack-tooltip",
        role: "tooltip",
        "data-qa": "tooltip-popover",
        style: "position: fixed; top: 0; left: 0; z-index: 1001; pointer-events: none; will-change: transform; transition: opacity 80ms ease;"
      }, [h("div", { role: "presentation" }, [tip])]);
    };
    const position = (node) => {
      const t = trigger.getBoundingClientRect();
      const { width: w, height: hgt } = node.getBoundingClientRect();
      let left;
      let top;
      switch (placement) {
        case "left":
          left = t.left - w + EDGE_OVERLAP;
          top = t.top + t.height / 2 - hgt / 2;
          break;
        case "top":
          left = t.left + t.width / 2 - w / 2;
          top = t.top - hgt + EDGE_OVERLAP;
          break;
        case "bottom":
          left = t.left + t.width / 2 - w / 2;
          top = t.bottom - EDGE_OVERLAP;
          break;
        default:
          left = t.right - EDGE_OVERLAP;
          top = t.top + t.height / 2 - hgt / 2;
      }
      left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - w - VIEWPORT_MARGIN);
      top = Math.min(Math.max(top, VIEWPORT_MARGIN), window.innerHeight - hgt - VIEWPORT_MARGIN);
      node.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    };
    const show = () => {
      if (layer || !trigger.isConnected) return;
      layer = build();
      layer.style.visibility = "hidden";
      document.body.append(layer);
      position(layer);
      layer.style.visibility = "";
    };
    const hide = () => {
      clearTimeout(timer);
      timer = void 0;
      layer?.remove();
      layer = null;
    };
    const scheduleShow = (immediate = false) => {
      if (layer) return;
      clearTimeout(timer);
      timer = setTimeout(show, immediate ? 0 : delayMs);
    };
    const onEnter = () => scheduleShow();
    const onLeave = () => hide();
    const onFocus = (event) => {
      if (trigger.matches(":focus-visible")) scheduleShow(true);
      else ;
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") hide();
    };
    trigger.addEventListener("mouseenter", onEnter);
    trigger.addEventListener("mouseleave", onLeave);
    trigger.addEventListener("mousedown", onLeave);
    trigger.addEventListener("click", onLeave);
    trigger.addEventListener("focus", onFocus);
    trigger.addEventListener("blur", onLeave);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onLeave, true);
    window.addEventListener("resize", onLeave);
    return () => {
      hide();
      trigger.removeEventListener("mouseenter", onEnter);
      trigger.removeEventListener("mouseleave", onLeave);
      trigger.removeEventListener("mousedown", onLeave);
      trigger.removeEventListener("click", onLeave);
      trigger.removeEventListener("focus", onFocus);
      trigger.removeEventListener("blur", onLeave);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onLeave, true);
      window.removeEventListener("resize", onLeave);
    };
  }

  // src/runtime/web-api.ts
  function userIdFromAvatarUrl(url) {
    if (!url) return null;
    const match = url.match(/\/T[A-Z0-9]+-(U[A-Z0-9]+)-/i);
    return match ? match[1].toUpperCase() : null;
  }

  // src/runtime/slack-api.ts
  var ACTIONS_GROUP = '[data-qa="message-actions"]';
  var ACTIONS_ITEM_CLASS = "c-message_actions__overflow_item c-message_actions__overflow_item--button";
  var MORE_ACTIONS = '[data-qa="more_message_actions"]';
  var MESSAGE = '[data-qa="message_container"]';
  var TOOLBARS = {
    /** Bottom strip of the rail: "Créer un nouveau", focus mode, avatar. */
    controlStrip: {
      container: ".p-control_strip",
      buttonClass: "c-button-unstyled p-control_strip__circle_button",
      /*
       * Anchored on BetterSlack's own launcher, not on Slack's coachmark wrapper.
       *
       * Inserting next to `.c-coachmark-anchor:has([data-qa="user-button"])`
       * freezes the renderer solid -- grey window, no error, no console, Slack
       * has to be killed. Slack's coachmark code evidently reacts to changes
       * around that node and ends up in a loop with whatever put them there.
       * Bisected against a running client: the same button anchored here is fine,
       * anchored there hangs every time.
       */
      before: "#betterslack-control-button",
      placement: "right"
    },
    /**
     * Formatting row under the message box: bold, italic, link…
     * Anchored on whatever element holds the bold button, rather than on the
     * composer body, so the button lands beside its peers and not at the end of
     * an unrelated container.
     */
    composer: {
      container: '*:has(> [data-qa="bold-composer-button"])',
      buttonClass: "c-button-unstyled c-icon_button c-icon_button--size_smedium p-composer__button c-icon_button--default",
      before: void 0,
      placement: "top"
    },
    /**
     * Right-hand end of the top bar, beside Slack's own help and account
     * controls. The place for a switch that belongs to the whole client rather
     * than to the conversation on screen.
     *
     * The container is a direct child on purpose: `display_flex` and
     * `align_items_center` are utility classes that appear all over Slack's
     * markup, and matching them anywhere under the right container would put the
     * button in whichever one happened to come first.
     */
    topNav: {
      container: ".p-ia4_top_nav__right_container > .display_flex.align_items_center",
      buttonClass: "c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default",
      before: void 0,
      placement: "bottom"
    },
    /** Right-hand side of the channel header: huddle, search, more. */
    channelHeader: {
      container: ".p-view_header__actions",
      buttonClass: "c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default",
      before: void 0,
      placement: "bottom"
    }
  };
  var cachedHost = null;
  function rememberHost(url) {
    try {
      cachedHost = new URL(url).origin;
    } catch {
    }
  }
  function describeMessage(element) {
    const channelId = element.getAttribute("data-msg-channel-id");
    const ts = element.getAttribute("data-msg-ts");
    let permalink = null;
    const timestampLink = element.querySelector("a.c-timestamp");
    if (timestampLink?.href) {
      permalink = timestampLink.href;
      rememberHost(permalink);
    } else if (cachedHost && channelId && ts) {
      permalink = `${cachedHost}/archives/${channelId}/p${ts.replace(".", "")}`;
    }
    const body = element.querySelector('[data-qa="message-text"]');
    return {
      element,
      channelId,
      ts,
      permalink,
      text: (body?.textContent ?? element.textContent ?? "").trim()
    };
  }
  function addMessageAction(pluginId, action) {
    const nodeId = `betterslack-action-${pluginId}-${action.id}`;
    const cleanup = onEach(ACTIONS_GROUP, (group) => {
      if (group.querySelector(`#${CSS.escape(nodeId)}`)) return;
      const message = group.closest(MESSAGE) ?? document.querySelector(".c-message_kit__hover--hovered")?.closest(MESSAGE) ?? null;
      if (!message) return;
      const button = h("button", {
        class: "c-button-unstyled c-icon_button c-icon_button--size_smedium c-message_actions__button betterslack-action",
        type: "button",
        "aria-label": action.label,
        "data-qa": `betterslack_${pluginId}_${action.id}`
      });
      button.innerHTML = action.icon;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        action.onClick(describeMessage(message), event);
      });
      attachTooltip(button, {
        title: action.label,
        subtitle: action.description,
        placement: "top"
      });
      const item = h("div", { class: ACTIONS_ITEM_CLASS, id: nodeId }, [button]);
      const more = group.querySelector(MORE_ACTIONS)?.closest(`.c-message_actions__overflow_item`);
      if (more) more.before(item);
      else group.append(item);
    });
    return () => {
      cleanup();
      for (const node of document.querySelectorAll(`#${CSS.escape(nodeId)}`)) node.remove();
    };
  }
  var PROFILE_PANE = '[data-qa="member_profile_pane"]';
  var PROFILE_AVATAR = ".p-r_member_profile__avatar__img";
  function addProfileButton(pluginId, button) {
    const nodeId = `betterslack-profile-${pluginId}-${button.id}`;
    const cleanup = onEach(PROFILE_PANE, (pane) => {
      if (pane.querySelector(`#${CSS.escape(nodeId)}`)) return;
      const element = h("button", {
        class: "c-button c-button--outline c-button--medium betterslack-profile-button",
        type: "button",
        id: nodeId,
        "data-qa": `betterslack_${pluginId}_${button.id}`
      });
      if (button.icon) element.innerHTML = button.icon;
      element.append(h("span", {}, [button.label]));
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const avatar = pane.querySelector(PROFILE_AVATAR);
        button.onClick({ element: pane, userId: userIdFromAvatarUrl(avatar?.src) });
      });
      const container = pane.querySelector(".p-r_member_profile__container") ?? pane;
      container.append(h("div", { class: "betterslack-profile-row" }, [element]));
    });
    return () => {
      cleanup();
      for (const node of document.querySelectorAll(`#${CSS.escape(nodeId)}`)) {
        node.closest(".betterslack-profile-row")?.remove();
        node.remove();
      }
    };
  }
  function addToolbarButton(pluginId, toolbar, button) {
    const spec2 = TOOLBARS[toolbar];
    const nodeId = `betterslack-tb-${pluginId}-${button.id}`;
    const unmount = keepMounted(
      spec2.container,
      nodeId,
      () => {
        const element = h("button", {
          class: `${spec2.buttonClass} betterslack-toolbar-button`,
          type: "button",
          "aria-label": button.label,
          "data-qa": `betterslack_${pluginId}_${button.id}`
        });
        element.innerHTML = button.icon;
        element.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          button.onClick(event);
        });
        attachTooltip(element, {
          title: button.label,
          subtitle: button.description,
          placement: spec2.placement
        });
        return element;
      },
      // Prepend rather than append when the anchor is missing: the end of a
      // container is where the app's own re-renders land.
      { before: button.before ?? spec2.before, position: "prepend" }
    );
    return () => {
      unmount();
      for (const node of document.querySelectorAll(`#${CSS.escape(nodeId)}`)) node.remove();
    };
  }
  var WINDOW_MATERIALS = Object.freeze([
    "hud",
    "fullscreen-ui",
    "under-window",
    "titlebar",
    "none"
  ]);

  // src/runtime/ui/code.ts
  var ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;"
  };
  function escape(text) {
    return text.replace(/[&<>]/g, (char) => ESCAPES[char]);
  }
  function tokenizeCss(source) {
    const tokens = [];
    let index = 0;
    let afterColon = false;
    const blocks = [];
    let atRule = null;
    const NESTS_RULES = /^@(media|supports|layer|container|document|scope)$/;
    const inBlock = () => blocks[blocks.length - 1] === "declarations";
    const push = (kind, text) => {
      if (text) tokens.push({ kind, text });
    };
    while (index < source.length) {
      const rest = source.slice(index);
      if (rest.startsWith("/*")) {
        const end = source.indexOf("*/", index + 2);
        const stop = end === -1 ? source.length : end + 2;
        push("comment", source.slice(index, stop));
        index = stop;
        continue;
      }
      const char = rest[0];
      if (/\s/.test(char)) {
        const match = /^\s+/.exec(rest);
        push("space", match[0]);
        index += match[0].length;
        continue;
      }
      if (char === '"' || char === "'") {
        const match = new RegExp(`^${char}(?:\\\\.|[^${char}\\\\\\n])*${char}?`).exec(rest);
        const text = match ? match[0] : char;
        push("string", text);
        index += text.length;
        continue;
      }
      if (char === "{") {
        blocks.push(atRule && NESTS_RULES.test(atRule) ? "rules" : "declarations");
        atRule = null;
        afterColon = false;
        push("punct", char);
        index += 1;
        continue;
      }
      if (char === "}") {
        blocks.pop();
        atRule = null;
        afterColon = false;
        push("punct", char);
        index += 1;
        continue;
      }
      if (char === ":" && inBlock()) {
        afterColon = true;
        push("punct", char);
        index += 1;
        continue;
      }
      if (char === ";") {
        afterColon = false;
        atRule = null;
        push("punct", char);
        index += 1;
        continue;
      }
      if (char === "@") {
        const match = /^@[\w-]+/.exec(rest);
        atRule = match[0];
        push("at", match[0]);
        index += match[0].length;
        continue;
      }
      if (rest.startsWith("--") && (inBlock() || afterColon)) {
        const match = /^--[\w-]+/.exec(rest);
        push(afterColon ? "value" : "property", match[0]);
        index += match[0].length;
        continue;
      }
      if (char === "#" && /^#[0-9a-fA-F]{3,8}\b/.test(rest)) {
        const match = /^#[0-9a-fA-F]{3,8}/.exec(rest);
        push("colour", match[0]);
        index += match[0].length;
        continue;
      }
      if (/^-?(?:\d+\.?\d*|\.\d+)[\w%]*/.test(rest)) {
        const match = /^-?(?:\d+\.?\d*|\.\d+)[\w%]*/.exec(rest);
        push("number", match[0]);
        index += match[0].length;
        continue;
      }
      if (/[\w-]/.test(char)) {
        const match = /^[\w-]+/.exec(rest);
        const word = match[0];
        if (!inBlock()) push("selector", word);
        else if (afterColon) push(/^!?important$/i.test(word) ? "important" : "value", word);
        else push("property", word);
        index += word.length;
        continue;
      }
      if (char === "!") {
        const match = /^!\s*important/i.exec(rest);
        if (match) {
          push("important", match[0]);
          index += match[0].length;
          continue;
        }
      }
      push(inBlock() ? "punct" : "selector", char);
      index += 1;
    }
    return tokens;
  }
  function highlightCss(source) {
    return tokenizeCss(source).map(({ kind, text }) => kind === "space" ? escape(text) : `<span class="sm-tok-${kind}">${escape(text)}</span>`).join("");
  }
  function createCodeEditor(doc, options = {}) {
    const wrap = doc.createElement("div");
    wrap.className = "sm-code";
    if (options.rows) wrap.style.setProperty("--sm-code-rows", String(options.rows));
    const paint = doc.createElement("pre");
    paint.className = "sm-code__paint";
    paint.setAttribute("aria-hidden", "true");
    const area = doc.createElement("textarea");
    area.className = "sm-code__input";
    area.spellcheck = false;
    area.value = options.value ?? "";
    if (options.placeholder) area.placeholder = options.placeholder;
    if (options.readOnly) area.readOnly = true;
    area.setAttribute("autocapitalize", "off");
    area.setAttribute("autocomplete", "off");
    const draw = () => {
      paint.innerHTML = `${highlightCss(area.value)}
`;
    };
    area.addEventListener("input", () => {
      draw();
      options.onChange?.(area.value);
    });
    area.addEventListener("scroll", () => {
      paint.scrollTop = area.scrollTop;
      paint.scrollLeft = area.scrollLeft;
    });
    area.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || event.shiftKey) return;
      event.preventDefault();
      const { selectionStart, selectionEnd, value } = area;
      area.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      area.selectionStart = area.selectionEnd = selectionStart + 2;
      draw();
      options.onChange?.(area.value);
    });
    wrap.append(paint, area);
    draw();
    return {
      node: wrap,
      value: () => area.value,
      set(value) {
        area.value = value;
        draw();
      },
      focus: () => area.focus()
    };
  }
  var CODE_CSS = `
.sm-code {
  position: relative;
  border-radius: 6px;
  border: 1px solid var(--sm-line, rgba(255, 255, 255, .13));
  background: var(--sm-bg, transparent);
  overflow: hidden;
}
.sm-code:focus-within {
  border-color: var(--sm-focus, #1264a3);
  box-shadow: 0 0 0 1px var(--sm-focus, #1264a3);
}
/* Every metric set on one is set on the other, or the caret drifts away from
   the text as you type. That is the whole trick. */
.sm-code__paint,
.sm-code__input {
  margin: 0;
  padding: 10px 12px;
  border: 0;
  font: 13px/1.6 var(--sm-mono, Monaco, Menlo, Consolas, monospace);
  tab-size: 2;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
  min-height: calc(var(--sm-code-rows, 12) * 1.6em + 20px);
}
.sm-code__paint {
  position: absolute;
  inset: 0;
  overflow: auto;
  pointer-events: none;
  color: var(--sm-text, inherit);
}
.sm-code__input {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  resize: vertical;
  background: transparent;
  color: transparent;
  caret-color: var(--sm-bright, #f8f8f8);
  outline: none;
  overflow: auto;
}
.sm-code__input::selection { background: rgba(29, 155, 209, .35); color: transparent; }
.sm-code__input::placeholder { color: var(--sm-muted, #9a9b9d); }

.sm-tok-comment { color: #6b7075; font-style: italic; }
.sm-tok-selector { color: #78c2ff; }
.sm-tok-property { color: #b8bcc0; }
.sm-tok-value { color: inherit; }
.sm-tok-string { color: #7ed492; }
.sm-tok-number { color: #f2a35e; }
.sm-tok-colour { color: #f2a35e; text-decoration: underline dotted rgba(242, 163, 94, .5); }
.sm-tok-at { color: #d78ef7; }
.sm-tok-important { color: var(--sm-danger, #e01e5a); font-weight: 700; }
.sm-tok-punct { color: #7d8286; }
`;

  // src/runtime/ui/styles.ts
  var PANEL_CSS = CODE_CSS + `
/* .c-dialog ships opacity:0 and is faded in by Slack's own transition. */
#betterslack-panel.c-dialog { opacity: 1; }

.betterslack-content {
  display: flex;
  flex-direction: column;
  width: min(880px, calc(100% - 32px));
  max-width: min(880px, calc(100% - 32px));
  height: min(620px, calc(100% - 64px));
  max-height: min(620px, calc(100% - 64px));
  opacity: 1;
}

.betterslack-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px 12px;
}
.betterslack-close { margin-left: auto; flex: 0 0 auto; }

.betterslack-layout { display: flex; flex: 1; min-height: 0; }

/* Left rail, in the shape Slack's Preferences dialog uses. */
.betterslack-nav {
  flex: 0 0 176px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px 16px 16px;
  overflow-y: auto;
}
.betterslack-nav__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 15px;
  line-height: 1.46667;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  text-align: left;
  cursor: pointer;
}
.betterslack-nav__item:hover { background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08); }
.betterslack-nav__item[aria-selected="true"] {
  background: rgba(var(--sk_highlight, 18, 100, 163), 1);
  color: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  font-weight: var(--custom-font-weight-bold, 700);
}
.betterslack-nav__item[aria-selected="true"] .betterslack-count {
  background: rgba(255, 255, 255, 0.24);
  color: inherit;
}

.betterslack-count {
  margin-left: auto;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}

.betterslack-body { flex: 1; min-width: 0; padding-bottom: 20px; }

/* How BetterSlack's own interface moves, inside the client.
 *
 * The same six tokens api.ui.kit declares for the documents a mod opens, with
 * the same defaults, so the app and the components it hands out share one
 * tempo. Declared on :root and not on the elements that read them, which is
 * what lets a mod override them from html.<its-class> -- a rule on the element
 * itself would outrank anything inherited and the dials would do nothing.
 */
:root {
  --sm-motion-base: 200ms;
  --sm-motion-ease: cubic-bezier(.2, .9, .25, 1);
  --sm-motion-shift: 8px;
}

/* Reduced motion drops the travel and keeps the fade, which is what it asks
 * for. Also on :root, and for the same reason: someone who installs a motion
 * mod and tells it to animate anyway has said what they want, and that has to
 * be able to win.
 */
@media (prefers-reduced-motion: reduce) {
  :root { --sm-motion-shift: 0px; }
}

/* Switching tab.
 *
 * Stamped by panel.ts, and only when the tab really changed: the panel rebuilds
 * itself on every change and one toggle causes several renders in a frame, so a
 * rule that fired on mount alone would flicker instead of transition.
 */
@keyframes betterslack-tab-enter {
  from { opacity: 0; transform: translateX(var(--sm-motion-shift)); }
  to { opacity: 1; transform: none; }
}
.betterslack-body--enter {
  animation: betterslack-tab-enter var(--sm-motion-base) var(--sm-motion-ease);
}

.betterslack-toolbar {
  position: sticky;
  top: 0;
  z-index: 1;
  /* A column, not a row.
   *
   * The shelves and the search field shared a line, the field taking whatever
   * the three shelf pills left over. On a narrow dialog that is a stub of an
   * input pinned to the right edge with the tabs crowding it, and on a wide one
   * it is a field stretched across half the dialog for no reason. Measured at
   * 316px against 330px of shelves. Its own line is the same width every time,
   * lines up with the rows underneath, and reads as what it is: a filter on the
   * shelf above it.
   */
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 0 14px;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
}
.betterslack-shelves { display: flex; gap: 2px; flex-wrap: wrap; }
.betterslack-shelf {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
  cursor: pointer;
}
.betterslack-shelf:hover { background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08); }
.betterslack-shelf[aria-selected="true"] {
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  font-weight: var(--custom-font-weight-bold, 700);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}

.betterslack-search {
  /* Fills its line rather than fighting for the remainder of one. */
  display: block;
  width: 100%;
  min-width: 0;
  padding: 8px 12px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 15px;
  line-height: 1.46667;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  background: transparent;
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.3);
}
.betterslack-search:focus {
  outline: none;
  border-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  box-shadow: 0 0 0 1px rgba(var(--sk_highlight, 18, 100, 163), 1);
}
/* The CSS box is api.ui's code editor. It brings its own metrics -- the painted
 * copy and the textarea have to agree on every one of them -- so only the
 * colours are set here, from Slack's tokens, which is what makes it follow the
 * theme like the rest of the panel. Written without backticks, as everything in
 * this file must be. */
.sm-code {
  border-color: rgba(var(--sk_foreground_low, 29, 28, 29), 0.3);
  background: rgba(var(--sk_foreground_min, 29, 28, 29), 0.04);
}
.sm-code:focus-within {
  border-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  box-shadow: 0 0 0 1px rgba(var(--sk_highlight, 18, 100, 163), 1);
}
.sm-code__paint { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.9); }
.sm-code__input { caret-color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1); }
.sm-code__input::placeholder { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.5); }

/* The update notice: the same row as everything else, marked by an accent edge
 * rather than a colour of its own, so it reads as important without shouting. */
.betterslack-row--notice {
  border-left: 3px solid rgba(var(--sk_highlight, 18, 100, 163), 1);
  padding-left: 12px;
}

/* A mod and its settings read as one block, with the settings indented under
 * the row they belong to rather than floating beside it. */
/* The palette, in Raycast's shape.
 *
 * What makes that shape legible is not decoration: every row carries a picture
 * of what it is, rows are grouped under headings, the category sits on the
 * right so the left can stay short, and a footer keeps saying which key does
 * what. A flat list of identical rows reads as a wall, which is what this was.
 */
.betterslack-palette {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}
.betterslack-palette__box {
  width: min(680px, calc(100vw - 48px));
  max-height: min(560px, 70vh);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}

.betterslack-palette__search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
}
.betterslack-palette__search_icon {
  font-size: 15px;
  opacity: 0.45;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-palette__input {
  flex: 1 1 auto;
  border: 0;
  padding: 16px 0;
  font-size: 17px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  background: transparent;
  outline: none;
}

/* The mode you are in, in front of the field rather than in your memory. */
.betterslack-palette__chip {
  flex: 0 0 auto;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.9);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
}
.betterslack-palette__chip[hidden] { display: none; }

/* What the prefixes do, shown when there is nothing else to show -- a palette
   whose shortcuts are only in the documentation has no shortcuts. */
.betterslack-palette__modes[hidden] { display: none; }
.betterslack-palette__modes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  padding: 8px 10px;
  border-top: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
}
.betterslack-palette__mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.75);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
}
.betterslack-palette__mode kbd {
  font-family: inherit;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.18);
}

.betterslack-palette__list { overflow-y: auto; padding: 6px; flex: 1 1 auto; min-height: 140px; }
.betterslack-palette__section {
  padding: 10px 10px 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.45);
}

.betterslack-palette__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  cursor: pointer;
}
.betterslack-palette__row[aria-selected="true"] {
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.14);
}

/* One size for every kind of icon -- an avatar, an emoji, a glyph or a letter
   -- so the titles line up whatever the row happens to be. */
.betterslack-palette__icon {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  object-fit: cover;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.14);
}
.betterslack-palette__icon--glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.75);
}

.betterslack-palette__text { flex: 1 1 auto; min-width: 0; display: block; }
.betterslack-palette__title {
  display: block;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-palette__sub {
  display: block;
  font-size: 12px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-palette__source {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.6);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}

.betterslack-palette__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-top: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
  font-size: 12px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.55);
}

/* Aligned with everything else. These chips carried 20px of padding of their
 * own on top of the dialog body's 24px, so the one row of the panel that is a
 * filter started further right than the rows it filters. */
.betterslack-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 12px;
}
.betterslack-filter {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.7);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
  cursor: pointer;
}
.betterslack-filter:hover { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1); }
.betterslack-filter[aria-pressed="true"] {
  background: rgba(var(--sk_highlight, 18, 100, 163), 1);
  color: #fff;
}

/* The one tag that is a warning rather than a label. */
.betterslack-tag--error {
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 0.16);
  color: rgba(var(--sk_highlight_accent, 224, 30, 90), 1);
}

.betterslack-settings {
  padding: 4px 0 12px 16px;
  border-left: 2px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  margin: 0 0 8px 8px;
}
.betterslack-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  /* A control and its explanation share a line until there is no room for
     both, and then the control takes one of its own rather than shrinking to
     nothing. */
  flex-wrap: wrap;
}
.betterslack-settings__meta { min-width: 0; flex: 1 1 260px; }

/*
 * Wide enough to read what is in it.
 *
 * A max-width of 200px was left over from when these were all short numbers;
 * a select showing a sentence -- the palette's shortcut was one -- came out
 * clipped to a few characters with no way to see the rest. The width now
 * follows the content, within bounds, and the row wraps before it starves.
 */
.betterslack-settings__input {
  flex: 0 1 auto;
  width: auto;
  min-width: 220px;
  max-width: 100%;
}
.betterslack-row__actions:has(> .betterslack-settings__input) { flex: 1 1 240px; }
.betterslack-row__actions > .betterslack-settings__input { width: 100%; }
.betterslack-row__group { display: block; }

/* ---- a mod's mark, and its page ---- */

/*
 * Every mod gets a shape, drawn or derived.
 *
 * A list of names is a table; a list of marks is a shelf, and this panel is a
 * shop before it is a settings screen. A mod that ships no icon.svg gets its
 * initial on a colour derived from its id -- its own, stable, and never a hole
 * where the others have something.
 */
.betterslack-icon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.10);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.9);
}
.betterslack-icon--sm { width: 34px; height: 34px; }
.betterslack-icon--lg { width: 64px; height: 64px; border-radius: 14px; }
.betterslack-icon svg { width: 62%; height: 62%; display: block; }
.betterslack-icon--letter {
  font-weight: 900;
  background: hsl(var(--betterslack-icon-hue, 210) 45% 42%);
  color: #fff;
}
.betterslack-icon--sm.betterslack-icon--letter { font-size: 15px; }
.betterslack-icon--lg.betterslack-icon--letter { font-size: 27px; }

/* The name is what you press to open the page, so it has to look pressable
   without turning the list into a wall of links. */
.betterslack-row__open {
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  border-radius: 4px;
}
.betterslack-row__open:hover { text-decoration: underline; }

.betterslack-back {
  display: inline-block;
  margin: 4px 0 14px;
  font-size: 13px;
  color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  cursor: pointer;
}
.betterslack-detail__head { display: flex; align-items: flex-start; gap: 16px; }
.betterslack-detail__title { flex: 1 1 auto; min-width: 0; }
.betterslack-detail__name { margin: 0 0 2px; font-size: 22px; font-weight: 900; }
.betterslack-detail__lede {
  margin: 14px 0 18px;
  font-size: 15px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.85);
}
.betterslack-detail__section { margin: 22px 0 8px; font-size: 15px; font-weight: 900; }

/* Screenshots scroll sideways rather than stacking: a mod has two or three,
   and three tall pictures push the readme off the screen. */
.betterslack-shots {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  margin-bottom: 6px;
}
/* One picture fills the column -- a mod's shot is a whole Slack window, and at
   420px the thing it is meant to show is a few pixels tall. Two or more go back
   to a strip you push sideways. */
.betterslack-shot { flex: 0 0 auto; width: min(420px, 78%); margin: 0; }
.betterslack-shots:has(> :only-child) .betterslack-shot { width: 100%; }
.betterslack-shot img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  display: block;
}
.betterslack-shot figcaption {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}

/* ---- a readme, rendered ---- */

.sm-md { font-size: 14px; line-height: 1.55; }
.sm-md__h1, .sm-md__h2, .sm-md__h3, .sm-md__h4 {
  margin: 20px 0 8px;
  font-weight: 900;
  line-height: 1.25;
}
.sm-md__h1 { font-size: 19px; }
.sm-md__h2 { font-size: 17px; }
.sm-md__h3 { font-size: 15px; }
.sm-md__h4 { font-size: 14px; }
.sm-md p { margin: 0 0 12px; }
.sm-md__list { margin: 0 0 12px; padding-left: 22px; }
.sm-md__list li { margin: 3px 0; }
.sm-md__link { color: rgba(var(--sk_highlight, 18, 100, 163), 1); }
.sm-md__img {
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  margin: 6px 0 14px;
}
.sm-md__quote {
  margin: 0 0 12px;
  padding-left: 12px;
  border-left: 3px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.3);
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.75);
}
.sm-md__rule {
  border: none;
  border-top: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  margin: 18px 0;
}
.sm-md__code, .sm-md__pre code {
  font-family: Monaco, Menlo, Consolas, monospace;
  font-size: 12.5px;
}
.sm-md__code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}
.sm-md__pre {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.10);
}

.betterslack-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.13);
}
.betterslack-row:last-child { border-bottom: none; }
.betterslack-row__meta { flex: 1; min-width: 0; }
.betterslack-row__name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: var(--custom-font-weight-bold, 700);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-row__desc {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.46;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-row__sub {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.55);
}
.betterslack-row__actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.betterslack-row__more { opacity: 0; transition: opacity 80ms ease; }
.betterslack-row:hover .betterslack-row__more,
.betterslack-row__more:focus-visible { opacity: 1; }

.betterslack-tag {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: var(--custom-font-weight-bold, 700);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
}

/* A theme's required plugins, on its row and in the dialog. */
.betterslack-row__requires {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-row__requires--missing {
  color: var(--dt_color-content-warn, #b8730a);
  font-weight: var(--custom-font-weight-bold, 700);
}
.betterslack-row__review {
  color: var(--dt_color-content-link, #1264a3);
  font-size: 12px;
  font-weight: var(--custom-font-weight-bold, 700);
  text-decoration: underline;
  cursor: pointer;
}

#betterslack-requires.c-dialog { opacity: 1; z-index: 1101; }
.betterslack-content--narrow {
  width: min(520px, calc(100% - 32px));
  max-width: min(520px, calc(100% - 32px));
  height: auto;
  max-height: min(560px, calc(100% - 64px));
}
.betterslack-requires { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 0; list-style: none; }
.betterslack-require {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border-radius: 8px;
  /* A tinted card rather than a warning triangle: this is a choice to make,
     not an error the user is being blamed for. */
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08);
}
.betterslack-require__title {
  font-size: 15px;
  font-weight: var(--custom-font-weight-bold, 700);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-require__detail {
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-actions--dialog {
  justify-content: flex-end;
  padding: 4px 24px 20px;
  margin-top: 0;
}

/* Slack has no reusable switch class, so this is built from its variables. */
.betterslack-switch { position: relative; width: 38px; height: 22px; flex: 0 0 auto; cursor: pointer; }
.betterslack-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.betterslack-switch__track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(var(--sk_foreground_max, 29, 28, 29), 0.4);
  transition: background 120ms ease;
}
.betterslack-switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 120ms ease;
}
.betterslack-switch input:checked + .betterslack-switch__track {
  background: var(--dt_color-content-hgl-2, #007a5a);
}
.betterslack-switch input:checked + .betterslack-switch__track .betterslack-switch__thumb {
  transform: translateX(16px);
}
.betterslack-switch input:focus-visible + .betterslack-switch__track {
  box-shadow: 0 0 0 2px rgba(var(--sk_highlight, 18, 100, 163), 1);
}

.betterslack-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 14px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-hint {
  margin: 4px 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }

/* Installing from a URL.
 *
 * This block had no rules of its own, which is not the same as having no
 * design: the row stayed display:block, so the field fell back to the browser
 * default of 174px -- a stub next to a full-height button -- and the whole
 * thing sat flush against the toolbar above it with nothing to separate them.
 */
.betterslack-remote {
  padding: 0 0 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.13);
}
.betterslack-remote__row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.betterslack-remote__row .betterslack-search { flex: 1 1 auto; width: auto; }
.betterslack-remote__row .c-button { flex: 0 0 auto; }
.betterslack-status {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-status { font-size: 13px; color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7); }
.betterslack-danger { color: var(--dt_color-content-imp, #c01343); }

.betterslack-info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  margin: 16px 0 0;
  font-size: 13px;
}
.betterslack-info dt { color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7); }
.betterslack-info dd {
  margin: 0;
  font-family: Monaco, Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}

/* Dialogs opened by mods through api.ui.modal: the same Slack shell, sized to
   the content rather than to a fixed panel height. */
/*
 * Slack ships .c-dialog at opacity 0 and fades it in with its own transition,
 * which never runs for a dialog we built. The panel has carried this override
 * since it moved into the light DOM; api.ui.modal did not, so every dialog a
 * mod opened was in the document, focusable, and completely invisible.
 */
.betterslack-widget_dialog { z-index: 1014; opacity: 1; }
.betterslack-widget_content { height: auto; max-height: min(640px, calc(100% - 64px)); }
.betterslack-widget_content .betterslack-body { flex: 0 1 auto; padding-bottom: 8px; }
.betterslack-widget_titles { flex: 1; min-width: 0; }
.betterslack-widget_subtitle { margin: 4px 0 0; }
.betterslack-widget_footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 24px 20px;
}

/* Slack pins the top offset on .c-popover__content, so this layer is ours. */
.betterslack-menu_layer {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1013;
  will-change: transform;
}
.betterslack-menu_layer .c-menu {
  min-width: 180px;
  border-radius: 6px;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  box-shadow: 0 0 0 1px rgba(var(--sk_foreground_low, 29, 28, 29), 0.13),
    0 4px 12px 0 rgba(0, 0, 0, 0.12);
}
`;
  var WIDGET_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }

:host, .toast-stack {
  --w-bg: var(--dt_color-base-pry, #ffffff);
  --w-raised: var(--dt_color-base-sec, #f8f8f8);
  --w-text: var(--dt_color-content-pry, #1d1c1d);
  --w-dim: var(--dt_color-content-sec, #454447);
  --w-border: var(--dt_color-otl-sec, rgba(94, 93, 96, 0.45));
  --w-green: var(--dt_color-content-hgl-2, #007a5a);
  --w-danger: var(--dt_color-content-imp, #c01343);
  --w-warn: var(--dt_color-content-hgl-3, #6b5000);
  --w-info: var(--dt_color-content-hgl-1, #1264a3);
  --w-font: Lato, Slack-Lato, appleLogo, sans-serif;
}

/* ---- toasts ---- */
.toast-stack {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 2147482000;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  align-items: center;
  pointer-events: none;
  font-family: var(--w-font);
}
.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, 86vw);
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: #1d1c1d;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.32);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 150ms ease, transform 150ms ease;
  pointer-events: auto;
}
.toast[data-shown="true"] { opacity: 1; transform: translateY(0); }
.toast[data-leaving="true"] { opacity: 0; transform: translateY(6px); }
.toast--success { background: var(--w-green); }
.toast--error { background: var(--w-danger); }
.toast--warning { background: var(--w-warn); }
.toast--info { background: var(--w-info); }
.toast__text { min-width: 0; }
.toast__action {
  all: unset;
  cursor: pointer;
  font-weight: 900;
  text-decoration: underline;
  white-space: nowrap;
}
.toast__action:focus-visible { outline: 2px solid #fff; outline-offset: 2px; border-radius: 3px; }

@media (prefers-reduced-motion: reduce) {
  .toast { transition: none; }
}
`;

  // src/runtime/ui/widgets.ts
  var TOAST_HOST_ID = "betterslack-toast-host";
  function makeHost(id) {
    const existing = document.getElementById(id);
    if (existing?.shadowRoot) return { host: existing, root: existing.shadowRoot };
    const host = h("div", { id });
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = WIDGET_CSS;
    root.append(style);
    document.body.append(host);
    return { host, root };
  }
  function toast(message, options = {}) {
    const { variant = "info", duration = 2200, action } = options;
    const { root } = makeHost(TOAST_HOST_ID);
    let stack = root.querySelector(".toast-stack");
    if (!stack) {
      stack = h("div", { class: "toast-stack", role: "status", "aria-live": "polite" });
      root.append(stack);
    }
    const node = h("div", { class: `toast toast--${variant}` }, [
      h("span", { class: "toast__text" }, [message])
    ]);
    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      node.dataset.leaving = "true";
      setTimeout(() => node.remove(), 160);
    };
    if (action) {
      const button = h("button", { class: "toast__action", type: "button" }, [action.label]);
      button.addEventListener("click", () => {
        action.onClick();
        dismiss();
      });
      node.append(button);
    }
    stack.append(node);
    requestAnimationFrame(() => {
      node.dataset.shown = "true";
    });
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return { dismiss };
  }
  function modal(options) {
    const {
      title,
      subtitle,
      content,
      actions = [],
      width = 520,
      dismissible = true,
      onClose
    } = options;
    const host = h("div", {
      class: "c-dialog betterslack-dialog betterslack-widget_dialog",
      role: "presentation"
    });
    document.body.append(host);
    const body = h("div", { class: "c-dialog__body betterslack-body" });
    if (typeof content === "string") body.append(h("p", { class: "betterslack-hint" }, [content]));
    else if (content) body.append(content);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKeyDown, true);
      host.remove();
      onClose?.();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape" && dismissible) {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    const closeButton = h("button", {
      class: "c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default betterslack-close",
      type: "button",
      "aria-label": "Close"
    });
    closeButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" style="--s:20px"><path fill="currentColor" d="M5.72 5.72a.75.75 0 0 1 1.06 0L10 8.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L11.06 10l3.22 3.22a.75.75 0 1 1-1.06 1.06L10 11.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L8.94 10 5.72 6.78a.75.75 0 0 1 0-1.06Z"/></svg>';
    closeButton.addEventListener("click", close);
    const titles = h("div", { class: "betterslack-widget_titles" }, [
      h("h1", { class: "c-dialog__title" }, [title]),
      ...subtitle ? [h("p", { class: "betterslack-hint betterslack-widget_subtitle" }, [subtitle])] : []
    ]);
    const header = h("div", { class: "c-dialog__header betterslack-header" }, [titles]);
    if (dismissible) header.append(closeButton);
    const footer = h("div", { class: "c-dialog__footer betterslack-widget_footer" });
    for (const action of actions) {
      const variant = action.variant === "primary" ? "c-button--primary" : action.variant === "danger" ? "c-button--danger" : "c-button--outline";
      const button = h("button", {
        class: `c-button ${variant} c-button--medium`,
        type: "button"
      }, [action.label]);
      button.addEventListener("click", async () => {
        const keepOpen = await action.onClick?.() === false;
        if (!keepOpen) close();
      });
      footer.append(button);
    }
    const content_ = h("div", {
      class: "c-dialog__content betterslack-content betterslack-widget_content",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": title,
      style: `width: min(${width}px, calc(100% - 32px)); max-width: min(${width}px, calc(100% - 32px));`
    }, [header, body, ...actions.length > 0 ? [footer] : []]);
    host.append(content_);
    if (dismissible) {
      host.addEventListener("mousedown", (event) => {
        if (event.target === host) close();
      });
    }
    queueMicrotask(() => host.querySelector(".c-button, .betterslack-close")?.focus());
    return { close, body };
  }
  function confirm(options) {
    const { title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = options;
    return new Promise((resolve) => {
      let answered = false;
      const settle = (value) => {
        if (answered) return;
        answered = true;
        resolve(value);
      };
      modal({
        title,
        content: message,
        width: 420,
        actions: [
          { label: cancelLabel, variant: "default", onClick: () => settle(false) },
          { label: confirmLabel, variant: danger ? "danger" : "primary", onClick: () => settle(true) }
        ],
        onClose: () => settle(false)
      });
    });
  }

  // src/runtime/ui/menu.ts
  var LAYER_ID = "betterslack-menu-layer";
  var MARGIN = 8;
  function closeMenu() {
    document.getElementById(LAYER_ID)?.remove();
  }
  function openMenu(anchor, items, options = {}) {
    closeMenu();
    const doc = anchor.ownerDocument;
    let arming;
    const close = () => {
      clearTimeout(arming);
      doc.removeEventListener("mousedown", onDown, true);
      doc.removeEventListener("keydown", onKey, true);
      doc.getElementById(LAYER_ID)?.remove();
      options.onClose?.();
    };
    const onDown = (event) => {
      const layer2 = doc.getElementById(LAYER_ID);
      if (layer2 && !layer2.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    const list = h("div", { class: "c-menu__items", role: "menu", tabindex: "-1" });
    for (const item of items) {
      const button = h("button", {
        class: "c-button-unstyled c-menu_item__button",
        role: "menuitem",
        type: "button",
        ...item.disabled ? { disabled: "disabled", "aria-disabled": "true" } : {}
      }, [
        item.icon ? h("span", { class: "c-menu_item__icon" }) : null,
        h("div", { class: `c-menu_item__label${item.danger ? " betterslack-danger" : ""}` }, [item.label])
      ].filter(Boolean));
      if (item.icon) {
        const icon = button.querySelector(".c-menu_item__icon");
        if (icon) icon.innerHTML = item.icon;
      }
      if (!item.disabled) {
        button.addEventListener("click", () => {
          close();
          item.onSelect();
        });
      }
      list.append(h("div", { class: "c-menu_item__li", "data-qa": "menu_item_button-wrapper" }, [button]));
    }
    const layer = h("div", { id: LAYER_ID, class: "betterslack-menu_layer" }, [
      h("div", { class: "c-menu" }, [h("div", { class: "c-menu__items_scroller" }, [list])])
    ]);
    doc.body.append(layer);
    const view = doc.defaultView ?? window;
    const rect = anchor.getBoundingClientRect();
    const { width, height } = layer.getBoundingClientRect();
    const edge = options.align === "left" ? rect.left : rect.right - width;
    const left = Math.max(MARGIN, Math.min(edge, view.innerWidth - width - MARGIN));
    const top = rect.bottom + height > view.innerHeight ? rect.top - height - 4 : rect.bottom + 4;
    layer.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    arming = setTimeout(() => {
      doc.addEventListener("mousedown", onDown, true);
      doc.addEventListener("keydown", onKey, true);
    }, 0);
    return close;
  }

  // tests/slack-fixture.mjs
  var SLACK_FIXTURE = `
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

  <div data-qa="member_profile_pane">
    <div class="p-r_member_profile__container">
      <img class="p-r_member_profile__avatar__img"
           src="https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE2-dc5119d9e23c-512">
    </div>
  </div>
</div>`;

  // src/runtime/ui/kit.ts
  function createKit(doc = document) {
    const el2 = (tag, props = {}, children = []) => {
      const node = doc.createElement(tag);
      for (const [key, value] of Object.entries(props)) {
        if (value === void 0 || value === null) continue;
        if (key === "class") node.className = String(value);
        else if (key === "html") node.innerHTML = String(value);
        else if (key.includes("-")) node.setAttribute(key, String(value));
        else node[key] = value;
      }
      for (const child of children) {
        if (child === null || child === void 0 || child === false) continue;
        node.append(typeof child === "string" ? doc.createTextNode(child) : child);
      }
      return node;
    };
    const button = (label, { variant = "default", icon, onClick, title, wide, onHover } = {}) => {
      const node = el2("button", { class: `sm-btn sm-btn--${variant}`, title, type: "button" }, [
        icon ? el2("span", { class: "sm-btn__icon", html: icon }) : null,
        el2("span", { textContent: label })
      ]);
      if (wide) node.classList.add("sm-btn--wide");
      if (onClick) node.addEventListener("click", onClick);
      if (onHover) hoverable(node, onHover);
      return node;
    };
    const iconButton = (glyph, { onClick, title, danger } = {}) => {
      const node = el2("button", {
        class: `sm-icon-btn${danger ? " sm-icon-btn--danger" : ""}`,
        title,
        type: "button",
        "aria-label": title ?? "",
        html: glyph
      });
      if (onClick) node.addEventListener("click", onClick);
      return node;
    };
    const hoverable = (node, { enter, leave }) => {
      node.addEventListener("mouseenter", enter);
      node.addEventListener("focus", enter);
      node.addEventListener("mouseleave", leave);
      node.addEventListener("blur", leave);
      return node;
    };
    const field = (label, control2, hint) => el2("div", { class: "field" }, [
      el2("label", { class: "field__label", textContent: label }),
      control2,
      hint ? el2("p", { class: "field__hint", textContent: hint }) : null
    ]);
    const input = (props = {}) => {
      const { class: extra, ...rest } = props;
      return el2("input", {
        class: extra ? `sm-input ${String(extra)}` : "sm-input",
        type: "text",
        spellcheck: false,
        ...rest
      });
    };
    const select = (options, { onChange, title } = {}) => {
      const node = el2("select", { class: "sm-input sm-select", title });
      for (const option of options) {
        node.append(el2("option", { value: option.value, textContent: option.label }));
      }
      if (onChange) node.addEventListener("change", () => onChange(node.value));
      return node;
    };
    const segmented = (options, { onChange } = {}) => {
      const node = el2("div", { class: "sm-segmented", role: "tablist" });
      let value = options[0]?.value ?? "";
      const buttons = /* @__PURE__ */ new Map();
      const set = (next) => {
        value = next;
        for (const [key, item] of buttons) item.setAttribute("aria-selected", String(key === next));
      };
      for (const option of options) {
        const item = el2("button", {
          class: "sm-segmented__item",
          type: "button",
          role: "tab",
          title: option.title
        }, [
          el2("span", { textContent: option.label }),
          option.count === void 0 ? null : el2("em", { textContent: String(option.count) })
        ]);
        item.addEventListener("click", () => {
          set(option.value);
          onChange?.(option.value);
        });
        buttons.set(option.value, item);
        node.append(item);
      }
      set(value);
      return { node, set, value: () => value };
    };
    const card = (title, children, { actions, subtitle } = {}) => el2("section", { class: "sm-card" }, [
      title ? el2("header", { class: "sm-card__head" }, [
        el2("div", {}, [
          el2("h2", { textContent: title }),
          subtitle ? el2("p", { textContent: subtitle }) : null
        ]),
        actions ? el2("div", { class: "sm-card__actions" }, actions) : null
      ]) : null,
      el2("div", { class: "sm-card__body" }, children)
    ]);
    const emptyState = (title, body, action) => el2("div", { class: "sm-empty" }, [
      el2("h3", { textContent: title }),
      el2("p", { textContent: body }),
      action ?? null
    ]);
    const CHECKER = "linear-gradient(45deg,rgba(0,0,0,.28) 25%,transparent 25%),linear-gradient(-45deg,rgba(0,0,0,.28) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(0,0,0,.28) 75%),linear-gradient(-45deg,transparent 75%,rgba(0,0,0,.28) 75%)";
    const swatch = (css, { size = "md" } = {}) => {
      const node = el2("span", { class: `sm-swatch sm-swatch--${size}` });
      node.style.backgroundImage = `linear-gradient(${css}, ${css}), ${CHECKER}`;
      return node;
    };
    const popover = (content, anchor, { onClose } = {}) => {
      const node = el2("div", { class: "sm-popover" }, [content]);
      doc.body.append(node);
      const place = () => {
        const box = anchor.getBoundingClientRect();
        const own = node.getBoundingClientRect();
        const margin = 8;
        let top = box.bottom + 6;
        if (top + own.height > doc.documentElement.clientHeight - margin) {
          top = Math.max(margin, box.top - own.height - 6);
        }
        let left = box.left;
        if (left + own.width > doc.documentElement.clientWidth - margin) {
          left = Math.max(margin, doc.documentElement.clientWidth - own.width - margin);
        }
        node.style.top = `${top}px`;
        node.style.left = `${left}px`;
      };
      place();
      const close = () => {
        doc.removeEventListener("mousedown", outside, true);
        doc.removeEventListener("keydown", escape2, true);
        doc.defaultView.removeEventListener("resize", place);
        node.remove();
        onClose?.();
      };
      const outside = (event) => {
        const target = event.target;
        if (!node.contains(target) && !anchor.contains(target)) close();
      };
      const escape2 = (event) => {
        if (event.key === "Escape") close();
      };
      doc.addEventListener("mousedown", outside, true);
      doc.addEventListener("keydown", escape2, true);
      doc.defaultView.addEventListener("resize", place);
      return { node, close, place };
    };
    const confirm2 = ({ title, body, action, cancel: cancelLabel, danger }) => new Promise((resolve) => {
      const scrim = el2("div", { class: "sm-scrim" });
      const cancel = button(cancelLabel, { variant: "ghost" });
      const go = button(action, { variant: danger ? "danger" : "primary" });
      const dialog = el2("div", { class: "sm-dialog", role: "dialog", "aria-modal": "true" }, [
        el2("h2", { textContent: title }),
        el2("p", { textContent: body }),
        el2("div", { class: "sm-dialog__actions" }, [cancel, go])
      ]);
      scrim.append(dialog);
      doc.body.append(scrim);
      const close = (answer) => {
        doc.removeEventListener("keydown", key, true);
        scrim.remove();
        resolve(answer);
      };
      const key = (event) => {
        if (event.key === "Escape") close(false);
      };
      cancel.addEventListener("click", () => close(false));
      go.addEventListener("click", () => close(true));
      scrim.addEventListener("mousedown", (event) => {
        if (event.target === scrim) close(false);
      });
      doc.addEventListener("keydown", key, true);
      go.focus();
    });
    const copyText = async (text) => {
      try {
        await doc.defaultView.navigator.clipboard.writeText(text);
        return true;
      } catch {
        const scratch = el2("textarea", { value: text });
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        doc.body.append(scratch);
        scratch.select();
        const done = doc.execCommand("copy");
        scratch.remove();
        return done;
      }
    };
    return {
      el: el2,
      button,
      iconButton,
      field,
      input,
      select,
      segmented,
      card,
      emptyState,
      swatch,
      popover,
      confirm: confirm2,
      copyText,
      hoverable,
      CHECKER,
      code: (options = {}) => createCodeEditor(doc, options)
    };
  }

  // src/runtime/ui/kit-css.ts
  var KIT_CSS = `/* The design system, as a stylesheet.
 *
 * Injected by a mod into whatever document it is building in -- a window it
 * opened, most often, where none of Slack's own stylesheet exists. Everything
 * is prefixed sm- so it cannot collide with Slack's classes if it is put into
 * the client itself.
 *
 * The palette below is Slack's own dark one, fixed rather than read from the
 * app's tokens: a tool that repaints itself with the theme being edited becomes
 * unreadable exactly when the theme is wrong, which is the moment you need it.
 * A mod that wants to follow the theme can override these five variables.
 */

:root {
  --sm-bg: #1a1d21;
  --sm-raised: #222529;
  --sm-raised-2: #27292d;
  --sm-hover: rgba(255, 255, 255, .04);
  --sm-line: rgba(255, 255, 255, .13);
  --sm-line-soft: rgba(255, 255, 255, .07);
  --sm-text: #d1d2d3;
  --sm-bright: #f8f8f8;
  --sm-muted: #9a9b9d;
  --sm-accent: #1d9bd1;
  --sm-primary: #007a5a;
  --sm-primary-hover: #148567;
  --sm-danger: #e01e5a;
  --sm-good: #2bac76;
  --sm-focus: #1264a3;
  --sm-font: Lato, Slack-Lato, appleLogo, -apple-system, sans-serif;
  --sm-mono: Monaco, Menlo, Consolas, monospace;

  /* How the kit moves.
   *
   * Values, not rules, so the whole design system has one tempo and anything
   * that wants to change it changes six numbers rather than forty
   * declarations. A mod with an opinion -- the Motion mod is the one this was
   * built for -- redefines these on the root of whatever document the kit is
   * in, and every control below follows without knowing it exists.
   *
   * Set to 0 and the kit is still: sm-motion-shift and sm-motion-pop are the
   * only sources of travel in here.
   */
  --sm-motion-quick: 120ms;
  --sm-motion-base: 200ms;
  --sm-motion-ease: cubic-bezier(.2, .9, .25, 1);
  --sm-motion-spring: cubic-bezier(.22, 1.4, .36, 1);
  --sm-motion-shift: 8px;
  --sm-motion-pop: .06;
}

/* ================================================================== motion */

/* A design system with no transitions is a design system that is finished
 * everywhere except in time. Every rule here is additive -- it sets transition,
 * animation or transform and nothing else -- so a document that zeroes the
 * tokens above gets exactly the layout it had before. */

.sm-btn,
.sm-icon-btn,
.sm-input,
.sm-select,
.sm-swatch,
.sm-segmented__item,
.sm-rail__item {
  transition:
    background-color var(--sm-motion-quick) var(--sm-motion-ease),
    border-color var(--sm-motion-quick) var(--sm-motion-ease),
    color var(--sm-motion-quick) var(--sm-motion-ease),
    box-shadow var(--sm-motion-quick) var(--sm-motion-ease),
    transform var(--sm-motion-quick) var(--sm-motion-ease);
}

.sm-swatch:hover {
  transform: translateY(calc(var(--sm-motion-shift) * -.35))
             scale(calc(1 + var(--sm-motion-pop) * .8));
}

.sm-btn:active,
.sm-icon-btn:active,
.sm-swatch:active,
.sm-segmented__item:active {
  transform: scale(calc(1 - var(--sm-motion-pop)));
  transition-duration: 60ms;
}

@keyframes sm-motion-arrive {
  from {
    opacity: 0;
    transform: translateY(calc(var(--sm-motion-shift) * .8))
               scale(calc(1 - var(--sm-motion-pop)));
  }
  to { opacity: 1; transform: none; }
}

@keyframes sm-motion-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.sm-dialog, .sm-popover { animation: sm-motion-arrive var(--sm-motion-base) var(--sm-motion-spring); }
.sm-scrim { animation: sm-motion-fade var(--sm-motion-base) var(--sm-motion-ease); }

/* The kit is used in windows a mod opened, which have no other stylesheet and
 * so no other chance to honour this. Fades stay; travel goes -- which is what
 * reduced motion asks for, rather than stillness. */
@media (prefers-reduced-motion: reduce) {
  :root { --sm-motion-shift: 0px; --sm-motion-pop: 0; }
}

/* ================================================================ controls */

.sm-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px 1px;
  border-radius: 4px;
  border: none;
  font: 900 15px/1 var(--sm-font);
  color: var(--sm-bright);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}
.sm-btn--primary { background: var(--sm-primary); }
.sm-btn--primary:hover { background: var(--sm-primary-hover); }
.sm-btn--default { box-shadow: inset 0 0 0 1px var(--sm-line); }
.sm-btn--default:hover { background: var(--sm-hover); }
.sm-btn--ghost { color: var(--sm-text); box-shadow: inset 0 0 0 1px var(--sm-line); }
.sm-btn--ghost:hover { background: var(--sm-hover); color: var(--sm-bright); }
.sm-btn[data-on="true"] { background: var(--sm-danger); color: #fff; box-shadow: none; }
.sm-btn--wide { width: 100%; justify-content: center; }
.sm-btn:disabled { opacity: .55; cursor: default; }
.sm-btn:focus-visible, .sm-rail__item:focus-visible, .sm-segmented__item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgba(29, 155, 209, .5);
}
.sm-btn__icon { display: flex; }
.sm-btn__icon svg { width: 16px; height: 16px; }

.sm-icon-btn {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--sm-muted);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.sm-icon-btn:hover { background: var(--sm-hover); color: var(--sm-bright); }
.sm-icon-btn--danger:hover { background: rgba(224, 30, 90, .16); color: #ff8ba7; }

.sm-input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 11px;
  border-radius: 4px;
  border: 1px solid var(--sm-line);
  background: var(--sm-bg);
  color: var(--sm-bright);
  font: 15px/1 var(--sm-font);
}
.sm-input:focus { outline: none; border-color: var(--sm-focus); box-shadow: 0 0 0 1px var(--sm-focus); }
.sm-input::placeholder { color: var(--sm-muted); }
.sm-select { appearance: none; padding-right: 30px;
  background-image: linear-gradient(45deg, transparent 50%, var(--sm-muted) 50%),
                    linear-gradient(135deg, var(--sm-muted) 50%, transparent 50%);
  background-position: calc(100% - 15px) 15px, calc(100% - 10px) 15px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}

.sm-field { margin-bottom: 14px; }
.sm-field__label { display: block; font-weight: 700; color: var(--sm-bright); margin-bottom: 4px; font-size: 14px; }
.sm-field__hint { margin: 4px 0 0; font-size: 13px; color: var(--sm-muted); }

.sm-segmented {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--sm-bg);
  border: 1px solid var(--sm-line-soft);
  border-radius: 6px;
  margin: 10px 0 0;
  overflow-x: auto;
}
.sm-segmented__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--sm-muted);
  font: 700 13px/1 var(--sm-font);
  cursor: pointer;
  white-space: nowrap;
}
.sm-segmented__item:hover { color: var(--sm-bright); background: var(--sm-hover); }
.sm-segmented__item[aria-selected="true"] { background: var(--sm-raised-2); color: var(--sm-bright); }
.sm-segmented__item em {
  font-style: normal;
  font-size: 11px;
  color: var(--sm-muted);
  background: rgba(255, 255, 255, .08);
  border-radius: 8px;
  padding: 1px 6px;
}

.sm-toolbar { display: flex; gap: 8px; align-items: center; }
.sm-toolbar .search { flex: 1 1 auto; }

/* ================================================================= swatches */

.sm-swatch {
  display: block;
  flex: 0 0 auto;
  border-radius: 4px;
  border: 1px solid var(--sm-line);
  background-size: 10px 10px;
  background-position: 0 0, 0 5px, 5px -5px, -5px 0;
}
.sm-swatch--sm { width: 18px; height: 18px; border-radius: 3px; }
.sm-swatch--md { width: 30px; height: 30px; }
.sm-swatch--lg { width: 46px; height: 46px; border-radius: 6px; }

/* ================================================================== popover */

.sm-popover {
  position: fixed;
  z-index: 50;
  width: 260px;
  padding: 12px;
  border-radius: 8px;
  background: var(--sm-raised-2);
  border: 1px solid var(--sm-line);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .55);
}
/* =================================================================== dialog */

.sm-scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .6);
}
.sm-dialog {
  width: min(440px, calc(100vw - 32px));
  padding: 20px;
  border-radius: 8px;
  background: var(--sm-raised);
  border: 1px solid var(--sm-line);
  box-shadow: 0 18px 48px rgba(0, 0, 0, .6);
}
.sm-dialog h2 { margin: 0 0 8px; font-size: 20px; font-weight: 900; color: var(--sm-bright); }
.sm-dialog p { margin: 0 0 18px; font-size: 15px; color: var(--sm-text); }
.sm-dialog__actions { display: flex; justify-content: flex-end; gap: 8px; }
.sm-btn--danger { background: var(--sm-danger); color: #fff; }
.sm-btn--danger:hover { background: #c4184a; }


` + CODE_CSS;

  // src/runtime/helpers.ts
  var BUTTON_CLASSES = {
    composer: "c-button-unstyled c-icon_button c-icon_button--size_smedium p-composer__button c-icon_button--default",
    header: "c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default",
    strip: "c-button-unstyled p-control_strip__circle_button",
    message: "c-button-unstyled c-icon_button c-icon_button--size_smedium c-message_actions__button"
  };
  var isMac = () => {
    if (typeof navigator === "undefined") return false;
    const hint = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
    return /Mac|iPhone|iPad/.test(hint);
  };
  function parseCombo(combo) {
    const parts = combo.toLowerCase().split("+").map((p) => p.trim());
    const key = parts[parts.length - 1] ?? "";
    const want = {
      mod: parts.includes("mod"),
      ctrl: parts.includes("ctrl"),
      shift: parts.includes("shift"),
      alt: parts.includes("alt") || parts.includes("option"),
      meta: parts.includes("cmd") || parts.includes("meta")
    };
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : null;
    return (event) => {
      if (want.mod && !event.metaKey && !event.ctrlKey) return false;
      if (!want.mod && want.meta !== event.metaKey) return false;
      if (!want.mod && want.ctrl !== event.ctrlKey) return false;
      if (want.shift !== event.shiftKey) return false;
      if (want.alt !== event.altKey) return false;
      return code ? event.code === code : event.key.toLowerCase() === key;
    };
  }
  function describeCombo(combo) {
    const mac = isMac();
    return combo.toLowerCase().split("+").map((part) => {
      const p = part.trim();
      if (p === "mod") return mac ? "\u2318" : "Ctrl";
      if (p === "shift") return mac ? "\u21E7" : "Shift";
      if (p === "alt" || p === "option") return mac ? "\u2325" : "Alt";
      if (p === "cmd" || p === "meta") return mac ? "\u2318" : "Win";
      if (p === "ctrl") return mac ? "\u2303" : "Ctrl";
      return p.toUpperCase();
    }).join(mac ? "" : "+");
  }
  function createHelpers(ctx) {
    const scopedCss = /* @__PURE__ */ new Map();
    const applyCss = () => ctx.css([...scopedCss.values()].join("\n"));
    return {
      toggle({ key, className, defaultOn = false, whenOn, onChange }) {
        const flag = className ?? `betterslack-${ctx.pluginId}-${key}`;
        if (whenOn) {
          scopedCss.set(`toggle:${key}`, whenOn.replace(/&/g, `html.${flag}`));
          applyCss();
        }
        const apply = (on) => {
          document.documentElement.classList.toggle(flag, on);
          onChange?.(on);
        };
        apply(ctx.settings.get(key, defaultOn) === true);
        ctx.track(() => document.documentElement.classList.remove(flag));
        return {
          get on() {
            return document.documentElement.classList.contains(flag);
          },
          async set(on) {
            apply(on);
            await ctx.settings.set(key, on);
          },
          async toggle() {
            const next = !document.documentElement.classList.contains(flag);
            apply(next);
            await ctx.settings.set(key, next);
            return next;
          }
        };
      },
      hotkey: (combo, handler, options) => {
        const matches = parseCombo(combo);
        return ctx.track(
          onShortcut((event) => matches(event) && (options?.when?.() ?? true), handler)
        );
      },
      describeHotkey: describeCombo,
      poll(handler, everyMs) {
        let timer;
        let running = false;
        const tick = () => {
          if (running || document.visibilityState === "hidden") return;
          running = true;
          void Promise.resolve(handler()).finally(() => {
            running = false;
          });
        };
        const start = () => {
          if (timer !== void 0) return;
          tick();
          timer = setInterval(tick, everyMs);
        };
        const stop = () => {
          if (timer === void 0) return;
          clearInterval(timer);
          timer = void 0;
        };
        const onVisibility = () => document.visibilityState === "hidden" ? stop() : start();
        document.addEventListener("visibilitychange", onVisibility);
        if (document.visibilityState !== "hidden") start();
        ctx.track(() => {
          document.removeEventListener("visibilitychange", onVisibility);
          stop();
        });
        return () => {
          document.removeEventListener("visibilitychange", onVisibility);
          stop();
        };
      },
      badge(selector, id, value) {
        const nodeId = `betterslack-badge-${ctx.pluginId}-${id}`;
        scopedCss.set(`badge:${id}`, `
        #${nodeId} {
          position: absolute; top: -2px; right: -2px; min-width: 16px; height: 16px;
          padding: 0 4px; border-radius: 999px; display: grid; place-items: center;
          font: 700 10px/1 Lato, sans-serif; color: #fff;
          background: var(--dt_color-content-imp, #c01343);
        }
        #${nodeId}[hidden] { display: none; }
      `);
        applyCss();
        const refresh = () => {
          const node = document.getElementById(nodeId);
          if (!node) return;
          const next = value();
          node.textContent = next === null ? "" : String(next);
          node.toggleAttribute("hidden", next === null || next === 0 || next === "");
        };
        const cleanup = keepMounted(selector, nodeId, () => {
          const node = h("span", { "aria-hidden": "true" });
          queueMicrotask(refresh);
          return node;
        });
        const timer = setInterval(refresh, 1e3);
        return ctx.track(() => {
          clearInterval(timer);
          cleanup();
        });
      },
      each: (selector, handler) => ctx.track(onEach(selector, handler)),
      mount: (container, id, factory, options) => ctx.track(keepMounted(container, id, factory, options ?? {})),
      tooltip: (element, title, subtitle) => ctx.track(attachTooltip(element, { title, subtitle })),
      async copy(text, message = "Copied") {
        try {
          await navigator.clipboard.writeText(text);
          ctx.toast(message, { variant: "success" });
          return true;
        } catch {
          ctx.toast("Could not copy", { variant: "error" });
          return false;
        }
      },
      iconButton({ icon, label, description, surface = "header", onClick }) {
        const button = h("button", {
          class: `${BUTTON_CLASSES[surface]} betterslack-icon-button`,
          type: "button",
          "aria-label": label
        });
        button.innerHTML = icon;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick(event);
        });
        ctx.track(attachTooltip(button, {
          title: label,
          subtitle: description,
          placement: surface === "strip" ? "right" : "top"
        }));
        return button;
      },
      field(label, value) {
        return h("div", { class: "p-rimeto_member_profile_field__contact_info" }, [
          h("div", { class: "p-rimeto_member_profile_field" }, [
            h("div", { class: "p-rimeto_member_profile_field__primary" }, [
              h("div", { class: "p-rimeto_member_profile_field__label" }, [label]),
              h("div", { class: "p-rimeto_member_profile_field__value" }, [value])
            ])
          ])
        ]);
      },
      section(title, children) {
        return h("div", { class: "p-r_member_profile_section" }, [
          h("div", { style: "display: flex;" }, [
            h("div", { class: "p-r_member_profile_section_header", style: "flex: 1 1 0%;" }, [title])
          ]),
          h("div", { class: "p-r_member_profile_section_content" }, children)
        ]);
      },
      debounce(fn, ms) {
        let timer;
        return (...args) => {
          clearTimeout(timer);
          timer = setTimeout(() => fn(...args), ms);
        };
      }
    };
  }

  // src/runtime/i18n.ts
  function detectLocale() {
    const declared = document.documentElement?.getAttribute("lang");
    if (declared && declared.trim()) return declared.trim();
    return navigator.language || "en";
  }
  function interpolate(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name) => name in vars ? String(vars[name]) : whole);
  }
  function createI18n(locale = detectLocale()) {
    const language = locale.split(/[-_]/)[0].toLowerCase();
    return {
      locale,
      language,
      strings(tables) {
        const exact = tables[locale] ?? tables[locale.replace("_", "-")];
        const byLanguage = tables[language];
        return (key, vars) => {
          const value = exact?.[key] ?? byLanguage?.[key] ?? tables.en[key];
          return interpolate(value ?? key, vars);
        };
      }
    };
  }

  // src/runtime/ui/markdown.ts
  var ESCAPES2 = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (c) => ESCAPES2[c]);
  }
  function safeUrl(url) {
    const trimmed = url.trim();
    if (/^(https?:|mailto:|slack:|data:image\/)/i.test(trimmed)) return trimmed;
    if (/^[\w./-]+$/.test(trimmed)) return trimmed;
    return null;
  }
  function inline(text, resolve) {
    return text.replace(/`([^`]+)`/g, (_, code) => `<code class="sm-md__code">${code}</code>`).replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt, href) => {
      const src = resolve(href);
      return src ? `<img class="sm-md__img" src="${src}" alt="${alt}">` : whole;
    }).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
      const url = resolve(href);
      return url ? `<a class="sm-md__link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : whole;
    }).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  }
  function renderMarkdown(source, options = {}) {
    const resolve = options.resolve ?? ((href) => safeUrl(href));
    const lines = escapeHtml(source.replace(/\r\n?/g, "\n")).split("\n");
    const out = [];
    let list = null;
    let paragraph = [];
    let fence = null;
    const closeParagraph = () => {
      if (!paragraph.length) return;
      out.push(`<p>${inline(paragraph.join(" "), resolve)}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!list) return;
      out.push(`</${list}>`);
      list = null;
    };
    for (const line of lines) {
      if (fence !== null) {
        if (/^\s*```/.test(line)) {
          out.push(`<pre class="sm-md__pre"><code>${fence.join("\n")}</code></pre>`);
          fence = null;
        } else {
          fence.push(line);
        }
        continue;
      }
      if (/^\s*```/.test(line)) {
        closeParagraph();
        closeList();
        fence = [];
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        closeParagraph();
        closeList();
        const level = heading[1].length;
        out.push(`<h${level} class="sm-md__h${level}">${inline(heading[2], resolve)}</h${level}>`);
        continue;
      }
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || numbered) {
        closeParagraph();
        const wanted = bullet ? "ul" : "ol";
        if (list !== wanted) {
          closeList();
          list = wanted;
          out.push(`<${wanted} class="sm-md__list">`);
        }
        out.push(`<li>${inline((bullet ?? numbered)[1], resolve)}</li>`);
        continue;
      }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
        closeParagraph();
        closeList();
        out.push('<hr class="sm-md__rule">');
        continue;
      }
      if (/^\s*&gt;\s?/.test(line)) {
        closeParagraph();
        closeList();
        out.push(`<blockquote class="sm-md__quote">${inline(line.replace(/^\s*&gt;\s?/, ""), resolve)}</blockquote>`);
        continue;
      }
      if (line.trim() === "") {
        closeParagraph();
        closeList();
        continue;
      }
      paragraph.push(line.trim());
    }
    if (fence !== null) out.push(`<pre class="sm-md__pre"><code>${fence.join("\n")}</code></pre>`);
    closeParagraph();
    closeList();
    return out.join("\n");
  }

  // mods/plugins/code-highlight/tokenise.js
  function escapeHtml2(text) {
    return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  var words = (list) => list.join("|");
  function spec({ line, block, strings = `"'`, keywords = [], builtins = [], extra = [], early = [] }) {
    const parts = [];
    parts.push(...early);
    if (block) parts.push(`(?<comment1>${block[0]}[\\s\\S]*?(?:${block[1]}|$))`);
    if (line) parts.push(`(?<comment2>${line}[^\\n]*)`);
    for (const q of strings) {
      const e = q === "`" ? "`" : q;
      parts.push(`(?<string${strings.indexOf(q)}>${e}(?:\\\\.|[^\\\\${e === "`" ? "`" : e}])*${e}?)`);
    }
    parts.push(...extra);
    parts.push("(?<number>\\b(?:0[xXbBoO][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b)");
    if (keywords.length) parts.push(`(?<keyword>\\b(?:${words(keywords)})\\b)`);
    if (builtins.length) parts.push(`(?<builtin>\\b(?:${words(builtins)})\\b)`);
    parts.push("(?<fn>\\b[A-Za-z_$][\\w$]*(?=\\s*\\())");
    parts.push("(?<punct>[{}()\\[\\];,.:=+\\-*/%<>!&|^~?]+)");
    return new RegExp(parts.join("|"), "g");
  }
  var JS_KEYWORDS = [
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "do",
    "break",
    "continue",
    "class",
    "extends",
    "new",
    "this",
    "super",
    "import",
    "export",
    "from",
    "as",
    "default",
    "async",
    "await",
    "yield",
    "try",
    "catch",
    "finally",
    "throw",
    "typeof",
    "instanceof",
    "in",
    "of",
    "delete",
    "void",
    "switch",
    "case"
  ];
  var JS_BUILTINS = [
    "true",
    "false",
    "null",
    "undefined",
    "NaN",
    "Infinity",
    "console",
    "window",
    "document",
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Promise",
    "Math",
    "JSON",
    "Map",
    "Set"
  ];
  var LANGUAGES = {
    javascript: spec({ line: "//", block: ["/\\*", "\\*/"], strings: `"'\``, keywords: JS_KEYWORDS, builtins: JS_BUILTINS }),
    typescript: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"'\``,
      keywords: [
        ...JS_KEYWORDS,
        "interface",
        "type",
        "enum",
        "implements",
        "readonly",
        "public",
        "private",
        "protected",
        "abstract",
        "declare",
        "namespace",
        "satisfies",
        "keyof"
      ],
      builtins: [...JS_BUILTINS, "string", "number", "boolean", "any", "unknown", "never", "void"]
    }),
    python: spec({
      line: "#",
      strings: `"'`,
      keywords: [
        "def",
        "class",
        "return",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "break",
        "continue",
        "import",
        "from",
        "as",
        "try",
        "except",
        "finally",
        "raise",
        "with",
        "lambda",
        "yield",
        "global",
        "nonlocal",
        "pass",
        "assert",
        "del",
        "async",
        "await",
        "not",
        "and",
        "or",
        "is",
        "in"
      ],
      builtins: [
        "True",
        "False",
        "None",
        "self",
        "cls",
        "print",
        "len",
        "range",
        "dict",
        "list",
        "set",
        "tuple",
        "str",
        "int",
        "float",
        "bool",
        "open",
        "super"
      ]
    }),
    json: spec({
      strings: '"',
      early: ['(?<property>"(?:\\\\.|[^"\\\\])*"(?=\\s*:))'],
      builtins: ["true", "false", "null"]
    }),
    bash: spec({
      line: "#",
      strings: `"'`,
      keywords: [
        "if",
        "then",
        "else",
        "elif",
        "fi",
        "for",
        "while",
        "do",
        "done",
        "case",
        "esac",
        "function",
        "return",
        "export",
        "local",
        "source"
      ],
      builtins: [
        "echo",
        "cd",
        "ls",
        "cat",
        "grep",
        "sed",
        "awk",
        "curl",
        "git",
        "npm",
        "pnpm",
        "yarn",
        "docker",
        "kubectl",
        "sudo",
        "mkdir",
        "rm",
        "cp",
        "mv",
        "chmod",
        "ssh"
      ],
      extra: ["(?<variable>\\$\\{?[A-Za-z_][\\w]*\\}?|\\$\\d)"]
    }),
    sql: spec({
      line: "--",
      block: ["/\\*", "\\*/"],
      strings: `'"`,
      keywords: [
        "SELECT",
        "FROM",
        "WHERE",
        "INSERT",
        "INTO",
        "VALUES",
        "UPDATE",
        "SET",
        "DELETE",
        "CREATE",
        "TABLE",
        "ALTER",
        "DROP",
        "INDEX",
        "JOIN",
        "LEFT",
        "RIGHT",
        "INNER",
        "OUTER",
        "ON",
        "GROUP",
        "ORDER",
        "BY",
        "HAVING",
        "LIMIT",
        "OFFSET",
        "AS",
        "AND",
        "OR",
        "NOT",
        "IN",
        "IS",
        "NULL",
        "DISTINCT",
        "UNION",
        "WITH",
        "RETURNING",
        "select",
        "from",
        "where",
        "insert",
        "into",
        "update",
        "delete",
        "join",
        "group",
        "order",
        "by",
        "limit",
        "and",
        "or",
        "not",
        "null"
      ],
      builtins: ["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NOW", "count", "sum", "avg"]
    }),
    go: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"\``,
      keywords: [
        "func",
        "package",
        "import",
        "return",
        "if",
        "else",
        "for",
        "range",
        "switch",
        "case",
        "default",
        "break",
        "continue",
        "go",
        "defer",
        "chan",
        "select",
        "type",
        "struct",
        "interface",
        "map",
        "var",
        "const"
      ],
      builtins: [
        "nil",
        "true",
        "false",
        "error",
        "string",
        "int",
        "int64",
        "float64",
        "bool",
        "byte",
        "make",
        "new",
        "len",
        "cap",
        "append",
        "panic",
        "recover",
        "fmt"
      ]
    }),
    rust: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: '"',
      keywords: [
        "fn",
        "let",
        "mut",
        "const",
        "static",
        "struct",
        "enum",
        "impl",
        "trait",
        "pub",
        "use",
        "mod",
        "match",
        "if",
        "else",
        "loop",
        "while",
        "for",
        "in",
        "return",
        "break",
        "continue",
        "move",
        "ref",
        "where",
        "async",
        "await",
        "dyn",
        "unsafe",
        "crate",
        "self"
      ],
      builtins: [
        "Some",
        "None",
        "Ok",
        "Err",
        "Option",
        "Result",
        "Vec",
        "String",
        "str",
        "bool",
        "u8",
        "u32",
        "u64",
        "i32",
        "i64",
        "f64",
        "usize",
        "println",
        "true",
        "false"
      ]
    }),
    java: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"'`,
      keywords: [
        "public",
        "private",
        "protected",
        "class",
        "interface",
        "extends",
        "implements",
        "static",
        "final",
        "void",
        "new",
        "return",
        "if",
        "else",
        "for",
        "while",
        "do",
        "switch",
        "case",
        "break",
        "continue",
        "try",
        "catch",
        "finally",
        "throw",
        "throws",
        "import",
        "package",
        "abstract",
        "synchronized",
        "this",
        "super",
        "instanceof"
      ],
      builtins: [
        "String",
        "int",
        "long",
        "double",
        "float",
        "boolean",
        "char",
        "byte",
        "true",
        "false",
        "null",
        "System",
        "List",
        "Map",
        "Integer",
        "Object"
      ]
    }),
    php: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"'`,
      keywords: [
        "function",
        "class",
        "public",
        "private",
        "protected",
        "static",
        "return",
        "if",
        "else",
        "elseif",
        "foreach",
        "for",
        "while",
        "switch",
        "case",
        "break",
        "continue",
        "new",
        "use",
        "namespace",
        "extends",
        "implements",
        "try",
        "catch",
        "finally",
        "throw",
        "echo"
      ],
      builtins: ["true", "false", "null", "array", "string", "int", "bool", "this", "self"],
      extra: ["(?<variable>\\$[A-Za-z_]\\w*)"]
    }),
    css: spec({
      block: ["/\\*", "\\*/"],
      strings: `"'`,
      extra: ["(?<selector>^[^\\n{}]+(?=\\s*\\{))", "(?<property>[-\\w]+(?=\\s*:))", "(?<variable>--[\\w-]+)"],
      builtins: ["important", "inherit", "initial", "none", "auto", "var", "calc", "rgb", "rgba"]
    }),
    html: spec({
      block: ["<!--", "-->"],
      strings: `"'`,
      extra: ["(?<tag><\\/?[A-Za-z][\\w:-]*)", "(?<attr>\\s[A-Za-z-]+(?=\\s*=))"]
    }),
    yaml: spec({
      line: "#",
      strings: `"'`,
      extra: ["(?<property>^\\s*[-\\w.]+(?=\\s*:))", "(?<punct2>^\\s*-\\s)"],
      builtins: ["true", "false", "null", "yes", "no"]
    }),
    graphql: spec({
      line: "#",
      strings: '"',
      keywords: [
        "query",
        "mutation",
        "subscription",
        "fragment",
        "on",
        "type",
        "input",
        "enum",
        "interface",
        "union",
        "scalar",
        "schema",
        "extend",
        "implements",
        "directive"
      ],
      builtins: ["ID", "String", "Int", "Float", "Boolean", "true", "false", "null"],
      early: ["(?<property>\\b[A-Za-z_]\\w*(?=\\s*:))", "(?<variable>\\$\\w+)", "(?<meta>@\\w+)"]
    }),
    kotlin: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"'`,
      keywords: [
        "fun",
        "val",
        "var",
        "class",
        "object",
        "interface",
        "data",
        "sealed",
        "when",
        "if",
        "else",
        "for",
        "while",
        "return",
        "import",
        "package",
        "override",
        "suspend",
        "companion",
        "private",
        "public",
        "internal",
        "lateinit",
        "init"
      ],
      builtins: ["String", "Int", "Long", "Double", "Boolean", "List", "Map", "true", "false", "null", "it", "this"]
    }),
    swift: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: '"',
      keywords: [
        "func",
        "let",
        "var",
        "class",
        "struct",
        "enum",
        "protocol",
        "extension",
        "guard",
        "if",
        "else",
        "for",
        "while",
        "return",
        "import",
        "switch",
        "case",
        "defer",
        "init",
        "self",
        "private",
        "public",
        "internal",
        "static",
        "override",
        "async",
        "await",
        "throws",
        "try"
      ],
      builtins: ["String", "Int", "Double", "Bool", "Array", "Dictionary", "true", "false", "nil", "print"]
    }),
    ruby: spec({
      line: "#",
      strings: `"'`,
      keywords: [
        "def",
        "end",
        "class",
        "module",
        "if",
        "elsif",
        "else",
        "unless",
        "while",
        "until",
        "do",
        "return",
        "require",
        "require_relative",
        "yield",
        "begin",
        "rescue",
        "ensure",
        "then",
        "case",
        "when",
        "attr_accessor",
        "attr_reader"
      ],
      builtins: ["nil", "true", "false", "self", "puts", "new", "nil?", "each", "map"],
      extra: ["(?<variable>[@$]\\w+)", "(?<meta>:\\w+)"]
    }),
    c: spec({
      line: "//",
      block: ["/\\*", "\\*/"],
      strings: `"'`,
      keywords: [
        "int",
        "char",
        "float",
        "double",
        "void",
        "long",
        "short",
        "unsigned",
        "signed",
        "struct",
        "union",
        "enum",
        "typedef",
        "static",
        "const",
        "extern",
        "return",
        "if",
        "else",
        "for",
        "while",
        "do",
        "switch",
        "case",
        "break",
        "continue",
        "goto",
        "sizeof",
        "class",
        "namespace",
        "template",
        "public",
        "private",
        "protected",
        "virtual",
        "new",
        "delete"
      ],
      builtins: ["NULL", "true", "false", "printf", "malloc", "free", "std", "cout", "string", "vector"],
      extra: ["(?<meta>^\\s*#\\s*\\w+)"]
    }),
    dockerfile: spec({
      line: "#",
      strings: `"'`,
      keywords: [
        "FROM",
        "RUN",
        "CMD",
        "LABEL",
        "EXPOSE",
        "ENV",
        "ADD",
        "COPY",
        "ENTRYPOINT",
        "VOLUME",
        "USER",
        "WORKDIR",
        "ARG",
        "ONBUILD",
        "HEALTHCHECK",
        "SHELL",
        "AS"
      ],
      extra: ["(?<variable>\\$\\{?\\w+\\}?)"]
    }),
    toml: spec({
      line: "#",
      strings: `"'`,
      extra: ["(?<selector>^\\s*\\[+[^\\]\\n]+\\]+)", "(?<property>^\\s*[\\w.-]+(?=\\s*=))"],
      builtins: ["true", "false"]
    }),
    diff: spec({
      extra: ["(?<added>^\\+[^\\n]*)", "(?<removed>^-[^\\n]*)", "(?<meta>^@@[^\\n]*|^diff [^\\n]*)"]
    })
  };
  var ALIAS = {
    comment1: "comment",
    comment2: "comment",
    string0: "string",
    string1: "string",
    string2: "string",
    punct2: "punct",
    property: "property",
    selector: "selector"
  };
  function highlight(code, language) {
    const pattern = LANGUAGES[language];
    if (!pattern) return escapeHtml2(code);
    let out = "";
    let last = 0;
    pattern.lastIndex = 0;
    const rx = new RegExp(pattern.source, "gm");
    for (let m = rx.exec(code); m !== null; m = rx.exec(code)) {
      if (m[0] === "") {
        rx.lastIndex += 1;
        continue;
      }
      const name = Object.keys(m.groups).find((k) => m.groups[k] !== void 0);
      if (!name) continue;
      out += escapeHtml2(code.slice(last, m.index));
      out += `<span class="bshl-${ALIAS[name] ?? name}">${escapeHtml2(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + escapeHtml2(code.slice(last));
  }

  // mods/plugins/code-highlight/detect.js
  var SIGNS = [
    ["diff", [
      [/^@@ -\d+.* \+\d+.* @@/m, 6],
      [/^diff --git /m, 6],
      [/^[+-][^+-]/m, 2]
    ]],
    ["graphql", [
      [/\b(query|mutation|subscription)\s+\w*\s*[({]/, 6],
      [/^\s*(type|input|enum|interface|scalar|union)\s+\w+\s*[{@]/m, 6],
      [/\bfragment \w+ on \w+/, 6],
      [/^\s*\w+(\(.*\))?\s*:\s*\[?[A-Z]\w*!?\]?!?\s*$/m, 3],
      [/[;=]\s*$/m, -3]
    ]],
    ["dockerfile", [
      [/^\s*FROM\s+\S+/m, 7],
      [/^\s*(RUN|CMD|COPY|ADD|ENTRYPOINT|WORKDIR|EXPOSE|ENV)\s+/m, 3]
    ]],
    ["toml", [
      [/^\s*\[[\w.-]+\]\s*$/m, 5],
      [/^\s*[\w.-]+\s*=\s*["\d[]/m, 3]
    ]],
    ["ruby", [
      [/^\s*def \w+[!?]?/m, 4],
      [/^\s*end\s*$/m, 4],
      [/\b(require|require_relative|attr_accessor|puts)\b/, 3],
      [/\b(nil|elsif|unless)\b/, 3],
      [/[;{]\s*$/m, -2]
    ]],
    ["kotlin", [
      [/\bfun \w+\s*\(/, 5],
      [/\b(val|var) \w+\s*[:=]/, 3],
      [/\b(data class|sealed class|companion object|suspend fun)\b/, 5]
    ]],
    ["swift", [
      [/\bfunc \w+\s*\(/, 4],
      [/\b(guard|let|var) .*\bin\b|\bguard let\b/, 3],
      [/@(objc|IBOutlet|State|Published)\b/, 5],
      [/\bprint\(".*"\)/, 2],
      [/\bnil\b/, 2]
    ]],
    ["c", [
      [/^\s*#\s*(include|define|ifndef|pragma)\b/m, 7],
      [/\b(int|void|char|float|double)\s+\w+\s*\([^)]*\)\s*\{/, 4],
      [/\bstd::|\bcout\s*<</, 5],
      [/\bprintf\s*\(/, 3]
    ]],
    ["json", [
      [/^\s*[{[]/, 2],
      [/"[^"]*"\s*:/, 3],
      // Two quoted keys rather than one. People paste fragments -- a slice of a
      // payload that starts mid-object -- and a fragment has no opening brace to
      // score on; measured against a real message that was being missed.
      [/"[^"]*"\s*:[\s\S]*?"[^"]*"\s*:/, 3],
      [/[}\]]\s*$/, 1],
      [/\b(function|def|const|SELECT)\b/i, -6]
    ]],
    ["html", [
      [/<\/[a-z][\w-]*>/i, 4],
      [/^\s*<(!doctype|html|div|span|p|body|head|script)\b/im, 4],
      [/<[a-z][\w-]*\s+[a-z-]+=/i, 2]
    ]],
    ["css", [
      [/^[^\n{}]+\{[^}]*:[^}]*;/m, 4],
      [/(^|\n)\s*(--[\w-]+|[a-z-]+)\s*:\s*[^;]+;/, 2],
      [/@(media|import|keyframes|supports)\b/, 3],
      [/\b(function|def|return)\b/, -4]
    ]],
    ["sql", [
      [/\bselect\b[\s\S]*\bfrom\b/i, 6],
      [/\b(insert into|update .* set|delete from|create table|alter table)\b/i, 6],
      [/\b(inner|left|right) join\b/i, 3]
    ]],
    ["bash", [
      [/^#!\/(bin|usr)/, 8],
      [/^\s*\$ /m, 4],
      [/\b(sudo|apt-get|brew install|chmod|mkdir -p|rm -rf)\b/, 4],
      [/\b(npm|pnpm|yarn|git|docker|kubectl) [a-z]/, 3],
      [/\$\{?\w+\}?/, 1],
      [/[;{}]\s*$/m, -1]
    ]],
    ["python", [
      [/^\s*def \w+\s*\(.*\)\s*:/m, 6],
      [/^\s*(from|import) [\w.]+/m, 3],
      [/^\s*class \w+.*:/m, 4],
      [/\b(elif|None|True|False|self)\b/, 3],
      [/\bprint\(/, 2],
      [/[;{]\s*$/m, -3]
    ]],
    ["go", [
      [/^\s*package \w+/m, 6],
      [/\bfunc \w*\s*\(/, 5],
      [/:=/, 3],
      [/\b(nil|struct|interface\{\})\b/, 2]
    ]],
    ["rust", [
      [/\bfn \w+\s*\(/, 5],
      [/\blet (mut )?\w+/, 3],
      [/\b(Some|None|Ok|Err)\(/, 4],
      [/->\s*\w+|::\w+/, 2],
      [/println!/, 4]
    ]],
    ["php", [
      [/<\?php/, 8],
      [/\$this->/, 5],
      [/\$\w+\s*=/, 3],
      [/\b(echo|namespace|use [\w\\]+;)\b/, 2]
    ]],
    ["java", [
      [/\b(public|private|protected)\s+(static\s+)?(final\s+)?[\w<>[\]]+\s+\w+\s*\(/, 5],
      [/\bSystem\.out\.print/, 6],
      [/^\s*(package|import)\s+[\w.]+;/m, 4],
      [/\bnew [A-Z]\w*\(/, 2]
    ]],
    ["typescript", [
      [/\binterface \w+\s*\{/, 5],
      [/:\s*(string|number|boolean|void|any|unknown)\b/, 4],
      [/\btype \w+\s*=/, 4],
      [/\b(readonly|implements|enum)\b/, 2],
      [/\bimport .* from ['"]/, 1]
    ]],
    ["javascript", [
      [/\b(const|let)\s+\w+\s*=/, 3],
      [/=>/, 2],
      [/\bfunction\s*\w*\s*\(/, 3],
      [/\b(console\.log|require\(|module\.exports)/, 4],
      [/\bimport .* from ['"]/, 2],
      [/:\s*(string|number|boolean)\b/, -2]
    ]],
    ["yaml", [
      [/^\s*[-\w.]+:\s*($|[^\s{[])/m, 3],
      // Two key lines rather than one: a single `word:` is a sentence in half the
      // messages ever written, and was scoring the same as a config file.
      [/^\s*[-\w.]+:\s*($|[^\s{[])[\s\S]*?^\s*[-\w.]+:\s*($|[^\s{[])/m, 3],
      [/^\s*- \w/m, 2],
      [/^---\s*$/m, 4],
      [/[{};]/, -2]
    ]]
  ];
  var FLOOR = 4;
  function detect(code) {
    const text = code.slice(0, 4e3);
    if (text.trim().length < 12) return null;
    let best = null;
    let bestScore = 0;
    for (const [language, signs] of SIGNS) {
      let score = 0;
      for (const [pattern, weight] of signs) if (pattern.test(text)) score += weight;
      if (score > bestScore) {
        bestScore = score;
        best = language;
      }
    }
    return bestScore >= FLOOR ? best : null;
  }

  // mods/plugins/theme-builder/colour.js
  function parseColour(input) {
    const text = String(input ?? "").trim();
    const hex = text.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let digits = hex[1];
      if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join("");
      if (digits.length !== 6 && digits.length !== 8) return null;
      const n = parseInt(digits.slice(0, 6), 16);
      const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
      return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a };
    }
    const fn = text.match(/^rgba?\(([^)]+)\)$/i);
    if (fn) {
      const parts = fn[1].split(/[,/]/).map((p) => parseFloat(p));
      if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
      const a = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
      const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
      return { r: clamp(parts[0]), g: clamp(parts[1]), b: clamp(parts[2]), a: Math.max(0, Math.min(1, a)) };
    }
    return null;
  }
  function formatCss({ r, g, b, a }) {
    if (a >= 1) return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
  }
  function flatten(colour, backdrop) {
    if (colour.a >= 1) return { ...colour, a: 1 };
    const a = colour.a;
    return {
      r: Math.round(colour.r * a + backdrop.r * (1 - a)),
      g: Math.round(colour.g * a + backdrop.g * (1 - a)),
      b: Math.round(colour.b * a + backdrop.b * (1 - a)),
      a: 1
    };
  }
  function channel(value) {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }
  function luminance({ r, g, b }) {
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }
  function contrast(foreground, background) {
    const fg = flatten(foreground, background);
    const [light, dark] = [luminance(fg), luminance(background)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  }
  function readability(ratio) {
    if (ratio >= 7) return { grade: "AAA", ok: true };
    if (ratio >= 4.5) return { grade: "AA", ok: true };
    if (ratio >= 3) return { grade: "AA Large", ok: false };
    return { grade: "Fail", ok: false };
  }
  function shade(colour, amount) {
    const target = amount >= 0 ? 255 : 0;
    const k = Math.abs(amount);
    return {
      r: Math.round(colour.r + (target - colour.r) * k),
      g: Math.round(colour.g + (target - colour.g) * k),
      b: Math.round(colour.b + (target - colour.b) * k),
      a: colour.a
    };
  }
  function derivePalette(background, accent) {
    const dark = luminance(background) < 0.4;
    const step = (amount) => shade(background, dark ? amount : -amount);
    return {
      bg: background,
      raised: step(0.05),
      chrome: dark ? shade(background, -0.35) : shade(background, -0.06),
      surface: step(0.1),
      selected: step(0.13),
      hover: step(0.03),
      text: dark ? shade(background, 0.92) : shade(background, -0.85),
      bright: dark ? shade(background, 0.98) : shade(background, -0.95),
      muted: dark ? shade(background, 0.5) : shade(background, -0.45),
      accent,
      accentText: dark ? shade(accent, 0.45) : shade(accent, -0.25),
      danger: dark ? { r: 221, g: 61, b: 72, a: 1 } : { r: 192, g: 19, b: 67, a: 1 }
    };
  }

  // mods/plugins/theme-builder/roles.js
  var ROLES = [
    { key: "bg", seed: true },
    { key: "accent", seed: true },
    { key: "chrome" },
    { key: "raised" },
    { key: "surface" },
    { key: "selected" },
    { key: "hover" },
    { key: "text" },
    { key: "bright" },
    { key: "muted" },
    { key: "accentText" },
    { key: "danger" }
  ];

  // scripts/api-demos.js
  var kit = createKit(document);
  var $ = (id) => document.getElementById(id);
  var store = /* @__PURE__ */ new Map();
  var helperCss = document.createElement("style");
  var toasted = () => {
  };
  var helpers = createHelpers({
    pluginId: "api-page",
    css: (text) => {
      helperCss.textContent = text;
    },
    toast: (message) => toasted(message),
    settings: {
      get: (key, fallback) => store.has(key) ? store.get(key) : fallback,
      set: async (key, value) => {
        store.set(key, value);
      }
    },
    track: (cleanup) => cleanup
  });
  function installStyles() {
    if (document.getElementById("sm-kit-css")) return;
    const style = document.createElement("style");
    style.id = "sm-kit-css";
    style.textContent = KIT_CSS;
    document.head.append(style, helperCss);
  }
  var el = (tag, className, children = []) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.append(...children);
    return node;
  };
  function control(spec2, state, draw) {
    const id = `pg-${spec2.key}-${Math.random().toString(36).slice(2, 7)}`;
    let input;
    if (spec2.type === "select") {
      input = kit.select(spec2.options.map((o) => ({ value: o, label: o })), {
        value: state[spec2.key],
        onChange: (value) => {
          state[spec2.key] = value;
          draw();
        }
      });
    } else if (spec2.type === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.className = "pg__check";
      input.checked = Boolean(state[spec2.key]);
      input.addEventListener("change", () => {
        state[spec2.key] = input.checked;
        draw();
      });
    } else {
      input = kit.input({ value: state[spec2.key], type: spec2.type === "number" ? "number" : "text" });
      input.addEventListener("input", () => {
        state[spec2.key] = spec2.type === "number" ? Number(input.value) : input.value;
        draw();
      });
    }
    input.id = id;
    const label = el("label", "pg__label");
    label.htmlFor = id;
    label.textContent = spec2.label ?? spec2.key;
    return el("div", "pg__control", [label, input]);
  }
  function playground(name, spec2) {
    const slot = document.querySelector(`[data-demo="${name}"]`);
    if (!slot) return;
    const state = {};
    for (const c of spec2.controls ?? []) state[c.key] = c.value;
    const stage = el("div", "pg__stage slack-stage");
    stage.dataset.theme = document.querySelector(".stage-theme")?.value ?? "midnight";
    const code = el("pre", "pg__code");
    const controls = el("div", "pg__controls");
    const draw = () => {
      try {
        const made = spec2.render(state, { stage });
        if (made !== void 0) stage.replaceChildren(...[].concat(made).filter(Boolean));
        code.innerHTML = highlight(spec2.code(state), "javascript");
      } catch (err) {
        stage.textContent = `this demo threw: ${err.message}`;
      }
    };
    if (spec2.controls?.length) {
      controls.replaceChildren(...spec2.controls.map((c) => control(c, state, draw)));
    }
    const preview = el("div", "pg__panel", spec2.controls?.length ? [stage, controls] : [stage]);
    const source = el("div", "pg__panel", [code, copyButton(() => code.textContent)]);
    source.hidden = true;
    const tabs = el("div", "pg__tabs");
    const tab = (label, panel, on) => {
      const button = el("button", "pg__tab");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-selected", String(on));
      button.addEventListener("click", () => {
        for (const other of tabs.querySelectorAll(".pg__tab")) other.setAttribute("aria-selected", "false");
        button.setAttribute("aria-selected", "true");
        preview.hidden = panel !== preview;
        source.hidden = panel !== source;
      });
      return button;
    };
    tabs.append(tab("Preview", preview, true), tab("Code", source, false));
    slot.replaceChildren(el("div", "pg", [tabs, preview, source]));
    draw();
  }
  function copyButton(text) {
    const button = el("button", "pg__copy");
    button.type = "button";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      const ok = await kit.copyText(text());
      button.textContent = ok ? "Copied" : "Press \u2318C";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1600);
    });
    return button;
  }
  var KIT = {
    el: {
      controls: [
        { key: "tag", type: "select", options: ["div", "p", "strong", "span"], value: "p" },
        { key: "text", type: "text", value: "Built with the same maker as everything below." },
        { key: "className", label: "class", type: "text", value: "sm-hint" }
      ],
      render: (v) => kit.el(v.tag, { class: v.className }, [v.text]),
      code: (v) => `kit.el('${v.tag}', { class: '${v.className}' }, ['${v.text}'])`
    },
    button: {
      controls: [
        { key: "label", type: "text", value: "Save" },
        { key: "variant", type: "select", options: ["default", "primary", "ghost", "danger"], value: "primary" },
        { key: "wide", type: "boolean", value: false },
        { key: "title", label: "tooltip", type: "text", value: "Write the theme to disk" }
      ],
      render: (v) => kit.button(v.label, { variant: v.variant, wide: v.wide, title: v.title }),
      code: (v) => `kit.button('${v.label}', {
  variant: '${v.variant}',
  wide: ${v.wide},
  title: '${v.title}',
})`
    },
    iconButton: {
      controls: [
        { key: "glyph", type: "text", value: "\u270E" },
        { key: "title", type: "text", value: "Rename" },
        { key: "danger", type: "boolean", value: false }
      ],
      render: (v) => kit.iconButton(v.glyph, { title: v.title, danger: v.danger }),
      code: (v) => `kit.iconButton('${v.glyph}', { title: '${v.title}', danger: ${v.danger} })`
    },
    input: {
      controls: [
        { key: "value", type: "text", value: "Midnight" },
        { key: "placeholder", type: "text", value: "Theme name" }
      ],
      render: (v) => kit.input({ value: v.value, placeholder: v.placeholder }),
      code: (v) => `kit.input({ value: '${v.value}', placeholder: '${v.placeholder}' })`
    },
    field: {
      controls: [
        { key: "label", type: "text", value: "Theme name" },
        { key: "hint", type: "text", value: "Shown in the panel and in the palette." }
      ],
      render: (v) => kit.field(v.label, kit.input({ value: "Midnight" }), v.hint),
      code: (v) => `kit.field('${v.label}', kit.input({ value: 'Midnight' }),
  '${v.hint}')`
    },
    select: {
      controls: [
        { key: "options", type: "text", value: "dark, light, follow the system" },
        { key: "value", type: "text", value: "dark" }
      ],
      render: (v) => kit.select(
        v.options.split(",").map((o) => ({ value: o.trim(), label: o.trim() })),
        { value: v.value.trim() }
      ),
      code: (v) => `kit.select([
${v.options.split(",").map((o) => `  { value: '${o.trim()}', label: '${o.trim()}' },`).join("\n")}
], { value: '${v.value.trim()}' })`
    },
    segmented: {
      controls: [
        { key: "labels", type: "text", value: "Colours, CSS, Inspect" },
        { key: "count", label: "badge on the first", type: "number", value: 12 }
      ],
      render: (v) => kit.segmented(
        v.labels.split(",").map((label, i) => ({
          value: label.trim().toLowerCase(),
          label: label.trim(),
          count: i === 0 && v.count ? v.count : void 0
        })),
        { value: v.labels.split(",")[0].trim().toLowerCase() }
      ).node,
      code: (v) => `kit.segmented([
${v.labels.split(",").map((l, i) => `  { value: '${l.trim().toLowerCase()}', label: '${l.trim()}'${i === 0 && v.count ? `, count: ${v.count}` : ""} },`).join("\n")}
], { value: '${v.labels.split(",")[0].trim().toLowerCase()}' }).node`
    },
    card: {
      controls: [
        { key: "title", type: "text", value: "Palette" },
        { key: "subtitle", type: "text", value: "Two colours, ten derived" },
        { key: "action", label: "action button", type: "text", value: "Reset" }
      ],
      render: (v) => kit.card(v.title, [kit.el("p", { class: "sm-hint" }, [v.subtitle])], {
        actions: v.action ? [kit.button(v.action, { variant: "ghost" })] : []
      }),
      code: (v) => `kit.card('${v.title}', [
  kit.el('p', { class: 'sm-hint' }, ['${v.subtitle}']),
], { actions: [kit.button('${v.action}', { variant: 'ghost' })] })`
    },
    emptyState: {
      controls: [
        { key: "title", type: "text", value: "No themes yet" },
        { key: "body", type: "text", value: "Build one and it appears here." },
        { key: "action", label: "button", type: "text", value: "New theme" }
      ],
      render: (v) => kit.emptyState(v.title, v.body, v.action ? kit.button(v.action, { variant: "primary" }) : void 0),
      code: (v) => `kit.emptyState('${v.title}', '${v.body}',
  kit.button('${v.action}', { variant: 'primary' }))`
    },
    swatch: {
      controls: [
        { key: "colour", type: "text", value: "rgba(97, 31, 105, 0.55)" },
        { key: "size", type: "select", options: ["sm", "md", "lg"], value: "lg" }
      ],
      render: (v) => kit.swatch(v.colour, { size: v.size }),
      code: (v) => `// a translucent colour reads as translucent: the checkerboard is kit.CHECKER
kit.swatch('${v.colour}', { size: '${v.size}' })`
    },
    popover: {
      controls: [{ key: "label", type: "text", value: "Open a popover" }],
      render: (v) => {
        const anchor = kit.button(v.label);
        anchor.addEventListener("click", () => {
          const content = kit.el("div", { style: "padding:12px;min-width:210px" }, [
            kit.el("p", { class: "sm-hint", style: "margin:0 0 10px" }, ["Anchored, and dismissed by a click outside."])
          ]);
          kit.popover(content, anchor);
        });
        return anchor;
      },
      code: (v) => `const anchor = kit.button('${v.label}');
anchor.addEventListener('click', () => {
  kit.popover(content, anchor);
});`
    },
    confirm: {
      controls: [
        { key: "title", type: "text", value: "Delete Midnight?" },
        { key: "body", type: "text", value: "The stylesheet goes with it. This cannot be undone." },
        { key: "action", type: "text", value: "Delete" },
        { key: "danger", type: "boolean", value: true }
      ],
      render: (v) => {
        const trigger = kit.button(v.action, { variant: v.danger ? "danger" : "primary" });
        const said = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, [""]);
        trigger.addEventListener("click", async () => {
          const yes = await kit.confirm({
            title: v.title,
            body: v.body,
            action: v.action,
            cancel: "Keep it",
            danger: v.danger
          });
          said.textContent = yes ? `it resolved true` : "it resolved false";
        });
        return [trigger, said];
      },
      code: (v) => `const yes = await kit.confirm({
  title: '${v.title}',
  body: '${v.body}',
  action: '${v.action}',
  cancel: 'Keep it',
  danger: ${v.danger},
});`
    },
    copyText: {
      controls: [{ key: "text", type: "text", value: "#611f69" }],
      render: (v) => {
        const button = kit.button(`Copy ${v.text}`);
        const said = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, [""]);
        button.addEventListener("click", async () => {
          said.textContent = await kit.copyText(v.text) ? "resolved true" : "resolved false";
        });
        return [button, said];
      },
      code: (v) => `const ok = await kit.copyText('${v.text}');`
    },
    code: {
      controls: [
        { key: "value", type: "text", value: ":root { --dt_color-base-pry: #0b0d12; }" }
      ],
      render: (v) => kit.code({ value: v.value }).node,
      code: (v) => `const editor = kit.code({ value: '${v.value}' });
document.body.append(editor.node);
editor.value(); // what is in it now`
    }
  };
  var HELPERS = {
    toggle: {
      controls: [
        { key: "className", label: "class on <html>", type: "text", value: "demo-zen" },
        { key: "defaultOn", type: "boolean", value: false }
      ],
      render: (v) => {
        for (const name of [...document.documentElement.classList]) {
          if (name.startsWith("demo-") || name.startsWith("betterslack-api-page")) {
            document.documentElement.classList.remove(name);
          }
        }
        const flag = helpers.toggle({
          key: `demo-${v.className}`,
          className: v.className,
          defaultOn: v.defaultOn,
          whenOn: "& .pg__watch { outline: 2px solid #36c5f0; }"
        });
        const watch = el("div", "pg__watch");
        const state = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, []);
        const paint = () => {
          state.textContent = flag.on ? `on \u2014 <html class="${v.className}">` : "off \u2014 the class is gone, and so is the CSS";
        };
        watch.append(kit.button("Toggle", { variant: "primary" }), state);
        watch.querySelector("button").addEventListener("click", async () => {
          await flag.toggle();
          paint();
        });
        paint();
        return watch;
      },
      code: (v) => `const zen = api.helpers.toggle({
  key: 'on',
  className: '${v.className}',
  defaultOn: ${v.defaultOn},
  whenOn: '& .p-channel_sidebar { display: none !important; }',
});
await zen.toggle();`
    },
    describeHotkey: {
      controls: [{ key: "combo", type: "text", value: "mod+shift+f" }],
      render: (v) => kit.el("strong", { style: "font-size:20px" }, [helpers.describeHotkey(v.combo)]),
      code: (v) => `api.helpers.describeHotkey('${v.combo}')
// \u2318\u21E7F on a Mac, Ctrl+Shift+F elsewhere`
    },
    debounce: {
      controls: [{ key: "ms", label: "milliseconds", type: "number", value: 400 }],
      render: (v, { stage }) => {
        const out = kit.el("p", { class: "sm-hint" }, ["type below"]);
        let typed = 0;
        let ran = 0;
        const run = helpers.debounce(() => {
          ran += 1;
          out.textContent = `${typed} keystrokes, ${ran} call${ran === 1 ? "" : "s"} through`;
        }, v.ms);
        const box = kit.input({ placeholder: "type quickly, then stop" });
        box.addEventListener("input", () => {
          typed += 1;
          run();
        });
        return [box, out];
      },
      code: (v) => `const search = api.helpers.debounce((q) => run(q), ${v.ms});
box.addEventListener('input', () => search(box.value));`
    }
  };
  var ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 6.5v4M10 13.2v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var UI = {
    "ui-toast": {
      controls: [
        { key: "message", type: "text", value: "Theme saved" },
        { key: "variant", type: "select", options: ["info", "success", "warning", "error"], value: "success" },
        { key: "action", label: "action label", type: "text", value: "Undo" }
      ],
      render: (v) => {
        const button = kit.button("Show the toast", { variant: "primary" });
        button.addEventListener("click", () => toast(v.message, {
          variant: v.variant,
          action: v.action ? { label: v.action, onClick: () => {
          } } : void 0
        }));
        return button;
      },
      code: (v) => `api.ui.toast('${v.message}', {
  variant: '${v.variant}',
  action: { label: '${v.action}', onClick: () => undo() },
});`
    },
    "ui-modal": {
      controls: [
        { key: "title", type: "text", value: "Channel notes" },
        { key: "body", type: "text", value: "Kept on this machine only. Nothing is sent anywhere." },
        { key: "action", type: "text", value: "Save" },
        { key: "width", type: "number", value: 460 }
      ],
      render: (v) => {
        const button = kit.button("Open the dialog", { variant: "primary" });
        button.addEventListener("click", () => {
          modal({
            title: v.title,
            content: h("p", { class: "betterslack-hint" }, [v.body]),
            width: v.width,
            actions: [{ label: v.action, primary: true, onClick: () => true }]
          });
        });
        return button;
      },
      code: (v) => `api.ui.modal({
  title: '${v.title}',
  content: api.dom.h('p', {}, ['${v.body}']),
  width: ${v.width},
  actions: [{ label: '${v.action}', primary: true, onClick: () => true }],
});`
    },
    "ui-confirm": {
      controls: [
        { key: "title", type: "text", value: "Remove Midnight?" },
        { key: "body", type: "text", value: "Its files go with it." },
        { key: "danger", type: "boolean", value: true }
      ],
      render: (v) => {
        const button = kit.button("Ask", { variant: v.danger ? "danger" : "primary" });
        const said = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, [""]);
        button.addEventListener("click", async () => {
          said.textContent = await confirm({ title: v.title, body: v.body, danger: v.danger }) ? "resolved true" : "resolved false";
        });
        return [button, said];
      },
      code: (v) => `const sure = await api.ui.confirm({
  title: '${v.title}',
  body: '${v.body}',
  danger: ${v.danger},
});`
    },
    "ui-menu": {
      controls: [{ key: "items", type: "text", value: "Rename, Duplicate, Remove" }],
      render: (v) => {
        const anchor = kit.button("Open the menu");
        anchor.addEventListener("click", () => openMenu(anchor, v.items.split(",").map((label, i) => ({
          label: label.trim(),
          danger: i === v.items.split(",").length - 1,
          onSelect: () => {
          }
        }))));
        return anchor;
      },
      code: (v) => `api.ui.menu(anchor, [
${v.items.split(",").map((l, i, a) => `  { label: '${l.trim()}'${i === a.length - 1 ? ", danger: true" : ""}, onSelect: () => {} },`).join("\n")}
]);`
    }
  };
  function slackChrome() {
    const frame = el("div", "chrome");
    frame.innerHTML = SLACK_FIXTURE;
    for (const img of frame.querySelectorAll("img")) {
      const avatar = document.createElement("span");
      avatar.className = img.className;
      avatar.setAttribute("style", "display:inline-block;width:36px;height:36px;border-radius:8px;background:var(--dt_color-content-hgl-1, #7cc4ff);opacity:.5");
      img.replaceWith(avatar);
    }
    return frame;
  }
  function focusChrome(frame, selector) {
    const target = frame.querySelector(selector);
    if (!target) return;
    for (const node of frame.querySelectorAll("*")) node.classList.add("is-out");
    for (let node = target; node && node !== frame; node = node.parentElement) node.classList.remove("is-out");
    for (const node of target.querySelectorAll("*")) node.classList.remove("is-out");
  }
  var TOOLBAR_CONTAINER = {
    controlStrip: ".p-control_strip",
    composer: '[data-qa="message_input"]',
    channelHeader: ".p-view_header__actions"
  };
  var CHROME = {
    "slack-addtoolbarbutton": {
      controls: [
        { key: "toolbar", type: "select", options: ["controlStrip", "composer", "channelHeader"], value: "controlStrip" },
        { key: "label", type: "text", value: "Channel notes" }
      ],
      render: (v, { stage }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        addToolbarButton("demo", v.toolbar, { id: "demo", label: v.label, icon: ICON, onClick: () => {
        } });
        focusChrome(frame, TOOLBAR_CONTAINER[v.toolbar]);
        return void 0;
      },
      code: (v) => `api.slack.addToolbarButton('${v.toolbar}', {
  id: 'notes',
  label: '${v.label}',
  icon: '<svg viewBox="0 0 20 20">\u2026</svg>',
  onClick: () => open(),
});`
    },
    "slack-addmessageaction": {
      controls: [{ key: "label", type: "text", value: "Copy link" }],
      render: (v, { stage }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        addMessageAction("demo", { id: "demo", label: v.label, icon: ICON, onClick: () => {
        } });
        focusChrome(frame, '[data-qa="message_container"]');
        return void 0;
      },
      code: (v) => `api.slack.addMessageAction({
  id: 'copy-link',
  label: '${v.label}',
  icon: '<svg viewBox="0 0 20 20">\u2026</svg>',
  onClick: (message) => copy(message.permalink),
});`
    },
    "slack-addprofilebutton": {
      controls: [{ key: "label", type: "text", value: "Download picture" }],
      render: (v, { stage }) => {
        const frame = slackChrome();
        stage.replaceChildren(frame);
        addProfileButton("demo", { id: "demo", label: v.label, icon: ICON, onClick: () => {
        } });
        focusChrome(frame, '[data-qa="member_profile_pane"]');
        return void 0;
      },
      code: (v) => `api.slack.addProfileButton({
  id: 'download',
  label: '${v.label}',
  icon: '<svg viewBox="0 0 20 20">\u2026</svg>',
  onClick: ({ userId }) => save(userId),
});`
    },
    "slack-avatarurl": {
      controls: [
        { key: "url", type: "text", value: "https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE1-06c4356b6ae3-48" },
        { key: "size", type: "select", options: ["24", "48", "72", "192", "512"], value: "192" }
      ],
      render: (v) => {
        const at = /-\d+$/.test(v.url) ? v.url.replace(/-\d+$/, `-${v.size}`) : null;
        return kit.el("code", { class: "sm-hint", style: "word-break:break-all" }, [at ?? "null \u2014 not one of Slack\u2019s avatar URLs"]);
      },
      code: (v) => `api.slack.avatarUrl(
  '${v.url}',
  ${v.size},
);`
    },
    "dom-h": {
      controls: [
        { key: "tag", type: "select", options: ["div", "button", "span"], value: "button" },
        { key: "className", label: "class", type: "text", value: "c-button c-button--primary" },
        { key: "text", type: "text", value: "Made with api.dom.h" }
      ],
      render: (v) => h(v.tag, { class: v.className }, [v.text]),
      code: (v) => `api.dom.h('${v.tag}', { class: '${v.className}' }, ['${v.text}']);`
    }
  };
  var SLACK_HELPERS = {
    "helpers-iconbutton": {
      controls: [
        { key: "label", type: "text", value: "Notes" },
        { key: "surface", type: "select", options: ["strip", "header", "composer"], value: "header" }
      ],
      render: (v) => helpers.iconButton({ icon: ICON, label: v.label, surface: v.surface, onClick: () => {
      } }),
      code: (v) => `api.helpers.iconButton({
  icon: '<svg viewBox="0 0 20 20">\u2026</svg>',
  label: '${v.label}',
  surface: '${v.surface}',
  onClick: () => open(),
});`
    },
    "helpers-field": {
      controls: [
        { key: "label", type: "text", value: "Time zone" },
        { key: "value", type: "text", value: "Europe/Paris" }
      ],
      render: (v) => helpers.field(v.label, v.value),
      code: (v) => `api.helpers.field('${v.label}', '${v.value}');`
    },
    "helpers-section": {
      controls: [
        { key: "title", type: "text", value: "More details" },
        { key: "rows", type: "text", value: "User ID: U04KY0Z61, Time zone: Europe/Paris" }
      ],
      render: (v) => helpers.section(v.title, v.rows.split(",").map((row) => {
        const [label, value] = row.split(":");
        return helpers.field((label ?? "").trim(), (value ?? "").trim());
      })),
      code: (v) => `api.helpers.section('${v.title}', [
  api.helpers.field('User ID', user.id),
  api.helpers.field('Time zone', user.tz_label),
]);`
    },
    "helpers-badge": {
      controls: [{ key: "value", type: "number", value: 3 }],
      render: (v, { stage }) => {
        const host = el("div", "pg__badge-host");
        host.append(helpers.iconButton({ icon: ICON, label: "Activity", surface: "header", onClick: () => {
        } }));
        stage.replaceChildren(host);
        helpers.badge(".pg__badge-host button", "demo-badge", () => v.value || null);
        return void 0;
      },
      code: (v) => `let unread = ${v.value};
api.helpers.badge('[data-qa="betterslack_button"]', 'unread', () => unread);`
    },
    "helpers-tooltip": {
      controls: [
        { key: "title", type: "text", value: "Channel notes" },
        { key: "subtitle", type: "text", value: "\u2318\u21E7N" }
      ],
      render: (v) => {
        const button = helpers.iconButton({ icon: ICON, label: v.title, surface: "header", onClick: () => {
        } });
        helpers.tooltip(button, v.title, v.subtitle);
        return [button, kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, ["hover it"])];
      },
      code: (v) => `api.helpers.tooltip(button, '${v.title}', '${v.subtitle}');`
    }
  };
  function mountI18n() {
    const locale = $("i18n-locale");
    const key = $("i18n-key");
    const name = $("i18n-name");
    const out = $("i18n-out");
    if (!locale || !out) return;
    const TABLES = {
      en: { hello: "Hi {name}, {count} unread", bye: "See you" },
      fr: { hello: "Salut {name}, {count} non lus" }
    };
    const draw = () => {
      const t = createI18n(locale.value).strings(TABLES);
      out.textContent = t(key.value, { name: name.value, count: 3 });
    };
    for (const node of [locale, key, name]) node.addEventListener("input", draw);
    locale.addEventListener("change", draw);
    draw();
  }
  function mountMarkdown() {
    const source = $("md-source");
    const out = $("md-out");
    if (!source || !out) return;
    const draw = () => {
      out.innerHTML = renderMarkdown(source.value);
    };
    source.addEventListener("input", draw);
    draw();
  }
  function mountHighlight() {
    const source = $("hl-source");
    const out = $("hl-out");
    const guess = $("hl-guess");
    const pick = $("hl-lang");
    if (!source || !out) return;
    if (pick) {
      pick.replaceChildren(
        new Option("detect it for me", ""),
        ...Object.keys(LANGUAGES).sort().map((id) => new Option(id, id))
      );
    }
    const draw = () => {
      const chosen = pick && pick.value ? pick.value : detect(source.value);
      if (guess) {
        guess.textContent = pick && pick.value ? `forced to ${chosen}` : chosen ? `detected: ${chosen}` : "not confident \u2014 left alone, which is the point";
      }
      out.innerHTML = chosen ? highlight(source.value, chosen) : source.value.replace(/[<&]/g, (c) => c === "<" ? "&lt;" : "&amp;");
    };
    source.addEventListener("input", draw);
    pick?.addEventListener("change", draw);
    draw();
  }
  function mountRoles() {
    const base = $("role-base");
    const accent = $("role-accent");
    const grid = $("role-grid");
    const out = $("role-css");
    if (!base || !accent || !grid) return;
    const draw = () => {
      const palette = derivePalette(parseColour(base.value), parseColour(accent.value));
      grid.replaceChildren(...ROLES.map((role) => kit.el("div", { class: "role" }, [
        kit.swatch(formatCss(palette[role.key]), { size: "md" }),
        kit.el("div", { class: "role__text" }, [
          kit.el("strong", {}, [role.key + (role.seed ? " (seed)" : "")]),
          kit.el("span", { class: "sm-hint" }, [formatCss(palette[role.key])])
        ])
      ])));
      if (out) {
        const ratio = contrast(palette.text, palette.bg);
        const verdict = readability(ratio);
        out.textContent = `contrast(text, bg) = ${ratio.toFixed(2)} \u2014 ${verdict.grade}`;
        out.classList.toggle("is-bad", !verdict.ok);
      }
    };
    base.addEventListener("input", draw);
    accent.addEventListener("input", draw);
    draw();
  }
  installStyles();
  function wireThemePickers() {
    const pickers = [...document.querySelectorAll(".stage-theme")];
    if (!pickers.length) return;
    const apply = (value) => {
      for (const stage of document.querySelectorAll(".slack-stage")) stage.dataset.theme = value;
      for (const other of pickers) other.value = value;
    };
    for (const picker of pickers) picker.addEventListener("change", () => apply(picker.value));
    apply(pickers[0].value);
  }
  function router() {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const stack = document.querySelector(".stack");
    const links = [...document.querySelectorAll(".side__list a")];
    if (!stack || !links.length) return;
    const show = (slug) => {
      const wanted = document.getElementById(`p-${slug}`) ?? stack.querySelector(".panel");
      for (const panel of stack.querySelectorAll(".panel")) panel.hidden = panel !== wanted;
      for (const link of links) {
        const current = link.getAttribute("href") === `#${wanted.id.slice(2)}`;
        link.toggleAttribute("aria-current", current);
        if (current) link.scrollIntoView({ block: "nearest" });
      }
      stack.scrollTop = 0;
      requestAnimationFrame(() => {
        stack.scrollTop = 0;
        document.documentElement.scrollTop = 0;
      });
    };
    const fromHash = () => show(location.hash.slice(1) || stack.dataset.first);
    window.addEventListener("hashchange", fromHash);
    fromHash();
  }
  function filter() {
    const box = document.getElementById("side-filter");
    if (!box) return;
    box.addEventListener("input", () => {
      const needle = box.value.trim().toLowerCase();
      for (const group of document.querySelectorAll(".side__group")) {
        let shown = 0;
        for (const item of group.querySelectorAll("li")) {
          const hit = !needle || (item.textContent ?? "").toLowerCase().includes(needle);
          item.hidden = !hit;
          if (hit) shown += 1;
        }
        group.hidden = shown === 0;
      }
    });
  }
  toasted = (message) => {
    const note = $("helpers-toast");
    if (note) note.textContent = `api.ui.toast(${JSON.stringify(message)})`;
  };
  for (const [name, spec2] of Object.entries(KIT)) playground(`kit-${name.toLowerCase()}`, spec2);
  for (const [name, spec2] of Object.entries(HELPERS)) playground(`helpers-${name.toLowerCase()}`, spec2);
  for (const group of [UI, CHROME, SLACK_HELPERS]) {
    for (const [slug, spec2] of Object.entries(group)) playground(slug, spec2);
  }
  mountI18n();
  mountMarkdown();
  mountHighlight();
  mountRoles();
  wireThemePickers();
  router();
  filter();
  for (const block of document.querySelectorAll(".api-code")) {
    block.append(copyButton(() => block.querySelector("code")?.textContent ?? ""));
  }
})();
