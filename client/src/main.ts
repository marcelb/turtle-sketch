import { provider, undoManager, getName, setName, room, wsId, boardId, meta, getTitle, setTitle, MAX_TITLE } from './sync';
import { initBoard, setTool, deleteSelected, moveSelected, groupSelected, ungroupSelected, copySelected, pasteClipboard, downloadSvg, type Tool } from './board';

// navigation between the index (no hash), a workspace (#ws) and a board (#ws/board)
// goes through the hash, so reload on hashchange — this also makes the browser
// back/forward buttons work
window.addEventListener('hashchange', () => location.reload());

// build-time version from package.json (injected via vite define), shown bottom-right on
// both the board and the dashboard
const verEl = document.getElementById('version');
if (verEl) verEl.textContent = `v${__APP_VERSION__}`;
const dashVerEl = document.getElementById('dash-version');
if (dashVerEl) dashVerEl.textContent = `v${__APP_VERSION__}`;

if (room) initApp();
else if (wsId) initWorkspace(wsId);
else initIndex();

// ---------- whiteboard app (URL has a #room hash) ----------

function initApp(): void {
  initBoard();
  setTool('select');

  const titleEl = document.getElementById('title') as HTMLDivElement;
  const renderTitle = (): void => {
    const t = getTitle();
    titleEl.textContent = t;
    titleEl.title = `${t} — click to rename`;
    document.title = t;
  };
  meta.observe(() => renderTitle());
  renderTitle();
  titleEl.addEventListener('click', () => {
    if (document.getElementById('title-input')) return;
    const input = document.createElement('input');
    input.id = 'title-input';
    input.value = getTitle();
    input.maxLength = MAX_TITLE;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      if (save) setTitle(input.value);
      input.replaceWith(titleEl);
      renderTitle();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  });

  const nameInput = document.getElementById('name') as HTMLInputElement;
  nameInput.value = getName();
  nameInput.addEventListener('change', () => setName(nameInput.value.trim() || getName()));
  // Enter commits the new name and unfocuses the input
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setName(nameInput.value.trim() || getName());
      nameInput.blur();
    }
  });
  // clicking anywhere outside the inputs commits (via the change/blur events) and unfocuses;
  // needed because the canvas's pointerdown preventDefault() blocks the native focus change
  document.addEventListener('pointerdown', (e) => {
    if (e.target !== nameInput && document.activeElement === nameInput) nameInput.blur();
    const titleInput = document.getElementById('title-input');
    if (titleInput && e.target !== titleInput && document.activeElement === titleInput) (titleInput as HTMLInputElement).blur();
  });

  document.getElementById('dash-btn')!.addEventListener('click', () => {
    location.hash = wsId; // turtle button: back to the workspace page
  });
  document.getElementById('dl-btn')!.addEventListener('click', () => downloadSvg());

  const statusEl = document.getElementById('status') as HTMLSpanElement;
  provider?.on('status', ({ status }: { status: string }) => {
    statusEl.classList.toggle('on', status === 'connected');
    statusEl.title = status;
  });

  document.getElementById('roomlink')!.textContent = `link: ${location.origin}/#${wsId}/${boardId}`;

  document.querySelectorAll('#tools button[data-tool]').forEach((b) => {
    b.addEventListener('click', () => setTool((b as HTMLButtonElement).dataset.tool as Tool));
  });
  document.getElementById('undo')!.addEventListener('click', () => undoManager.undo());
  document.getElementById('redo')!.addEventListener('click', () => undoManager.redo());

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t.isContentEditable) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) undoManager.redo(); else undoManager.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'y') {
      e.preventDefault();
      undoManager.redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'g') {
      e.preventDefault();
      if (e.shiftKey) ungroupSelected(); else groupSelected();
      return;
    }
    // copy/paste of the shape selection (inside the text editor the native keys apply,
    // the guard above already returned for contenteditable targets)
    if ((e.ctrlKey || e.metaKey) && key === 'c') {
      e.preventDefault();
      copySelected();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'x') {
      e.preventDefault();
      copySelected();
      deleteSelected();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'v') {
      e.preventDefault();
      void pasteClipboard();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
      return;
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 10; // Shift = fine tune
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      moveSelected(dx, dy);
      return;
    }
    const tools: Record<string, Tool> = { v: 'select', h: 'hand', r: 'rect', e: 'ellipse', d: 'diamond', t: 'text', a: 'arrow', b: 'elbow', f: 'frame' };
    if (tools[key]) setTool(tools[key]);
  });
}

