"use strict";
(() => {
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

  // src/runtime/ui/kit.ts
  function createKit(doc = document) {
    const el = (tag, props = {}, children = []) => {
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
      const node = el("button", { class: `sm-btn sm-btn--${variant}`, title, type: "button" }, [
        icon ? el("span", { class: "sm-btn__icon", html: icon }) : null,
        el("span", { textContent: label })
      ]);
      if (wide) node.classList.add("sm-btn--wide");
      if (onClick) node.addEventListener("click", onClick);
      if (onHover) hoverable(node, onHover);
      return node;
    };
    const iconButton = (glyph, { onClick, title, danger } = {}) => {
      const node = el("button", {
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
    const field = (label, control, hint) => el("div", { class: "field" }, [
      el("label", { class: "field__label", textContent: label }),
      control,
      hint ? el("p", { class: "field__hint", textContent: hint }) : null
    ]);
    const input = (props = {}) => {
      const { class: extra, ...rest } = props;
      return el("input", {
        class: extra ? `sm-input ${String(extra)}` : "sm-input",
        type: "text",
        spellcheck: false,
        ...rest
      });
    };
    const select = (options, { onChange, title } = {}) => {
      const node = el("select", { class: "sm-input sm-select", title });
      for (const option of options) {
        node.append(el("option", { value: option.value, textContent: option.label }));
      }
      if (onChange) node.addEventListener("change", () => onChange(node.value));
      return node;
    };
    const segmented = (options, { onChange } = {}) => {
      const node = el("div", { class: "sm-segmented", role: "tablist" });
      let value = options[0]?.value ?? "";
      const buttons = /* @__PURE__ */ new Map();
      const set = (next) => {
        value = next;
        for (const [key, item] of buttons) item.setAttribute("aria-selected", String(key === next));
      };
      for (const option of options) {
        const item = el("button", {
          class: "sm-segmented__item",
          type: "button",
          role: "tab",
          title: option.title
        }, [
          el("span", { textContent: option.label }),
          option.count === void 0 ? null : el("em", { textContent: String(option.count) })
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
    const card = (title, children, { actions, subtitle } = {}) => el("section", { class: "sm-card" }, [
      title ? el("header", { class: "sm-card__head" }, [
        el("div", {}, [
          el("h2", { textContent: title }),
          subtitle ? el("p", { textContent: subtitle }) : null
        ]),
        actions ? el("div", { class: "sm-card__actions" }, actions) : null
      ]) : null,
      el("div", { class: "sm-card__body" }, children)
    ]);
    const emptyState = (title, body, action) => el("div", { class: "sm-empty" }, [
      el("h3", { textContent: title }),
      el("p", { textContent: body }),
      action ?? null
    ]);
    const CHECKER = "linear-gradient(45deg,rgba(0,0,0,.28) 25%,transparent 25%),linear-gradient(-45deg,rgba(0,0,0,.28) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(0,0,0,.28) 75%),linear-gradient(-45deg,transparent 75%,rgba(0,0,0,.28) 75%)";
    const swatch = (css, { size = "md" } = {}) => {
      const node = el("span", { class: `sm-swatch sm-swatch--${size}` });
      node.style.backgroundImage = `linear-gradient(${css}, ${css}), ${CHECKER}`;
      return node;
    };
    const popover = (content, anchor, { onClose } = {}) => {
      const node = el("div", { class: "sm-popover" }, [content]);
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
    const confirm = ({ title, body, action, cancel: cancelLabel, danger }) => new Promise((resolve) => {
      const scrim = el("div", { class: "sm-scrim" });
      const cancel = button(cancelLabel, { variant: "ghost" });
      const go = button(action, { variant: danger ? "danger" : "primary" });
      const dialog = el("div", { class: "sm-dialog", role: "dialog", "aria-modal": "true" }, [
        el("h2", { textContent: title }),
        el("p", { textContent: body }),
        el("div", { class: "sm-dialog__actions" }, [cancel, go])
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
        const scratch = el("textarea", { value: text });
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
      el,
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
      confirm,
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
  function installKitCss() {
    if (document.getElementById("sm-kit-css")) return;
    const style = document.createElement("style");
    style.id = "sm-kit-css";
    style.textContent = KIT_CSS;
    document.head.append(style);
  }
  var DEMOS = {
    el: () => [kit.el("div", { class: "sm-card" }, [
      kit.el("strong", {}, ["kit.el"]),
      kit.el("p", { class: "sm-hint", style: "margin:4px 0 0" }, ["The same maker every primitive below is built from."])
    ])],
    copyText: () => {
      const button = kit.button("Copy \u201C#611f69\u201D");
      const said = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, [""]);
      button.addEventListener("click", async () => {
        said.textContent = await kit.copyText("#611f69") ? "copied" : "the clipboard said no";
      });
      return [button, said];
    },
    button: () => [
      kit.button("Save", { variant: "primary" }),
      kit.button("Cancel"),
      kit.button("Skip", { variant: "ghost" }),
      kit.button("Remove", { variant: "danger" })
    ],
    buttonWide: () => [kit.button("Apply to every theme", { variant: "primary", wide: true })],
    iconButton: () => [
      kit.iconButton("\u270E", { title: "Rename" }),
      kit.iconButton("\u29C9", { title: "Duplicate" }),
      kit.iconButton("\u{1F5D1}", { title: "Delete", danger: true })
    ],
    input: () => [kit.input({ value: "Midnight", placeholder: "Theme name" })],
    field: () => [kit.field("Theme name", kit.input({ value: "Midnight" }), "Shown in the panel and in the palette.")],
    select: () => [kit.select(
      [{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }],
      { value: "dark" }
    )],
    segmented: () => [kit.segmented(
      [{ value: "colours", label: "Colours", count: 12 }, { value: "css", label: "CSS" }],
      { value: "colours" }
    ).node],
    card: () => [kit.card("Palette", [kit.el("p", { class: "sm-hint" }, ["Two colours, ten derived."])], {
      actions: [kit.button("Reset", { variant: "ghost" })]
    })],
    emptyState: () => [kit.emptyState("No themes yet", "Build one and it appears here.", kit.button("New theme", { variant: "primary" }))],
    swatch: () => ["sm", "md", "lg"].map((size) => kit.swatch("#611f69", { size })),
    checker: () => [kit.swatch("rgba(97, 31, 105, 0.35)", { size: "lg" })],
    popover: () => {
      const anchor = kit.button("Open a popover");
      anchor.addEventListener("click", () => {
        const content = kit.el("div", { style: "padding:12px;min-width:200px" }, [
          kit.el("p", { class: "sm-hint", style: "margin:0 0 10px" }, ["Anchored, and dismissed on a click outside."]),
          kit.button("Got it", { variant: "primary", wide: true })
        ]);
        const pop = kit.popover(content, anchor);
        content.querySelector("button").addEventListener("click", () => pop.close());
      });
      return [anchor];
    },
    confirm: () => {
      const trigger = kit.button("Delete the theme", { variant: "danger" });
      const said = kit.el("span", { class: "sm-hint", style: "margin-left:10px" }, [""]);
      trigger.addEventListener("click", async () => {
        const yes = await kit.confirm({
          title: "Delete Midnight?",
          body: "The stylesheet goes with it. This cannot be undone.",
          action: "Delete",
          cancel: "Keep it",
          danger: true
        });
        said.textContent = yes ? "you chose Delete" : "you chose Keep it";
      });
      return [trigger, said];
    },
    code: () => {
      const editor = kit.code({
        value: ":root {\n  --dt_color-base-pry: #0b0d12;\n  /* the message surface */\n}"
      });
      return [editor.node];
    }
  };
  function mountGallery() {
    for (const [name, build] of Object.entries(DEMOS)) {
      const slot = document.querySelector(`[data-demo="${name}"]`);
      if (!slot) continue;
      try {
        slot.replaceChildren(...build());
      } catch (err) {
        slot.textContent = `this demo failed: ${err.message}`;
      }
    }
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
  installKitCss();
  mountGallery();
  mountMarkdown();
  mountHighlight();
  mountRoles();
})();
