'use strict';

/* ===========================================================================
 * Limelist Workspace — renderer
 * Proportional vertical timeline of daily tasks with a live "now" indicator,
 * reminders, a popover editor, 1-week retention, and cross-day import/duplicate.
 * ======================================================================== */

const PX_PER_HOUR = 72;        // must match --hour in styles.css
const RETENTION_DAYS = 7;      // keep today + previous 6 days; older is pruned
const PALETTE = [
  '#ff6b6b', '#ff922b', '#fcc419', '#c6f135',
  '#51cf66', '#22b8cf', '#4dabf7', '#845ef7', '#f06595',
];

// --- State ------------------------------------------------------------------
let data = {};                 // { 'YYYY-MM-DD': [task, ...] }
let currentDate = new Date();  // the day being viewed
let editingId = null;          // task id currently being edited, or null
let selectedColor = PALETTE[3];

// --- DOM refs ---------------------------------------------------------------
const el = (id) => document.getElementById(id);
const timeline = el('timeline');
const timelineWrap = el('timelineWrap');
const form = el('taskForm');
const taskOverlay = el('taskOverlay');
const importOverlay = el('importOverlay');

// --- Date / time helpers ----------------------------------------------------
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// "13:45" -> minutes from midnight
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// minutes from midnight -> "1:45 PM"
function formatClock(minutes) {
  let h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatHourLabel(hour) {
  const ampm = hour >= 12 && hour < 24 ? 'PM' : 'AM';
  let h = hour % 12 || 12;
  if (hour === 24) h = 12;
  return `${h} ${ampm}`;
}

function nowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Fresh copy of a task for another day: new id, not done, reminder re-armed.
function cloneTask(t) {
  return {
    id: newId(),
    name: t.name, start: t.start, end: t.end, color: t.color,
    done: false, notified: false,
  };
}

// --- Persistence + retention -----------------------------------------------
async function persist() {
  try {
    await window.api.save(data);
  } catch (err) {
    console.error('Failed to save data', err);
  }
}

// Drop any day older than the retention window. Date-string keys sort
// lexicographically the same as chronologically, so a string compare is safe.
function pruneOldData() {
  const cutoff = dateKey(addDays(new Date(), -(RETENTION_DAYS - 1)));
  let changed = false;
  for (const key of Object.keys(data)) {
    if (key < cutoff) {
      delete data[key];
      changed = true;
    }
  }
  if (changed) persist();
}

function tasksForCurrentDay() {
  return data[dateKey(currentDate)] || [];
}

function setTasksForCurrentDay(tasks) {
  data[dateKey(currentDate)] = tasks;
}

// --- Overlap layout ---------------------------------------------------------
// Assigns each task a column so overlapping tasks sit side by side instead of
// stacking on top of each other.
function layoutTasks(tasks) {
  const sorted = [...tasks].sort(
    (a, b) => toMinutes(a.start) - toMinutes(b.start) || toMinutes(a.end) - toMinutes(b.end),
  );

  const placements = new Map(); // id -> { col, cols }
  let cluster = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const colEnds = []; // last end-minute per column
    for (const t of cluster) {
      const s = toMinutes(t.start);
      let col = colEnds.findIndex((end) => end <= s);
      if (col === -1) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = toMinutes(t.end);
      placements.set(t.id, { col, cols: 1 });
    }
    const total = colEnds.length;
    for (const t of cluster) placements.get(t.id).cols = total;
    cluster = [];
    clusterEnd = -1;
  };

  for (const t of sorted) {
    const s = toMinutes(t.start);
    if (cluster.length && s >= clusterEnd) flush();
    cluster.push(t);
    clusterEnd = Math.max(clusterEnd, toMinutes(t.end));
  }
  flush();

  return placements;
}

// --- Rendering --------------------------------------------------------------
function render() {
  renderHeader();
  renderTimeline();
  renderNowLine();
  renderStats();
}

function renderHeader() {
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  let label = currentDate.toLocaleDateString(undefined, opts);
  if (isSameDay(currentDate, new Date())) label += '  ·  Today';
  el('dateLabel').textContent = label;
}

