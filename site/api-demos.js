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
    const confirm = ({ title, body, action, cancel: cancelLabel, danger }) => new Promise((resolve) => {
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
    const stage = el("div", "pg__stage");
    const code = el("pre", "pg__code");
    const draw = () => {
      try {
        const made = spec2.render(state, { stage });
        if (made !== void 0) stage.replaceChildren(...[].concat(made).filter(Boolean));
        code.innerHTML = highlight(spec2.code(state), "javascript");
      } catch (err) {
        stage.textContent = `this demo threw: ${err.message}`;
      }
    };
    const parts = [stage];
    if (spec2.controls?.length) {
      parts.push(el("div", "pg__controls", spec2.controls.map((c) => control(c, state, draw))));
    }
    parts.push(code);
    slot.replaceChildren(el("div", "pg", parts));
    draw();
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
  toasted = (message) => {
    const note = $("helpers-toast");
    if (note) note.textContent = `api.ui.toast(${JSON.stringify(message)})`;
  };
  for (const [name, spec2] of Object.entries(KIT)) playground(name, spec2);
  for (const [name, spec2] of Object.entries(HELPERS)) playground(name, spec2);
  mountI18n();
  mountMarkdown();
  mountHighlight();
  mountRoles();
})();
