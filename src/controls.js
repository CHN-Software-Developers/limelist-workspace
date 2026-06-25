'use strict';

/* ===========================================================================
 * Limelist Workspace — custom form controls
 * Themed, OS-independent replacements for <select>, <input type="time"> and
 * <input type="date">, so the UI looks identical everywhere. Each factory
 * returns { element, getValue, setValue, ... }. Exposed as window.Controls.
 *
 * Dropdown menus & the calendar are appended to <body> with position:fixed so
 * they are never clipped by a scrolling modal.
 * ======================================================================== */

(function () {
  // --- small helpers --------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  const range = (from, to) => {
    const out = [];
    for (let i = from; i <= to; i++) out.push(i);
    return out;
  };
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  // Shared "close this floating layer when the user clicks away / scrolls".
  function attachDismiss(layer, trigger, close) {
    const onDoc = (e) => {
      if (!layer.contains(e.target) && !trigger.contains(e.target)) close();
    };
    // Close when an *ancestor* (the modal / page) scrolls, but NOT when the
    // user scrolls inside the dropdown menu itself.
    const onScroll = (e) => {
      if (!layer.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onDoc, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }

  // Position a fixed layer just below (or above) the trigger.
  function placeBelow(layer, trigger, fallbackHeight) {
    const r = trigger.getBoundingClientRect();
    layer.style.minWidth = `${r.width}px`;
    layer.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - layer.offsetWidth - 8))}px`;
    const h = layer.offsetHeight || fallbackHeight;
    const below = window.innerHeight - r.bottom;
    if (below < h + 8 && r.top > below) {
      layer.style.top = '';
      layer.style.bottom = `${window.innerHeight - r.top + 4}px`;
    } else {
      layer.style.bottom = '';
      layer.style.top = `${r.bottom + 4}px`;
    }
  }

  // --- Custom select --------------------------------------------------------
  function createSelect({ options = [], value = null, placeholder = 'Select', onChange } = {}) {
    const root = document.createElement('div');
    root.className = 'cselect';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cselect-trigger';
    const label = document.createElement('span');
    label.className = 'cselect-label';
    const caret = document.createElement('span');
    caret.className = 'cselect-caret';
    caret.textContent = '▾';
    trigger.append(label, caret);
    root.append(trigger);

    let opts = options.slice();
    let current = value;
    let menu = null;
    let detach = null;

    const labelFor = (v) => {
      const o = opts.find((o) => o.value === v);
      return o ? o.label : null;
    };
    function renderLabel() {
      const l = labelFor(current);
      label.textContent = l == null ? placeholder : l;
      label.classList.toggle('placeholder', l == null);
    }

    function close() {
      if (!menu) return;
      if (detach) detach();
      menu.remove();
      menu = null;
      trigger.classList.remove('open');
    }
    function open() {
      if (menu) { close(); return; }
      if (!opts.length) return;
      menu = document.createElement('div');
      menu.className = 'cmenu';
      for (const o of opts) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'cmenu-option' + (o.value === current ? ' selected' : '');
        item.textContent = o.label;
        item.addEventListener('click', () => {
          current = o.value;
          renderLabel();
          close();
          if (onChange) onChange(current);
        });
        menu.append(item);
      }
      document.body.append(menu);
      placeBelow(menu, trigger, 240);
      trigger.classList.add('open');
      detach = attachDismiss(menu, trigger, close);
      const sel = menu.querySelector('.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    trigger.addEventListener('click', open);
    renderLabel();

    return {
      element: root,
      getValue: () => current,
      setValue: (v) => { current = v; renderLabel(); },
      setOptions: (newOpts) => {
        opts = newOpts.slice();
        if (!opts.some((o) => o.value === current)) current = opts.length ? opts[0].value : null;
        renderLabel();
      },
    };
  }

  // --- Custom time picker (hour / minute / AM-PM) ---------------------------
  function createTimePicker({ value = '09:00', onChange } = {}) {
    const root = document.createElement('div');
    root.className = 'ctime';

    function emit() { if (onChange) onChange(getValue()); }

    const hour = createSelect({ options: range(1, 12).map((n) => ({ value: String(n), label: String(n) })), onChange: emit });
    const minute = createSelect({ options: range(0, 59).map((n) => ({ value: pad(n), label: pad(n) })), onChange: emit });
    const ampm = createSelect({ options: [{ value: 'AM', label: 'AM' }, { value: 'PM', label: 'PM' }], onChange: emit });
    ampm.element.classList.add('ampm');

    const colon = document.createElement('span');
    colon.className = 'ctime-colon';
    colon.textContent = ':';
    root.append(hour.element, colon, minute.element, ampm.element);

    function getValue() {
      let h = Number(hour.getValue()) % 12;
      if (ampm.getValue() === 'PM') h += 12;
      return `${pad(h)}:${minute.getValue()}`;
    }
    function setValue(v) {
      const [H, M] = v.split(':').map(Number);
      hour.setValue(String(H % 12 || 12));
      minute.setValue(pad(M));
      ampm.setValue(H >= 12 ? 'PM' : 'AM');
    }
    setValue(value);

    return { element: root, getValue, setValue };
  }

  // --- Custom date picker (calendar popover) --------------------------------
  function createDatePicker({ value, onChange } = {}) {
    const root = document.createElement('div');
    root.className = 'cselect cdate';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cselect-trigger cdate-trigger';
    const label = document.createElement('span');
    label.className = 'cselect-label';
    const icon = document.createElement('span');
    icon.className = 'cdate-icon';
    icon.textContent = '📅';
    trigger.append(label, icon);
    root.append(trigger);

    let current = value || keyOf(new Date());
    let viewDate = parseKey(current);
    let pop = null;
    let detach = null;

    function renderLabel() {
      label.textContent = parseKey(current).toLocaleDateString(undefined,
        { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }

    function navBtn(text) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-nav';
      b.textContent = text;
      return b;
    }

    function draw() {
      pop.innerHTML = '';

      const head = document.createElement('div');
      head.className = 'cal-head';
      const prev = navBtn('‹');
      const next = navBtn('›');
      const title = document.createElement('div');
      title.className = 'cal-title';
      title.textContent = viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      prev.addEventListener('click', (e) => { e.stopPropagation(); viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); draw(); });
      next.addEventListener('click', (e) => { e.stopPropagation(); viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); draw(); });
      head.append(prev, title, next);

      const week = document.createElement('div');
      week.className = 'cal-grid';
      for (const d of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) {
        const c = document.createElement('div');
        c.className = 'cal-wd';
        c.textContent = d;
        week.append(c);
      }

      const grid = document.createElement('div');
      grid.className = 'cal-grid';
      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      const startDow = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const todayKey = keyOf(new Date());
      for (let i = 0; i < startDow; i++) {
        const e = document.createElement('div');
        e.className = 'cal-cell empty';
        grid.append(e);
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const k = keyOf(new Date(y, m, day));
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cal-cell' + (k === current ? ' selected' : '') + (k === todayKey ? ' today' : '');
        b.textContent = day;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          current = k;
          renderLabel();
          close();
          if (onChange) onChange(current);
        });
        grid.append(b);
      }

      pop.append(head, week, grid);
    }

    function close() {
      if (!pop) return;
      if (detach) detach();
      pop.remove();
      pop = null;
      trigger.classList.remove('open');
    }
    function open() {
      if (pop) { close(); return; }
      viewDate = parseKey(current);
      pop = document.createElement('div');
      pop.className = 'calendar';
      document.body.append(pop);
      draw();
      placeBelow(pop, trigger, 320);
      trigger.classList.add('open');
      detach = attachDismiss(pop, trigger, close);
    }

    trigger.addEventListener('click', open);
    renderLabel();

    return {
      element: root,
      getValue: () => current,
      setValue: (v) => { current = v || keyOf(new Date()); renderLabel(); },
    };
  }

  window.Controls = { createSelect, createTimePicker, createDatePicker };
})();