function renderStats() {
  const tasks = tasksForCurrentDay();
  const done = tasks.filter((t) => t.done).length;
  el('stats').innerHTML =
    `<span class="stat-pill"><strong>${tasks.length}</strong> tasks</span>` +
    `<span class="stat-pill done"><strong>${done}</strong> done</span>`;
}

function renderTimeline() {
  timeline.style.height = `${PX_PER_HOUR * 24}px`;
  timeline.innerHTML = '';

  // Hour grid lines + labels
  for (let h = 0; h <= 24; h++) {
    const line = document.createElement('div');
    line.className = 'hour-line' + (h % 6 === 0 ? ' major' : '');
    line.style.top = `${h * PX_PER_HOUR}px`;
    if (h < 24) {
      const lbl = document.createElement('span');
      lbl.className = 'hour-label';
      lbl.textContent = formatHourLabel(h);
      line.appendChild(lbl);
    }
    timeline.appendChild(line);
  }

  // Task layer
  const layer = document.createElement('div');
  layer.className = 'task-layer';
  timeline.appendChild(layer);

  const tasks = tasksForCurrentDay();
  if (!tasks.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = 'No tasks yet.<br>Tap the <strong>+</strong> button to add one, or “Import day” to reuse another day.';
    layer.appendChild(empty);
    return;
  }

  const placements = layoutTasks(tasks);

  for (const task of tasks) {
    const start = toMinutes(task.start);
    const end = toMinutes(task.end);
    const duration = Math.max(end - start, 15); // floor so tiny tasks stay tappable
    const { col, cols } = placements.get(task.id) || { col: 0, cols: 1 };

    const block = document.createElement('div');
    block.className = 'task-block' + (task.done ? ' done' : '');
    if (duration <= 30) block.classList.add('compact');

    block.style.top = `${(start / 60) * PX_PER_HOUR}px`;
    block.style.height = `${(duration / 60) * PX_PER_HOUR - 4}px`;
    block.style.width = `calc(${100 / cols}% - 6px)`;
    block.style.left = `calc(${(100 / cols) * col}% + 3px)`;
    block.style.background =
      `linear-gradient(135deg, ${task.color} 0%, ${shade(task.color, -16)} 100%)`;

    const head = document.createElement('div');
    head.className = 'tb-head';

    const check = document.createElement('button');
    check.className = 'tb-check';
    check.type = 'button';
    check.title = task.done ? 'Mark as not done' : 'Mark as done';
    check.textContent = task.done ? '✓' : '';
    check.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDone(task.id);
    });

    const name = document.createElement('div');
    name.className = 'tb-name';
    name.textContent = task.name;

    head.appendChild(check);
    head.appendChild(name);
    block.appendChild(head);

    const time = document.createElement('div');
    time.className = 'tb-time';
    time.textContent = `${formatClock(start)} – ${formatClock(end)}`;
    block.appendChild(time);

    block.addEventListener('click', () => openEditModal(task.id));
    layer.appendChild(block);
  }
}

function renderNowLine() {
  const old = timeline.querySelector('.now-line');
  if (old) old.remove();
  if (!isSameDay(currentDate, new Date())) return;

  const mins = nowMinutes();
  const line = document.createElement('div');
  line.className = 'now-line';
  line.style.top = `${(mins / 60) * PX_PER_HOUR}px`;
  line.innerHTML =
    `<div class="now-dot"></div>` +
    `<div class="now-label">${formatClock(Math.floor(mins))}</div>`;
  timeline.appendChild(line);
}