// ---------- dashboard screens ----------
// index (root URL, no hash): list of workspaces — #ws: list of boards in that workspace

const randId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

function showDashboard(): HTMLDivElement {
  const dash = document.getElementById('dashboard') as HTMLDivElement;
  dash.style.display = 'block';
  for (const id of ['tools', 'topright', 'hint', 'title', 'board']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
  return document.getElementById('dash-list') as HTMLDivElement;
}

async function createWorkspace(): Promise<void> {
  // no name prompt: creates an "Untitled_<id>" workspace (like a new board), rename inline
  const id = randId();
  await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  location.hash = id; // go inside the new workspace
}

// inline rename input replacing the given element (same pattern as the board title):
// Enter/blur commits, Escape cancels
function inlineRename(el: HTMLElement, value: string, onSave: (v: string) => void): void {
  if (document.querySelector('.rename-input')) return;
  const input = document.createElement('input');
  input.className = 'rename-input' + (el.tagName === 'H1' ? ' rename-title' : '');
  input.value = value;
  input.maxLength = 128;
  el.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    if (save) onSave(input.value);
    input.replaceWith(el);
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
}

// in-page confirm dialog (native <dialog>) instead of window.confirm:
// resolves true on "Delete", false on Cancel/Escape/backdrop click
function confirmDialog(message: string): Promise<boolean> {
  const dlg = document.getElementById('confirm-dialog') as HTMLDialogElement;
  if (dlg.open) return Promise.resolve(false);
  (document.getElementById('confirm-text') as HTMLParagraphElement).textContent = message;
  const okBtn = document.getElementById('confirm-ok') as HTMLButtonElement;
  const cancelBtn = document.getElementById('confirm-cancel') as HTMLButtonElement;
  return new Promise<boolean>((resolve) => {
    const finish = (v: boolean): void => {
      dlg.removeEventListener('close', onClose);
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dlg.removeEventListener('click', onBackdrop);
      resolve(v);
    };
    const onOk = (): void => { finish(true); dlg.close(); };
    const onCancel = (): void => { finish(false); dlg.close(); };
    const onClose = (): void => finish(false); // Escape closes natively
    const onBackdrop = (e: MouseEvent): void => { if (e.target === dlg) { finish(false); dlg.close(); } };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.addEventListener('click', onBackdrop);
    dlg.showModal();
  });
}

function rowEl(opts: { href: string; name: string; title: string; time: number; extra?: string; deleteMsg: string; onDelete: () => Promise<void>; onRename?: (name: string) => Promise<void>; reload: () => void }): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'room-row';
  const a = document.createElement('a');
  a.className = 'room-name';
  a.href = opts.href;
  a.textContent = opts.name;
  a.title = opts.title;
  const meta = document.createElement('span');
  meta.className = 'room-time';
  meta.textContent = (opts.extra ? opts.extra + ' · ' : '') + new Date(opts.time).toLocaleString();
  meta.title = new Date(opts.time).toISOString();
  const btns: HTMLButtonElement[] = [];
  if (opts.onRename) {
    const ren = document.createElement('button');
    ren.className = 'room-ren';
    ren.textContent = 'Rename';
    ren.addEventListener('click', () => inlineRename(a, opts.name, (v) => { void opts.onRename!(v).then(opts.reload); }));
    btns.push(ren);
  }
  const del = document.createElement('button');
  del.className = 'room-del';
  del.textContent = 'Delete';
  del.addEventListener('click', async () => {
    if (!(await confirmDialog(opts.deleteMsg))) return;
    await opts.onDelete();
    opts.reload();
  });
  btns.push(del);
  row.append(a, meta, ...btns);
  return row;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function initIndex(): void {
  const list = showDashboard();
  document.title = 'Turtle Sketch';
  const titleEl = document.getElementById('dash-title') as HTMLHeadingElement;
  titleEl.textContent = 'Turtle Sketch';
  titleEl.classList.remove('editable');
  (document.getElementById('dash-home') as HTMLButtonElement).style.display = 'none';
  const newBtn = document.getElementById('dash-new') as HTMLButtonElement;
  newBtn.textContent = '+ New workspace';
  newBtn.onclick = () => void createWorkspace();

  const load = async (): Promise<void> => {
    const wss: { id: string; name: string; lastChange: number; boards: number }[] = (await fetchJson('/api/workspaces')) || [];
    list.replaceChildren();
    if (!wss.length) {
      const empty = document.createElement('div');
      empty.className = 'dash-empty';
      empty.textContent = 'No workspaces yet.';
      list.appendChild(empty);
      return;
    }
    for (const w of wss) {
      list.appendChild(rowEl({
        href: `#${encodeURIComponent(w.id)}`,
        name: w.name,
        title: `${w.name} — click to open`,
        time: w.lastChange,
        extra: `${w.boards} board${w.boards === 1 ? '' : 's'}`,
        deleteMsg: `Delete workspace "${w.name}" and all ${w.boards} board(s) inside?`,
        onDelete: async () => {
          await fetch(`/api/workspaces/${encodeURIComponent(w.id)}`, { method: 'DELETE' });
        },
        onRename: async (name) => {
          await fetch(`/api/workspaces/${encodeURIComponent(w.id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          });
        },
        reload: load,
      }));
    }
  };
  void load();
  setInterval(load, 5000);
  window.addEventListener('focus', load);
}

function initWorkspace(ws: string): void {
  const list = showDashboard();
  document.title = 'Turtle Sketch';
  const titleEl = document.getElementById('dash-title') as HTMLHeadingElement;
  titleEl.classList.add('editable');
  (document.getElementById('dash-home') as HTMLButtonElement).style.display = '';
  const newBtn = document.getElementById('dash-new') as HTMLButtonElement;
  newBtn.textContent = '+ New board';
  newBtn.onclick = () => { location.hash = `${ws}/${randId()}`; };
  document.getElementById('dash-home')!.addEventListener('click', () => {
    location.href = location.pathname + location.search; // back to the index of all workspaces
  });

  const load = async (): Promise<void> => {
    // "using is creating": opening the workspace URL registers it server-side
    const w = await fetchJson(`/api/workspaces/${encodeURIComponent(ws)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (w) {
      titleEl.textContent = w.name;
      titleEl.title = `${w.name} — click to rename`;
      document.title = w.name;
    }
    titleEl.onclick = () => inlineRename(titleEl, titleEl.textContent || '', (name) => {
      void (async () => {
        await fetch(`/api/workspaces/${encodeURIComponent(ws)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        void load();
      })();
    });
    const boards: { id: string; name: string; lastChange: number }[] = (await fetchJson(`/api/workspaces/${encodeURIComponent(ws)}/boards`)) || [];
    list.replaceChildren();
    if (!boards.length) {
      const empty = document.createElement('div');
      empty.className = 'dash-empty';
      empty.textContent = 'No boards in this workspace yet.';
      list.appendChild(empty);
      return;
    }
    for (const b of boards) {
      list.appendChild(rowEl({
        href: `#${encodeURIComponent(ws)}/${encodeURIComponent(b.id)}`,
        name: b.name,
        title: b.name,
        time: b.lastChange,
        deleteMsg: `Delete board "${b.name}"?`,
        onDelete: async () => {
          await fetch(`/api/workspaces/${encodeURIComponent(ws)}/boards/${encodeURIComponent(b.id)}`, { method: 'DELETE' });
        },
        onRename: async (name) => {
          await fetch(`/api/workspaces/${encodeURIComponent(ws)}/boards/${encodeURIComponent(b.id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          });
        },
        reload: load,
      }));
    }
  };
  void load();
  setInterval(load, 5000);
  window.addEventListener('focus', load);
}
