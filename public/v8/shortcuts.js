/* Version 8, use case 4: keyboard shortcuts with a help dialog (AI-assisted, see docs). */
(function (root) {
  'use strict';

  function isTyping(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function buildHelp(shortcuts) {
    const dialog = document.createElement('dialog');
    dialog.className = 'v8-help';
    dialog.setAttribute('aria-labelledby', 'v8-help-title');

    const title = document.createElement('h2');
    title.id = 'v8-help-title';
    title.textContent = 'Keyboard shortcuts';

    const list = document.createElement('dl');
    list.className = 'v8-help__list';
    const all = shortcuts.concat([{ key: '?', description: 'Show this list' }, { key: 'Esc', description: 'Close this list' }]);
    for (const s of all) {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const kbd = document.createElement('kbd');
      kbd.textContent = s.key.length === 1 ? s.key.toUpperCase() : s.key;
      dt.append(kbd);
      const dd = document.createElement('dd');
      dd.textContent = s.description;
      row.append(dt, dd);
      list.append(row);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'v8-btn';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());

    dialog.append(title, list, close);
    document.body.append(dialog);
    return dialog;
  }

  function init(shortcuts) {
    const help = buildHelp(shortcuts);

    function onKey(e) {
      if (e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target)) return;
      // Integration fix: while any dialog is open (edit task, API key, this
      // help list), the page behind it is inert, so shortcuts must not act on it.
      if (document.querySelector('dialog[open]')) return;
      if (e.key === '?') {
        e.preventDefault();
        if (!help.open) help.showModal();
        return;
      }
      const match = shortcuts.find((s) => s.key.toLowerCase() === e.key.toLowerCase());
      if (match) {
        e.preventDefault();
        match.run(e);
      }
    }

    document.addEventListener('keydown', onKey);
    return function destroy() {
      document.removeEventListener('keydown', onKey);
      help.remove();
    };
  }

  root.V8Shortcuts = { init };
})(self);
