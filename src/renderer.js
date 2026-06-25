'use strict';

/* ===========================================================================
 * Limelist Workspace — renderer
 * Proportional vertical timeline of daily tasks with a live "now" indicator,
 * reminders, completion toggles, and per-day persistence.
 * ======================================================================== */

const PX_PER_HOUR = 72;        // must match --hour in styles.css
const MINUTES_PER_DAY = 24 * 60;
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

// --- Date / time helpers ----------------------------------------------------
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  if (hour === 24) { h = 12; }
  return `${h} ${ampm}`;
}

function nowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
}

// --- Persistence ------------------------------------------------------------
async function persist() {
  try {
    await window.api.save(data);
  } catch (err) {
    console.error('Failed to save data', err);
  }
}

function tasksForCurrentDay() {
  return data[dateKey(currentDate)] || [];
}

function setTasksForCurrentDay(tasks) {
  data[dateKey(currentDate)] = tasks;
}

// --- Overlap layout ---------------------------------------------------------
// Assigns each task a column so overlapping tasks sit side by side instead of
// stacking on top of each other. Returns { columns, totalColumns } per cluster.
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
    empty.textContent = 'No tasks yet. Add one on the left to start your timeline.';
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

    block.addEventListener('click', () => startEdit(task.id));
    layer.appendChild(block);
  }
}

function renderNowLine() {
  // Remove any previous now-line so we don't stack them.
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
  const tasks = tasksForCurrentDay();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.done = !task.done;
  persist();
  render();
}

function deleteTask(id) {
  setTasksForCurrentDay(tasksForCurrentDay().filter((t) => t.id !== id));
  persist();
  resetForm();
  render();
}

// --- Editor / form ----------------------------------------------------------
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

function resetForm() {
  editingId = null;
  form.reset();
  selectedColor = PALETTE[3];
  buildSwatches();
  el('editorTitle').textContent = 'New task';
  el('submitBtn').textContent = 'Add task';
  el('cancelEdit').classList.add('hidden');
  el('formError').textContent = '';
  // Drop any delete button left over from edit mode.
  const del = el('deleteBtn');
  if (del) del.remove();
}

function startEdit(id) {
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
  el('cancelEdit').classList.remove('hidden');

  if (!el('deleteBtn')) {
    const del = document.createElement('button');
    del.id = 'deleteBtn';
    del.type = 'button';
    del.className = 'ghost-btn';
    del.textContent = 'Delete';
    del.style.color = 'var(--danger)';
    del.addEventListener('click', () => deleteTask(id));
    el('cancelEdit').after(del);
  }
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
      // Times changed -> allow the reminder to fire again.
      if (task.start !== start) task.notified = false;
      Object.assign(task, { name, start, end, color: selectedColor });
    }
  } else {
    tasks.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name, start, end, color: selectedColor,
      done: false, notified: false,
    });
  }
  setTasksForCurrentDay(tasks);
  persist();
  resetForm();
  render();
}

// --- Navigation -------------------------------------------------------------
function shiftDay(delta) {
  currentDate.setDate(currentDate.getDate() + delta);
  currentDate = new Date(currentDate);
  resetForm();
  render();
  maybeScrollToNow();
}

function goToday() {
  currentDate = new Date();
  resetForm();
  render();
  maybeScrollToNow();
}

function maybeScrollToNow() {
  if (!isSameDay(currentDate, new Date())) return;
  const target = (nowMinutes() / 60) * PX_PER_HOUR - timelineWrap.clientHeight / 2;
  timelineWrap.scrollTop = Math.max(0, target);
}

// --- Reminders --------------------------------------------------------------
// Fires a native notification when a task's start time arrives. Runs only for
// "today"; marks tasks notified so each reminder fires at most once.
function checkReminders() {
  if (!isSameDay(currentDate, new Date())) {
    // Still need to check today's tasks even if viewing another day.
  }
  const todayTasks = data[dateKey(new Date())] || [];
  const mins = nowMinutes();
  let changed = false;

  for (const task of todayTasks) {
    if (task.notified || task.done) continue;
    const start = toMinutes(task.start);
    if (mins >= start) {
      // Only actually pop a notification if we're within ~90s of the start,
      // so reopening the app later doesn't replay every past reminder.
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

// --- Ticking ----------------------------------------------------------------
function tick() {
  renderNowLine();
  checkReminders();
}

// --- Boot -------------------------------------------------------------------
async function init() {
  data = (await window.api.load()) || {};

  // Default the new-task times to a sensible "next hour" block.
  const n = new Date();
  const startH = String(n.getHours()).padStart(2, '0');
  const endH = String((n.getHours() + 1) % 24).padStart(2, '0');
  el('startTime').value = `${startH}:00`;
  el('endTime').value = `${endH}:00`;

  buildSwatches();
  render();
  maybeScrollToNow();

  form.addEventListener('submit', handleSubmit);
  el('cancelEdit').addEventListener('click', resetForm);
  el('prevDay').addEventListener('click', () => shiftDay(-1));
  el('nextDay').addEventListener('click', () => shiftDay(1));
  el('todayBtn').addEventListener('click', goToday);

  // Update the now-line + check reminders every 15 seconds.
  setInterval(tick, 15000);
}

init();
