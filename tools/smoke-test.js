// Smoke test: drives the app in a headless Edge/Chrome via the Chrome DevTools Protocol.
// No dependencies beyond Node 22+ (uses the built-in fetch and WebSocket).
//
//   node tools/smoke-test.js [app-url] [output-dir]
//
// Defaults: app-url = file URL of www/index.html, output-dir = tools/screenshots.
// Set BROWSER=<path to msedge.exe / chrome.exe> if the browser is not auto-detected.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CANDIDATES = [
  process.env.BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);
const BROWSER = CANDIDATES.find((p) => fs.existsSync(p));
if (!BROWSER) { console.error('No Edge/Chrome found. Set BROWSER=<path to the executable>.'); process.exit(2); }

const APP_URL = process.argv[2] || pathToFileURL(path.join(__dirname, '..', 'www', 'index.html')).href;
const OUT = process.argv[3] || path.join(__dirname, 'screenshots');
const PROFILE = path.join(OUT, 'profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const proc = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--remote-debugging-port=0', `--user-data-dir=${PROFILE}`, '--window-size=1280,900', 'about:blank',
  ]);
  const browserWs = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    proc.on('exit', () => reject(new Error('Browser exited early')));
    setTimeout(() => reject(new Error('Timed out waiting for DevTools')), 20000);
  });
  const port = new URL(browserWs).port;
  let pageWs = null;
  for (let i = 0; i < 20 && !pageWs; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) pageWs = page.webSocketDebuggerUrl; else await sleep(250);
  }
  if (!pageWs) throw new Error('No page target');

  const ws = new WebSocket(pageWs);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
    } else listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const waitEvent = (name) => new Promise((resolve) => {
    const l = (m) => { if (m.method === name) { listeners.splice(listeners.indexOf(l), 1); resolve(m.params); } };
    listeners.push(l);
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('Page threw: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const nav = async (url) => { const loaded = waitEvent('Page.loadEventFired'); await send('Page.navigate', { url }); await loaded; await sleep(250); };
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', clickCount: 1 }, extra));
  const stored = (expr) => evaluate(`(() => { const tasks = JSON.parse(localStorage.getItem('eisenhower.tasks.v1') || '[]'); return ${expr}; })()`);
  const dots = () => evaluate(`document.querySelectorAll('.dot').length`);
  const count = (q) => evaluate(`document.querySelector('[data-quadrant="${q}"] [data-count]').textContent`);
  const activeTab = () => evaluate(`document.querySelector('.tab.active .tab-name').textContent`);
  const clickTab = (id) => evaluate(`document.querySelector('.tab[data-id="${id}"]').click()`);

  await send('Page.enable');
  await send('Runtime.enable');
  const errors = [];
  listeners.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
  });

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '   [' + detail + ']' : ''));
  };

  await nav(APP_URL);

  // 1. Empty state and the two default tabs
  check('starts empty with hint visible', await evaluate(`document.querySelectorAll('.dot').length === 0 && !document.getElementById('emptyHint').hidden`));
  check('two tabs, Work active', (await evaluate(`document.querySelectorAll('.tab').length`)) === 2 && (await activeTab()) === 'Work');

  // 2. Tasks saved before matrices existed show up on Work
  await evaluate(`localStorage.setItem('eisenhower.tasks.v1', JSON.stringify([{ id: 'legacy1', title: 'Old task from v1', urgency: 60, importance: 70, done: false, createdAt: '2026-01-01T00:00:00.000Z' }]))`);
  await nav(APP_URL);
  const legacyDots = await dots();
  const legacyBoard = await stored(`tasks[0] && tasks[0].boardId`);
  check('legacy task without a matrix migrates to Work', legacyDots === 1 && legacyBoard === 'work', `dots ${legacyDots}, stored boardId ${legacyBoard}`);
  await evaluate(`localStorage.removeItem('eisenhower.tasks.v1')`);
  await nav(APP_URL);

  // 3. Add flow: type a task -> dialog asks for priority
  await evaluate(`(() => { document.getElementById('taskInput').value = 'Call the dentist'; document.getElementById('addForm').requestSubmit(); })()`);
  check('submitting the add box opens the prioritize dialog', await evaluate(`document.getElementById('taskDialog').open && document.getElementById('dlgTitle').value === 'Call the dentist'`));
  check('dialog defaults to the current matrix', (await evaluate(`document.getElementById('dlgBoard').value`)) === 'work');
  await evaluate(`(() => { const u = document.getElementById('dlgUrgency'), i = document.getElementById('dlgImportance');
    u.value = 82; u.dispatchEvent(new Event('input')); i.value = 74; i.dispatchEvent(new Event('input')); })()`);
  check('live preview names the quadrant', (await evaluate(`document.getElementById('previewQuad').textContent`)) === 'Do');
  await shot('1-dialog.png');
  await evaluate(`document.getElementById('taskForm').requestSubmit()`);
  await sleep(150);
  check('save closes dialog and plots one dot', await evaluate(`!document.getElementById('taskDialog').open`) && (await dots()) === 1);
  const style = await evaluate(`(() => { const d = document.querySelector('.dot'); return d.style.left + ' ' + d.style.top + ' ' + d.className; })()`);
  check('dot sits at 18% / 26% in the Do quadrant', style.startsWith('18% 26%') && style.includes('q-do'), style);
  check('Do list count is 1', (await count('do')) === '1');
  check('task saved to localStorage on Work', (await stored('tasks.length')) === 1 && (await stored(`tasks[0].boardId`)) === 'work');
  check('add box cleared after save', (await evaluate(`document.getElementById('taskInput').value`)) === '');

  // 4. Second task straight into Eliminate
  await evaluate(`(() => { document.getElementById('taskInput').value = 'Sort old photos'; document.getElementById('addForm').requestSubmit();
    const u = document.getElementById('dlgUrgency'), i = document.getElementById('dlgImportance');
    u.value = 20; u.dispatchEvent(new Event('input')); i.value = 15; i.dispatchEvent(new Event('input'));
    document.getElementById('taskForm').requestSubmit(); })()`);
  await sleep(150);
  check('second task lands in Eliminate', (await count('eliminate')) === '1');

  // 5. Drag the Do dot into the Schedule quadrant with real mouse events
  const g = await evaluate(`(() => { const d = document.querySelector('.dot.q-do'); const r = d.getBoundingClientRect(); const m = document.getElementById('dots').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, tx: m.left + m.width * 0.8, ty: m.top + m.height * 0.15 }; })()`);
  await mouse('mousePressed', g.x, g.y);
  for (let s = 1; s <= 12; s++) await mouse('mouseMoved', g.x + (g.tx - g.x) * s / 12, g.y + (g.ty - g.y) * s / 12, { buttons: 1 });
  await mouse('mouseReleased', g.tx, g.ty);
  await sleep(200);
  const afterDrag = await stored(`tasks.find(t => t.title === 'Call the dentist')`);
  check('drag re-prioritizes into Schedule without opening the dialog',
    afterDrag.urgency === 20 && afterDrag.importance === 85 && !(await evaluate(`document.getElementById('taskDialog').open`)) && (await count('schedule')) === '1',
    `urgency ${afterDrag.urgency}, importance ${afterDrag.importance}`);
  check('quadrant-change toast shown', await evaluate(`document.getElementById('toast').classList.contains('show') && document.getElementById('toast').textContent.includes('Schedule')`));

  // 6. A plain click (no movement) opens the edit dialog
  const c = await evaluate(`(() => { const r = document.querySelector('.dot.q-schedule').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await mouse('mousePressed', c.x, c.y);
  await mouse('mouseReleased', c.x, c.y);
  await sleep(150);
  check('clicking a dot opens it for editing', await evaluate(`document.getElementById('taskDialog').open && document.getElementById('dialogTitle').textContent === 'Edit task' && document.getElementById('dlgTitle').value === 'Call the dentist'`));
  await evaluate(`document.getElementById('dlgCancel').click()`);
  await sleep(50);

  // 7. Keyboard nudge
  await evaluate(`(() => { const d = document.querySelector('.dot.q-schedule'); d.focus(); d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); })()`);
  const nudged = await stored(`tasks.find(t => t.title === 'Call the dentist').urgency`);
  check('arrow key nudges urgency by 5', nudged === 25, 'urgency now ' + nudged);
  check('focus stays on the moved dot', await evaluate(`document.activeElement && document.activeElement.classList.contains('dot')`));

  // 8. Complete via checkbox, then undo from the toast
  await evaluate(`document.querySelector('[data-quadrant="eliminate"] .task input[type=checkbox]').click()`);
  await sleep(150);
  check('completing a task moves it to Completed and removes its dot', (await evaluate(`document.getElementById('doneCount').textContent === '1' && !document.getElementById('doneCard').hidden`)) && (await dots()) === 1);
  await evaluate(`document.querySelector('#toast button').click()`);
  await sleep(100);
  check('undo restores it', (await evaluate(`document.getElementById('doneCount').textContent`)) === '0' && (await dots()) === 2);

  // 9. Delete from the dialog, then undo
  await evaluate(`(() => { document.querySelector('[data-quadrant="eliminate"] .task-title').click(); document.getElementById('dlgDelete').click(); })()`);
  await sleep(100);
  check('delete from dialog removes the task', (await stored('tasks.length')) === 1 && !(await evaluate(`document.getElementById('taskDialog').open`)));
  await evaluate(`document.querySelector('#toast button').click()`);
  await sleep(100);
  check('undo brings it back', (await stored('tasks.length')) === 2);

  // 10. Persistence across reload
  await nav(APP_URL);
  check('tasks persist after reload', (await dots()) === 2);

  // 11. Second matrix: switch, add, rename, move between matrices
  await clickTab('home');
  await sleep(50);
  check('switching to Home shows an empty matrix', (await activeTab()) === 'Home' && (await dots()) === 0 &&
    (await evaluate(`document.getElementById('emptyTitle').textContent`)) === 'Nothing on Home yet.');
  await evaluate(`(() => { document.getElementById('taskInput').value = 'Water the plants'; document.getElementById('addForm').requestSubmit();
    const u = document.getElementById('dlgUrgency'), i = document.getElementById('dlgImportance');
    u.value = 30; u.dispatchEvent(new Event('input')); i.value = 40; i.dispatchEvent(new Event('input'));
    document.getElementById('taskForm').requestSubmit(); })()`);
  await sleep(150);
  check('task added on Home stays off Work', (await dots()) === 1 && (await stored(`tasks.find(t => t.title === 'Water the plants').boardId`)) === 'home');
  check('tab badges show open counts per matrix',
    (await evaluate(`document.querySelector('.tab[data-id="work"] .tab-count').textContent`)) === '2' &&
    (await evaluate(`document.querySelector('.tab[data-id="home"] .tab-count').textContent`)) === '1');

  await clickTab('home'); // clicking the active tab starts a rename
  await sleep(50);
  check('clicking the active tab opens an inline rename box', (await evaluate(`(document.querySelector('.tab-input') || {}).value`)) === 'Home');
  await evaluate(`(() => { const i = document.querySelector('.tab-input'); i.value = 'Family'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(50);
  check('Enter saves the new tab name', (await activeTab()) === 'Family');
  await nav(APP_URL);
  check('tab name and selected matrix persist after reload', (await activeTab()) === 'Family' && (await evaluate(`document.title`)).startsWith('Family') && (await dots()) === 1);

  await clickTab('home');
  await sleep(50);
  await evaluate(`(() => { const i = document.querySelector('.tab-input'); i.value = 'Should not stick'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
  await sleep(50);
  check('Escape cancels a rename', (await activeTab()) === 'Family');

  await evaluate(`document.querySelector('[data-quadrant="eliminate"] .task-title').click()`);
  await sleep(50);
  check('edit dialog lists both matrices with the current one selected',
    (await evaluate(`Array.from(document.getElementById('dlgBoard').options).map(o => o.textContent).join(',')`)) === 'Work,Family' &&
    (await evaluate(`document.getElementById('dlgBoard').value`)) === 'home');
  await evaluate(`(() => { document.getElementById('dlgBoard').value = 'work'; document.getElementById('taskForm').requestSubmit(); })()`);
  await sleep(150);
  check('changing the Matrix field moves the task to Work', (await dots()) === 0 &&
    (await stored(`tasks.find(t => t.title === 'Water the plants').boardId`)) === 'work' &&
    (await evaluate(`document.getElementById('toast').textContent`)).includes('Moved to Work'));

  await evaluate(`(() => { const t = document.querySelector('.tab.active'); t.focus(); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); })()`);
  await sleep(50);
  check('arrow keys switch tabs', (await activeTab()) === 'Work' && (await dots()) === 3);

  // 12. Theme toggle + light-mode screenshot with sample data
  await evaluate(`document.getElementById('themeToggle').click()`);
  const theme = await evaluate(`document.documentElement.dataset.theme`);
  check('theme toggle overrides system theme', theme === 'light' || theme === 'dark', theme);
  if (theme === 'dark') await evaluate(`document.getElementById('themeToggle').click()`);
  await evaluate(`document.getElementById('samplesBtn').click()`);
  await sleep(100);
  check('sample tasks load onto the current matrix only', (await stored('tasks.length')) === 9 && (await stored(`tasks.filter(t => t.boardId === 'home').length`)) === 0);
  check('overdue sample gets the overdue ring and chip', await evaluate(`document.querySelectorAll('.dot.overdue').length >= 1 && document.querySelectorAll('.chip.overdue').length >= 1`));
  await evaluate(`document.getElementById('toast').classList.remove('show')`);
  await shot('2-desktop-light.png');
  await evaluate(`document.getElementById('themeToggle').click()`);
  await shot('3-desktop-dark.png');

  // 13. Export payload
  const exported = await evaluate(`(() => { let captured = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { captured = b; return 'blob:x'; };
    document.getElementById('exportBtn').click(); URL.createObjectURL = orig; return captured ? captured.text() : null; })()`);
  const parsed = exported ? JSON.parse(exported) : null;
  check('export produces a JSON file with all tasks and both matrices', !!parsed && parsed.app === 'eisenhower-matrix' && parsed.tasks.length === 9 && parsed.boards.length === 2 && parsed.boards[1].name === 'Family');

  // 14. Mobile layout
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await sleep(150);
  check('no horizontal overflow on a phone-width screen', await evaluate(`document.documentElement.scrollWidth <= 412`), 'scrollWidth ' + (await evaluate(`document.documentElement.scrollWidth`)));
  await evaluate(`document.getElementById('toast').classList.remove('show')`);
  await shot('4-mobile.png');
  await evaluate(`(() => { document.getElementById('taskInput').value = 'Renew passport'; document.getElementById('addForm').requestSubmit(); })()`);
  await sleep(150);
  await shot('5-mobile-dialog.png');
  await evaluate(`document.getElementById('dlgCancel').click()`);

  check('no console errors or uncaught exceptions', errors.length === 0, errors.join(' | '));

  ws.close();
  proc.kill();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
