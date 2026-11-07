/* ==========================================================================
   Eisenhower Matrix - app logic
   Plain JavaScript, no build step. Data lives in localStorage on this device.
   Tasks belong to one of several boards (matrices): "Work" and "Home" by default.
   ========================================================================== */
(function () {
  'use strict';

  // ---------- Constants ----------
  const STORAGE_KEY = 'eisenhower.tasks.v1';
  const BOARDS_KEY = 'eisenhower.boards.v1';
  const PREFS_KEY = 'eisenhower.prefs.v1';
  const MID = 50; // scores at or above this count as urgent / important
  const BOARD_NAME_MAX = 24;

  // The two default matrices. Names are editable; ids are stable so exports round-trip between devices.
  const DEFAULT_BOARDS = [
    { id: 'work', name: 'Work' },
    { id: 'home', name: 'Home' },
  ];

  const QUADRANTS = {
    do:        { name: 'Do',        hint: 'Urgent and important. Do it yourself, as soon as you can.' },
    schedule:  { name: 'Schedule',  hint: 'Important but not urgent. Block time for it on your calendar.' },
    delegate:  { name: 'Delegate',  hint: 'Urgent but not important. Hand it off if you can, or batch it.' },
    eliminate: { name: 'Eliminate', hint: 'Neither urgent nor important. Drop it, or park it for later.' },
  };
  const ORDER = ['do', 'schedule', 'delegate', 'eliminate'];

  const ICON_TRASH =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg>';
  const ICON_PENCIL =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

  // ---------- Small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function uid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISODate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayISO() { return toISODate(new Date()); }
  function offsetDate(days) { const d = new Date(); d.setDate(d.getDate() + days); return toISODate(d); }
  function parseISODate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

  function formatDue(iso, today) {
    const label = parseISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (iso < today) return { label: 'Overdue · ' + label, state: 'overdue' };
    if (iso === today) return { label: 'Due today', state: 'today' };
    return { label: 'Due ' + label, state: 'upcoming' };
  }

  function quadrantOf(t) {
    const urgent = t.urgency >= MID;
    const important = t.importance >= MID;
    if (urgent && important) return 'do';
    if (!urgent && important) return 'schedule';
    if (urgent && !important) return 'delegate';
    return 'eliminate';
  }

  // Tiny DOM builder. Children may be nodes or strings; strings become text nodes (never HTML).
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function loadJSON(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (err) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { console.warn('Could not save to localStorage', err); }
  }

  // ---------- Boards ----------
  function sanitizeBoard(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 40) : '';
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, BOARD_NAME_MAX) : '';
    return id && name ? { id, name } : null;
  }
  function loadBoards() {
    const raw = loadJSON(BOARDS_KEY, []);
    const saved = (Array.isArray(raw) ? raw : []).map(sanitizeBoard).filter(Boolean);
    // The default matrices always exist (saved names win); any extra saved boards follow them.
    const result = DEFAULT_BOARDS.map((d) => {
      const s = saved.find((b) => b.id === d.id);
      return { id: d.id, name: s ? s.name : d.name };
    });
    for (const b of saved) if (!result.some((r) => r.id === b.id)) result.push(b);
    return result;
  }
  function boardById(id) { return boards.find((b) => b.id === id); }
  function boardName(id) { const b = boardById(id); return b ? b.name : ''; }
  function activeBoard() { return boardById(activeBoardId) || boards[0]; }
  function saveBoards() { saveJSON(BOARDS_KEY, boards); }

  // ---------- Tasks ----------
  // Normalizes anything that claims to be a task (from storage or an import) into a safe shape.
  // Tasks without a known board (including those saved before boards existed) go to fallbackBoardId.
  function sanitizeTask(raw, fallbackBoardId) {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title == null ? '' : raw.title).trim().slice(0, 140);
    if (!title) return null;
    const score = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? clamp(Math.round(n), 0, 100) : fallback;
    };
    const done = Boolean(raw.done);
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      boardId: typeof raw.boardId === 'string' && boardById(raw.boardId) ? raw.boardId : fallbackBoardId,
      title,
      notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 2000) : '',
      urgency: score(raw.urgency, 50),
      importance: score(raw.importance, 50),
      due: /^\d{4}-\d{2}-\d{2}$/.test(raw.due || '') ? raw.due : '',
      done,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
      completedAt: done && typeof raw.completedAt === 'string' ? raw.completedAt : null,
    };
  }

  const SAMPLE_TASKS = {
    work: [
      { title: 'Fix the login bug customers reported', urgency: 88, importance: 85, due: offsetDate(0) },
      { title: 'Plan next quarter goals', urgency: 25, importance: 90 },
      { title: 'Read that book on negotiation', urgency: 12, importance: 60 },
      { title: 'Reply to vendor about invoice format', urgency: 80, importance: 32 },
      { title: 'Book the team lunch venue', urgency: 65, importance: 22, due: offsetDate(-1) },
      { title: 'Reorganize desktop icons', urgency: 15, importance: 12 },
    ],
    home: [
      { title: 'Submit tax paperwork', urgency: 72, importance: 78, due: offsetDate(2) },
      { title: 'Renew car insurance', urgency: 55, importance: 80, due: offsetDate(5) },
      { title: 'Weekly workout routine', urgency: 30, importance: 72 },
      { title: 'Plan the summer trip', urgency: 20, importance: 75 },
      { title: 'Fix the dripping kitchen tap', urgency: 70, importance: 40 },
      { title: 'Scroll through old group chats', urgency: 35, importance: 8 },
    ],
  };
  function samplesFor(boardId) { return SAMPLE_TASKS[boardId] || SAMPLE_TASKS.work; }

  // ---------- State ----------
  let boards = loadBoards();
  let tasks = loadTasks();
  let prefs = Object.assign({ labels: true, theme: 'auto', board: boards[0].id }, loadJSON(PREFS_KEY, {}));
  let activeBoardId = boardById(prefs.board) ? prefs.board : boards[0].id;
  let editingId = null;   // task being edited in the dialog; null means "new task"
  let selectedId = null;  // highlighted task (last added or tapped)
  let deferredInstall = null;

  function loadTasks() {
    const arr = loadJSON(STORAGE_KEY, []);
    if (!Array.isArray(arr)) return [];
    const list = arr.map((raw) => sanitizeTask(raw, boards[0].id)).filter(Boolean);
    // Write back once when anything was normalized, e.g. tasks saved before matrices existed.
    if (arr.some((raw) => !raw || typeof raw.boardId !== 'string')) saveJSON(STORAGE_KEY, list);
    return list;
  }
  function persist() { saveJSON(STORAGE_KEY, tasks); }
  function savePrefs() { saveJSON(PREFS_KEY, prefs); }
  function findTask(id) { return tasks.find((t) => t.id === id); }
  function visibleTasks() { return tasks.filter((t) => t.boardId === activeBoardId); }

  // Opening the app with ?demo shows sample tasks on every board without saving them (handy for screenshots).
  if (new URLSearchParams(location.search).has('demo') && tasks.length === 0) {
    const now = new Date().toISOString();
    for (const boardId of Object.keys(SAMPLE_TASKS)) {
      if (!boardById(boardId)) continue;
      for (const s of SAMPLE_TASKS[boardId]) tasks.push(sanitizeTask(Object.assign({}, s, { id: uid(), createdAt: now, boardId }), boardId));
    }
  }

  // ---------- Elements ----------
  const dom = {
    tabs: $('#tabs'),
    addForm: $('#addForm'),
    taskInput: $('#taskInput'),
    matrix: $('#matrix'),
    dots: $('#dots'),
    emptyHint: $('#emptyHint'),
    emptyTitle: $('#emptyTitle'),
    labelsToggle: $('#labelsToggle'),
    lists: $('#lists'),
    doneCard: $('#doneCard'),
    doneList: $('#doneList'),
    doneCount: $('#doneCount'),
    dialog: $('#taskDialog'),
    form: $('#taskForm'),
    dialogTitle: $('#dialogTitle'),
    dlgTitle: $('#dlgTitle'),
    dlgBoard: $('#dlgBoard'),
    dlgUrgency: $('#dlgUrgency'),
    dlgImportance: $('#dlgImportance'),
    urgencyOut: $('#urgencyOut'),
    importanceOut: $('#importanceOut'),
    preview: $('#preview'),
    miniDot: $('#miniDot'),
    previewQuad: $('#previewQuad'),
    previewHint: $('#previewHint'),
    moreFields: $('#moreFields'),
    dlgDue: $('#dlgDue'),
    dlgNotes: $('#dlgNotes'),
    dlgDelete: $('#dlgDelete'),
    dlgDone: $('#dlgDone'),
    dlgCancel: $('#dlgCancel'),
    themeToggle: $('#themeToggle'),
    menu: $('#menu'),
    installBtn: $('#installBtn'),
    exportBtn: $('#exportBtn'),
    importBtn: $('#importBtn'),
    importFile: $('#importFile'),
    samplesBtn: $('#samplesBtn'),
    clearDoneBtn: $('#clearDoneBtn'),
    aboutBtn: $('#aboutBtn'),
    aboutDialog: $('#aboutDialog'),
    aboutClose: $('#aboutClose'),
    toast: $('#toast'),
  };

  // ---------- Rendering ----------
  function render() {
    renderTabs();
    renderDots();
    renderLists();
    document.title = activeBoard().name + ' · Eisenhower Matrix';
  }

  function renderTabs() {
    const nodes = boards.map((b) => {
      const active = b.id === activeBoardId;
      const count = tasks.filter((t) => t.boardId === b.id && !t.done).length;
      const tab = el('button', {
        type: 'button',
        class: 'tab' + (active ? ' active' : ''),
        role: 'tab',
        'aria-selected': active ? 'true' : 'false',
        'data-id': b.id,
        title: active ? 'Click again to rename' : 'Switch to ' + b.name,
      },
      el('span', { class: 'tab-name', text: b.name }),
      el('span', { class: 'tab-count', text: String(count), 'aria-label': count + ' open' }));
      if (active) {
        const pen = el('span', { class: 'tab-edit', 'aria-hidden': 'true' });
        pen.innerHTML = ICON_PENCIL;
        tab.append(pen);
      }
      return tab;
    });
    dom.tabs.replaceChildren(...nodes);
  }

  // Dot position: urgent tasks sit on the left, important tasks on top (the classic layout).
  function positionDot(node, urgency, importance) {
    node.style.left = (100 - urgency) + '%';
    node.style.top = (100 - importance) + '%';
  }

  function renderDots() {
    const today = todayISO();
    const active = visibleTasks().filter((t) => !t.done);
    dom.emptyHint.hidden = active.length > 0;
    dom.emptyTitle.textContent = 'Nothing on ' + activeBoard().name + ' yet.';
    const nodes = active.map((t) => {
      const q = quadrantOf(t);
      const classes = ['dot', 'q-' + q];
      if (t.urgency < MID) classes.push('label-left'); // right half: label points back toward the center
      if (t.due && t.due < today) classes.push('overdue');
      if (t.id === selectedId) classes.push('selected');
      const dot = el('button', {
        type: 'button',
        class: classes.join(' '),
        'data-id': t.id,
        'aria-label': t.title + '. ' + QUADRANTS[q].name + '. Urgency ' + t.urgency + ', importance ' + t.importance +
          '. Press Enter to edit, or use the arrow keys to move it.',
      }, el('span', { class: 'dot-label', text: t.title }));
      positionDot(dot, t.urgency, t.importance);
      return dot;
    });
    dom.dots.replaceChildren(...nodes);
    dodgeLabels();
  }

  // Nudges overlapping labels apart vertically so dense clusters stay readable.
  function dodgeLabels() {
    if (!dom.matrix.classList.contains('show-labels')) return;
    const labels = Array.from(dom.dots.querySelectorAll('.dot-label'));
    for (const l of labels) l.style.removeProperty('--dy');
    if (labels.length < 2) return;
    const bounds = dom.matrix.getBoundingClientRect();
    const items = labels
      .map((l) => ({ el: l, rect: l.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    // Dots themselves are obstacles too, so a label never gets hidden under a neighboring dot.
    const placed = Array.from(dom.dots.querySelectorAll('.dot')).map((d) => {
      const r = d.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    for (const it of items) {
      const box = { left: it.rect.left, right: it.rect.right, top: it.rect.top, bottom: it.rect.bottom };
      let dy = 0;
      for (let guard = 0; guard < 12; guard++) {
        const hit = placed.find((p) => overlaps(box, p));
        if (!hit) break;
        let shift = hit.bottom - box.top + 2;                                   // slide below the label we hit
        if (box.bottom + shift > bounds.bottom - 4) shift = hit.top - box.bottom - 2; // no room below: go above
        dy += shift; box.top += shift; box.bottom += shift;
      }
      if (dy) it.el.style.setProperty('--dy', dy + 'px');
      placed.push(box);
    }
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(dodgeLabels, 120); });

  function renderLists() {
    const today = todayISO();
    const byQuadrant = { do: [], schedule: [], delegate: [], eliminate: [] };
    const done = [];
    for (const t of visibleTasks()) (t.done ? done : byQuadrant[quadrantOf(t)]).push(t);

    const score = (t) => t.urgency + t.importance;
    const compare = (a, b) =>
      score(b) - score(a) ||
      (a.due || '9999').localeCompare(b.due || '9999') ||
      a.createdAt.localeCompare(b.createdAt);

    for (const q of ORDER) {
      const card = dom.lists.querySelector('[data-quadrant="' + q + '"]');
      const items = byQuadrant[q].sort(compare);
      card.querySelector('[data-count]').textContent = items.length;
      card.querySelector('[data-list]').replaceChildren(...items.map((t) => taskRow(t, today)));
    }

    done.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
    dom.doneCount.textContent = done.length;
    dom.doneList.replaceChildren(...done.map((t) => taskRow(t, today)));
    dom.doneCard.hidden = done.length === 0;
  }

  function taskRow(t, today) {
    const q = quadrantOf(t);
    const classes = ['task', 'q-' + q];
    if (t.done) classes.push('done');
    if (t.id === selectedId) classes.push('selected');
    const row = el('li', { class: classes.join(' '), 'data-id': t.id });

    const check = el('input', { type: 'checkbox', 'aria-label': (t.done ? 'Restore: ' : 'Complete: ') + t.title });
    check.checked = t.done;
    check.addEventListener('change', () => (t.done ? restoreTask(t.id) : completeTask(t.id)));

    const titleBtn = el('button', { type: 'button', class: 'task-title', text: t.title, title: 'Open task' });
    titleBtn.addEventListener('click', () => openDialog(t.id));

    row.append(check, titleBtn);

    if (t.due && !t.done) {
      const d = formatDue(t.due, today);
      row.append(el('span', { class: 'chip ' + d.state, text: d.label }));
    }
    if (t.done) {
      const del = el('button', { type: 'button', class: 'mini-btn', 'aria-label': 'Delete permanently: ' + t.title, title: 'Delete' });
      del.innerHTML = ICON_TRASH;
      del.addEventListener('click', () => deleteTask(t.id));
      row.append(del);
    }
    return row;
  }

  function dotFor(id) {
    return dom.dots.querySelector('.dot[data-id="' + CSS.escape(id) + '"]');
  }
  function flash(id) {
    const dot = dotFor(id);
    if (!dot) return;
    dot.classList.add('pop');
    dot.addEventListener('animationend', () => dot.classList.remove('pop'), { once: true });
  }

  // ---------- Board switching and renaming ----------
  function switchBoard(id) {
    if (!boardById(id) || id === activeBoardId) return;
    activeBoardId = id;
    prefs.board = id;
    savePrefs();
    selectedId = null;
    render();
  }

  function tabFor(id) {
    return dom.tabs.querySelector('.tab[data-id="' + CSS.escape(id) + '"]');
  }

  function startRename(id) {
    const tab = tabFor(id);
    const board = boardById(id);
    if (!tab || !board) return;
    const input = el('input', { type: 'text', class: 'tab-input', maxlength: String(BOARD_NAME_MAX), 'aria-label': 'Rename this matrix', autocomplete: 'off' });
    input.value = board.name;
    tab.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim().slice(0, BOARD_NAME_MAX);
      if (save && name && name !== board.name) {
        board.name = name;
        saveBoards();
        showToast('Renamed to ' + name);
      }
      render();
      const fresh = tabFor(id);
      if (fresh) fresh.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  dom.tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    if (tab.dataset.id === activeBoardId) startRename(tab.dataset.id);
    else switchBoard(tab.dataset.id);
  });
  dom.tabs.addEventListener('keydown', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const idx = boards.findIndex((b) => b.id === tab.dataset.id);
    const next = boards[(idx + (e.key === 'ArrowRight' ? 1 : boards.length - 1)) % boards.length];
    switchBoard(next.id);
    const fresh = tabFor(next.id);
    if (fresh) fresh.focus();
  });

  // ---------- Task mutations ----------
  function addTask(data) {
    const t = sanitizeTask(Object.assign({}, data, { id: uid(), createdAt: new Date().toISOString(), done: false }), activeBoardId);
    if (!t) return null;
    tasks.push(t);
    selectedId = t.id;
    persist();
    render();
    flash(t.id);
    return t;
  }

  function updateTask(id, data) {
    const t = findTask(id);
    if (!t) return;
    const beforeQuadrant = quadrantOf(t);
    const beforeBoard = t.boardId;
    Object.assign(t, data);
    persist();
    render();
    if (t.boardId !== beforeBoard) showToast('Moved to ' + boardName(t.boardId));
    else if (quadrantOf(t) !== beforeQuadrant) showToast('Moved to ' + QUADRANTS[quadrantOf(t)].name);
  }

  function completeTask(id) {
    const t = findTask(id);
    if (!t) return;
    t.done = true;
    t.completedAt = new Date().toISOString();
    if (selectedId === id) selectedId = null;
    persist();
    render();
    showToast('Done: ' + t.title, { label: 'Undo', run: () => restoreTask(id) });
  }

  function restoreTask(id) {
    const t = findTask(id);
    if (!t) return;
    t.done = false;
    t.completedAt = null;
    selectedId = id;
    persist();
    render();
    flash(id);
  }

  function deleteTask(id) {
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const [t] = tasks.splice(idx, 1);
    if (selectedId === id) selectedId = null;
    persist();
    render();
    showToast('Deleted: ' + t.title, {
      label: 'Undo',
      run: () => { tasks.splice(Math.min(idx, tasks.length), 0, t); persist(); render(); flash(t.id); },
    });
  }

  // ---------- Prioritize / edit dialog ----------
  function openDialog(id, presetTitle) {
    const t = id ? findTask(id) : null;
    editingId = t ? t.id : null;
    dom.dialog.classList.toggle('mode-new', !t);
    dom.dialogTitle.textContent = t ? 'Edit task' : 'How should this be prioritized?';
    dom.dlgTitle.value = t ? t.title : (presetTitle || '');
    dom.dlgBoard.replaceChildren(...boards.map((b) => el('option', { value: b.id, text: b.name })));
    dom.dlgBoard.value = t ? t.boardId : activeBoardId;
    dom.dlgUrgency.value = t ? t.urgency : 50;
    dom.dlgImportance.value = t ? t.importance : 50;
    dom.dlgDue.value = t ? t.due : '';
    dom.dlgNotes.value = t ? t.notes : '';
    dom.moreFields.open = Boolean(t && (t.due || t.notes));
    dom.dlgDone.textContent = t && t.done ? 'Restore' : 'Mark done';
    updatePreview();
    if (t) { selectedId = t.id; render(); }
    dom.dialog.showModal();
    (t ? dom.dlgTitle : dom.dlgUrgency).focus();
  }

  function updatePreview() {
    const u = Number(dom.dlgUrgency.value);
    const i = Number(dom.dlgImportance.value);
    dom.urgencyOut.value = u;
    dom.importanceOut.value = i;
    const q = quadrantOf({ urgency: u, importance: i });
    // Keep the preview dot inside the mini matrix with a small inset.
    dom.miniDot.style.left = (8 + (100 - u) * 0.84) + '%';
    dom.miniDot.style.top = (8 + (100 - i) * 0.84) + '%';
    dom.preview.className = 'preview q-' + q;
    dom.previewQuad.textContent = QUADRANTS[q].name;
    dom.previewHint.textContent = QUADRANTS[q].hint;
  }

  dom.dlgUrgency.addEventListener('input', updatePreview);
  dom.dlgImportance.addEventListener('input', updatePreview);

  dom.form.addEventListener('submit', (e) => {
    e.preventDefault(); // method="dialog" would close immediately; we close after saving
    const title = dom.dlgTitle.value.trim();
    if (!title) { dom.dlgTitle.focus(); return; }
    const data = {
      title,
      boardId: boardById(dom.dlgBoard.value) ? dom.dlgBoard.value : activeBoardId,
      urgency: Number(dom.dlgUrgency.value),
      importance: Number(dom.dlgImportance.value),
      due: dom.dlgDue.value || '',
      notes: dom.dlgNotes.value.trim(),
    };
    if (editingId) {
      updateTask(editingId, data);
    } else {
      const t = addTask(data);
      dom.taskInput.value = '';
      if (t) {
        const where = QUADRANTS[quadrantOf(t)].name + (t.boardId === activeBoardId ? '' : ' on ' + boardName(t.boardId));
        showToast('Added to ' + where);
      }
    }
    dom.dialog.close();
  });

  dom.dlgCancel.addEventListener('click', () => dom.dialog.close());
  dom.dlgDelete.addEventListener('click', () => {
    const id = editingId;
    dom.dialog.close();
    if (id) deleteTask(id);
  });
  dom.dlgDone.addEventListener('click', () => {
    const t = editingId && findTask(editingId);
    dom.dialog.close();
    if (!t) return;
    if (t.done) restoreTask(t.id); else completeTask(t.id);
  });
  dom.dialog.addEventListener('close', () => {
    const wasNew = !editingId;
    editingId = null;
    if (wasNew) dom.taskInput.focus();
  });

  // ---------- Add form ----------
  dom.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = dom.taskInput.value.trim();
    if (!title) return;
    openDialog(null, title);
  });

  // ---------- Dot interaction: tap to open, drag to re-prioritize, arrows to nudge ----------
  let drag = null;
  let suppressClick = false;

  dom.dots.addEventListener('pointerdown', (e) => {
    const dot = e.target.closest('.dot');
    if (!dot) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: dot.dataset.id, el: dot, startX: e.clientX, startY: e.clientY, moved: false, pointerId: e.pointerId, urgency: null, importance: null };
    dot.setPointerCapture(e.pointerId);
  });

  dom.dots.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
      drag.moved = true;
      drag.el.classList.add('dragging');
    }
    const rect = dom.dots.getBoundingClientRect();
    const u = clamp(Math.round((1 - (e.clientX - rect.left) / rect.width) * 100), 0, 100);
    const i = clamp(Math.round((1 - (e.clientY - rect.top) / rect.height) * 100), 0, 100);
    drag.urgency = u;
    drag.importance = i;
    positionDot(drag.el, u, i);
    const q = quadrantOf({ urgency: u, importance: i });
    for (const key of ORDER) drag.el.classList.toggle('q-' + key, key === q);
    drag.el.classList.toggle('label-left', u < MID);
    e.preventDefault();
  });

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('dragging');
    try { d.el.releasePointerCapture(d.pointerId); } catch (err) { /* already released */ }
    if (!d.moved) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (!cancelled && d.urgency != null) {
      selectedId = d.id;
      updateTask(d.id, { urgency: d.urgency, importance: d.importance });
    } else {
      render();
    }
  }
  dom.dots.addEventListener('pointerup', (e) => endDrag(e, false));
  dom.dots.addEventListener('pointercancel', (e) => endDrag(e, true));

  dom.dots.addEventListener('click', (e) => {
    const dot = e.target.closest('.dot');
    if (!dot) return;
    if (suppressClick) { suppressClick = false; return; }
    openDialog(dot.dataset.id);
  });

  dom.dots.addEventListener('keydown', (e) => {
    const dot = e.target.closest('.dot');
    if (!dot) return;
    const step = e.shiftKey ? 10 : 5;
    const delta = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    const t = findTask(dot.dataset.id);
    if (!t) return;
    selectedId = t.id;
    updateTask(t.id, {
      urgency: clamp(t.urgency + delta[0], 0, 100),
      importance: clamp(t.importance + delta[1], 0, 100),
    });
    const fresh = dotFor(t.id);
    if (fresh) fresh.focus();
  });

  // ---------- Labels toggle ----------
  dom.labelsToggle.checked = prefs.labels !== false;
  dom.matrix.classList.toggle('show-labels', dom.labelsToggle.checked);
  dom.labelsToggle.addEventListener('change', () => {
    prefs.labels = dom.labelsToggle.checked;
    savePrefs();
    dom.matrix.classList.toggle('show-labels', prefs.labels);
    dodgeLabels();
  });

  // ---------- Theme ----------
  function applyTheme() {
    const root = document.documentElement;
    if (prefs.theme === 'light' || prefs.theme === 'dark') root.dataset.theme = prefs.theme;
    else delete root.dataset.theme;
  }
  function effectiveTheme() {
    return document.documentElement.dataset.theme ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function syncThemeColor() {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.removeAttribute('media'); m.setAttribute('content', bg); });
  }
  dom.themeToggle.addEventListener('click', () => {
    prefs.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    savePrefs();
    applyTheme();
    syncThemeColor();
  });
  applyTheme();
  if (prefs.theme === 'light' || prefs.theme === 'dark') syncThemeColor();

  // ---------- Menu ----------
  function closeMenu() { dom.menu.open = false; }
  document.addEventListener('click', (e) => {
    if (dom.menu.open && !dom.menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.menu.open) closeMenu();
  });

  dom.exportBtn.addEventListener('click', () => {
    closeMenu();
    const payload = { app: 'eisenhower-matrix', version: 2, exportedAt: new Date().toISOString(), boards, tasks };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'eisenhower-tasks-' + todayISO() + '.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Exported ' + tasks.length + (tasks.length === 1 ? ' task' : ' tasks') + ' from all matrices');
  });

  dom.importBtn.addEventListener('click', () => { closeMenu(); dom.importFile.click(); });
  dom.importFile.addEventListener('change', async () => {
    const file = dom.importFile.files && dom.importFile.files[0];
    dom.importFile.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.tasks) ? data.tasks : null);
      if (!list) throw new Error('No task list in file');
      // Tasks keep their matrix when it exists here; anything else lands on the matrix you are looking at.
      const incoming = list.map((raw) => sanitizeTask(raw, activeBoardId)).filter(Boolean);
      let added = 0, updated = 0;
      for (const t of incoming) {
        const idx = tasks.findIndex((x) => x.id === t.id);
        if (idx >= 0) { tasks[idx] = t; updated++; } else { tasks.push(t); added++; }
      }
      persist();
      render();
      showToast('Imported ' + added + ' new, ' + updated + ' updated');
    } catch (err) {
      showToast('Could not import that file. Expected a JSON export from this app.');
    }
  });

  dom.samplesBtn.addEventListener('click', () => {
    closeMenu();
    const now = new Date().toISOString();
    const samples = samplesFor(activeBoardId);
    for (const s of samples) tasks.push(sanitizeTask(Object.assign({}, s, { id: uid(), createdAt: now, boardId: activeBoardId }), activeBoardId));
    persist();
    render();
    showToast('Added ' + samples.length + ' sample tasks to ' + activeBoard().name);
  });

  dom.clearDoneBtn.addEventListener('click', () => {
    closeMenu();
    const done = visibleTasks().filter((t) => t.done);
    if (!done.length) { showToast('No completed tasks on ' + activeBoard().name); return; }
    tasks = tasks.filter((t) => !done.includes(t));
    persist();
    render();
    showToast('Cleared ' + done.length + ' completed', {
      label: 'Undo',
      run: () => { tasks.push(...done); persist(); render(); },
    });
  });

  dom.aboutBtn.addEventListener('click', () => { closeMenu(); dom.aboutDialog.showModal(); });
  dom.aboutClose.addEventListener('click', () => dom.aboutDialog.close());

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(message, action) {
    dom.toast.replaceChildren(el('span', { text: message }));
    if (action) {
      const btn = el('button', { type: 'button', text: action.label });
      btn.addEventListener('click', () => { hideToast(); action.run(); });
      dom.toast.append(btn);
    }
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 6000 : 2500);
  }
  function hideToast() { dom.toast.classList.remove('show'); }

  // ---------- Keyboard shortcut: "/" focuses the add box ----------
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || dom.dialog.open || dom.aboutDialog.open) return;
    e.preventDefault();
    dom.taskInput.focus();
  });

  // ---------- Cross-tab sync ----------
  window.addEventListener('storage', (e) => {
    if (e.key === BOARDS_KEY) boards = loadBoards();
    if (e.key === STORAGE_KEY || e.key === BOARDS_KEY) { tasks = loadTasks(); render(); }
  });

  // ---------- PWA: install prompt + service worker ----------
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    dom.installBtn.hidden = false;
  });
  dom.installBtn.addEventListener('click', async () => {
    closeMenu();
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (err) { /* dismissed */ }
    deferredInstall = null;
    dom.installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { dom.installBtn.hidden = true; showToast('Installed'); });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker registration failed', err));
    });
  }

  // ---------- Go ----------
  render();
})();