// Darken/lighten a hex color by percent (negative = darker).
function shade(hex, percent) {
  const n = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// --- Mutations --------------------------------------------------------------
function toggleDone(id) {
  const task = tasksForCurrentDay().find((t) => t.id === id);
  if (!task) return;
  task.done = !task.done;
  persist();
  render();
}

function deleteTask(id) {
  setTasksForCurrentDay(tasksForCurrentDay().filter((t) => t.id !== id));
  persist();
  closeModal(taskOverlay);
  render();
}

// --- Modal plumbing ---------------------------------------------------------
function openModal(overlay) { overlay.classList.remove('hidden'); }
function closeModal(overlay) { overlay.classList.add('hidden'); }
function anyModalOpen() {
  return !taskOverlay.classList.contains('hidden') || !importOverlay.classList.contains('hidden');
}

// --- Editor (popover) -------------------------------------------------------
function buildSwatches() {
  const wrap = el('swatches');
  wrap.innerHTML = '';
  for (const color of PALETTE) {
    const s = document.createElement('div');
    s.className = 'swatch' + (color === selectedColor ? ' selected' : '');
    s.style.background = color;
    s.title = color;
    s.addEventListener('click', () => {
      selectedColor = color;
      buildSwatches();
    });
    wrap.appendChild(s);
  }
}

function defaultTimes() {
  const n = new Date();
  return {
    start: `${String(n.getHours()).padStart(2, '0')}:00`,
    end: `${String((n.getHours() + 1) % 24).padStart(2, '0')}:00`,
  };
}

function openAddModal() {
  editingId = null;
  form.reset();
  selectedColor = PALETTE[3];
  buildSwatches();
  const t = defaultTimes();
  el('startTime').value = t.start;
  el('endTime').value = t.end;
  el('editorTitle').textContent = 'New task';
  el('submitBtn').textContent = 'Add task';
  el('deleteBtn').classList.add('hidden');
  el('dupRow').classList.add('hidden');
  el('formError').textContent = '';
  openModal(taskOverlay);
  el('taskName').focus();
}

function openEditModal(id) {
  const task = tasksForCurrentDay().find((t) => t.id === id);
  if (!task) return;
  editingId = id;
  el('taskName').value = task.name;
  el('startTime').value = task.start;
  el('endTime').value = task.end;
  selectedColor = task.color;
  buildSwatches();

  el('editorTitle').textContent = 'Edit task';
  el('submitBtn').textContent = 'Save changes';
  el('deleteBtn').classList.remove('hidden');
  el('dupRow').classList.remove('hidden');
  el('dupDate').value = dateKey(addDays(currentDate, 1)); // default: next day
  el('formError').textContent = '';
  openModal(taskOverlay);
  el('taskName').focus();
}

function handleSubmit(e) {
  e.preventDefault();
  const name = el('taskName').value.trim();
  const start = el('startTime').value;
  const end = el('endTime').value;
  const err = el('formError');

  if (!name || !start || !end) {
    err.textContent = 'Please fill in the task name and both times.';
    return;
  }
  if (toMinutes(end) <= toMinutes(start)) {
    err.textContent = 'End time must be after the start time.';
    return;
  }
  err.textContent = '';

  const tasks = tasksForCurrentDay();
  if (editingId) {
    const task = tasks.find((t) => t.id === editingId);
    if (task) {
      if (task.start !== start) task.notified = false; // re-arm reminder
      Object.assign(task, { name, start, end, color: selectedColor });
    }
  } else {
    tasks.push({
      id: newId(), name, start, end, color: selectedColor,
      done: false, notified: false,
    });
  }
  setTasksForCurrentDay(tasks);
  persist();
  closeModal(taskOverlay);
  render();
}

// Duplicate the task being edited into another day, then jump there to show it.
function duplicateCurrentTask() {
  if (!editingId) return;
  const task = tasksForCurrentDay().find((t) => t.id === editingId);
  if (!task) return;
  const targetKey = el('dupDate').value;
  if (!targetKey) {
    el('formError').textContent = 'Pick a date to duplicate to.';
    return;
  }
  (data[targetKey] = data[targetKey] || []).push(cloneTask(task));
  persist();
  closeModal(taskOverlay);
  currentDate = parseDateKey(targetKey);
  render();
  maybeScrollToNow();
}

// --- Import (popover) -------------------------------------------------------
function openImportModal() {
  const sel = el('importSource');
  const err = el('importError');
  sel.innerHTML = '';
  err.textContent = '';

  const curKey = dateKey(currentDate);
  const keys = Object.keys(data)
    .filter((k) => k !== curKey && (data[k] || []).length > 0)
    .sort()
    .reverse();

  if (!keys.length) {
    err.textContent = 'No other days with tasks to import from yet.';
    el('importConfirm').disabled = true;
  } else {
    el('importConfirm').disabled = false;
    for (const k of keys) {
      const d = parseDateKey(k);
      const opt = document.createElement('option');
      opt.value = k;
      const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      opt.textContent = `${label} · ${data[k].length} task${data[k].length > 1 ? 's' : ''}`;
      sel.appendChild(opt);
    }
  }
  openModal(importOverlay);
}

function doImport() {
  const src = el('importSource').value;
  if (!src || !data[src]) return;
  const mode = el('importMode').value;
  const clones = data[src].map(cloneTask);

  if (mode === 'replace') {
    setTasksForCurrentDay(clones);
  } else {
    setTasksForCurrentDay([...tasksForCurrentDay(), ...clones]);
  }
  persist();
  closeModal(importOverlay);
  render();
}

// --- Navigation -------------------------------------------------------------
function shiftDay(delta) {
  currentDate = addDays(currentDate, delta);
  render();
  maybeScrollToNow();
}

function goToday() {
  currentDate = new Date();
  render();
  maybeScrollToNow();
}

function maybeScrollToNow() {
  if (!isSameDay(currentDate, new Date())) return;
  const target = (nowMinutes() / 60) * PX_PER_HOUR - timelineWrap.clientHeight / 2;
  timelineWrap.scrollTop = Math.max(0, target);
}

// --- Reminders --------------------------------------------------------------
// Fires a native notification when a task's start time arrives. Always scans
// *today's* tasks regardless of which day is on screen.
function checkReminders() {
  const todayTasks = data[dateKey(new Date())] || [];
  const mins = nowMinutes();
  let changed = false;

  for (const task of todayTasks) {
    if (task.notified || task.done) continue;
    const start = toMinutes(task.start);
    if (mins >= start) {
      // Only pop within ~90s of start so reopening later doesn't replay old ones.
      if (mins - start <= 1.5) {
        window.api.notify('⏰ ' + task.name,
          `Starting now · ${formatClock(start)} – ${formatClock(toMinutes(task.end))}`);
      }
      task.notified = true;
      changed = true;
    }
  }
  if (changed) persist();
}

function tick() {
  renderNowLine();
  checkReminders();
}

// --- Boot -------------------------------------------------------------------
async function init() {
  data = (await window.api.load()) || {};
  pruneOldData();

  render();
  maybeScrollToNow();

  // Editor popover
  el('fab').addEventListener('click', openAddModal);
  form.addEventListener('submit', handleSubmit);
  el('taskClose').addEventListener('click', () => closeModal(taskOverlay));
  el('deleteBtn').addEventListener('click', () => { if (editingId) deleteTask(editingId); });
  el('dupBtn').addEventListener('click', duplicateCurrentTask);

  // Import popover
  el('importBtn').addEventListener('click', openImportModal);
  el('importConfirm').addEventListener('click', doImport);
  el('importCancel').addEventListener('click', () => closeModal(importOverlay));
  el('importClose').addEventListener('click', () => closeModal(importOverlay));

  // Click on a backdrop closes that modal.
  for (const overlay of [taskOverlay, importOverlay]) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay);
    });
  }
  // Esc closes whatever is open.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && anyModalOpen()) {
      closeModal(taskOverlay);
      closeModal(importOverlay);
    }
  });

  // Date navigation
  el('prevDay').addEventListener('click', () => shiftDay(-1));
  el('nextDay').addEventListener('click', () => shiftDay(1));
  el('todayBtn').addEventListener('click', goToday);

  // Update the now-line + check reminders every 15 seconds.
  setInterval(tick, 15000);
}

init();
