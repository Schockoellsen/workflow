const claudeStatus = document.querySelector('#claude-status');
const claudeMessages = document.querySelector('#claude-messages');
const claudeForm = document.querySelector('#claude-chat-form');
const claudeQuestion = document.querySelector('#claude-question');
const claudeSend = document.querySelector('#claude-send');
const chatHint = document.querySelector('#chat-hint');
const contextFileInput = document.querySelector('#chat-context-files');
const contextList = document.querySelector('#chat-context-list');
const contextHint = document.querySelector('#chat-context-hint');
const selectedContextNotes = [];
const MAX_CONTEXT_FILES = 5;
const MAX_CONTEXT_FILE_CHARS = 20000;
const MAX_CONTEXT_TOTAL_CHARS = 30000;
let claudeSessionId = null;
let codexSessionId = null;
let activeProvider = 'worky';
let codexReady = false;
let openRouterSessionId = null;
let openRouterReady = false;
let agySessionId = null;
let agyReady = false;
const PROVIDER_LABELS = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity (Gemini)', openrouter: 'Gratis-KI (OpenRouter)' };
const PROVIDER_ENDPOINTS = { claude: '/api/chat', codex: '/api/codex/chat', antigravity: '/api/antigravity/chat', openrouter: '/api/openrouter/chat' };
let chatBusy = false;
// Stufe 4: laufende Worky-Anfrage abbrechen und Worky-Chat im Browser merken (localStorage, nur dieser PC)
let workyAbort = null;
// Mehrere Chats (z. B. „Presse“, „Höhle“): je Chat Verlauf und Claude-Sitzung, höchstens 30 Chats à 60 Nachrichten
// Je Projekt eigene Chats (Claude-Sitzungen gehören zum Projektordner)
const WORKY_CHATS_KEY = window.workflowKey('ie-worky-chats-v2');
const WORKY_CHAT_MAX = 60;
const WORKY_CHATS_KEEP = 30;
let workyHistory = [];
let workyChats = { activeId: null, chats: [] };
const newChatId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const chatTitleFrom = (messages) => {
  const first = (messages || []).find((entry) => entry && entry.kind === 'user');
  return first ? String(first.text).replace(/\s+/g, ' ').slice(0, 48) : 'Neuer Chat';
};
function persistWorkyChats() {
  try { localStorage.setItem(WORKY_CHATS_KEY, JSON.stringify(workyChats)); } catch { /* Speicher voll oder gesperrt: Chat läuft trotzdem weiter */ }
}
function loadWorkyChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(WORKY_CHATS_KEY) || 'null');
    if (saved && Array.isArray(saved.chats)) { workyChats = saved; return; }
  } catch { /* kaputt: neu anfangen */ }
  // Umzug vom früheren Einzel-Chat (ie-worky-chat-v1)
  try {
    const old = JSON.parse(localStorage.getItem('ie-worky-chat-v1') || 'null');
    if (old && Array.isArray(old.messages) && old.messages.length) {
      const id = newChatId();
      workyChats = { activeId: id, chats: [{ id, title: chatTitleFrom(old.messages), updatedAt: Date.now(), claudeSessionId: old.claudeSessionId || null, agentSessions: old.agentSessions || {}, messages: old.messages }] };
      persistWorkyChats();
      localStorage.removeItem('ie-worky-chat-v1');
    }
  } catch { /* egal */ }
}
const activeWorkyChat = () => workyChats.chats.find((chat) => chat.id === workyChats.activeId) || null;
function saveWorkyChat() {
  let chat = activeWorkyChat();
  if (!chat) {
    if (!workyHistory.length) return;
    chat = { id: newChatId(), title: '', updatedAt: Date.now(), claudeSessionId: null, agentSessions: {}, messages: [] };
    workyChats.chats.push(chat);
    workyChats.activeId = chat.id;
  }
  chat.messages = workyHistory.slice(-WORKY_CHAT_MAX);
  chat.claudeSessionId = claudeSessionId;
  chat.agentSessions = { ...agentSessions };
  chat.updatedAt = Date.now();
  if (!chat.title || chat.title === 'Neuer Chat') chat.title = chatTitleFrom(chat.messages);
  workyChats.chats = workyChats.chats.sort((a, b) => a.updatedAt - b.updatedAt).slice(-WORKY_CHATS_KEEP);
  persistWorkyChats();
  renderChatPicker();
}
function rememberWorky(entry) {
  workyHistory.push(entry);
  if (workyHistory.length > WORKY_CHAT_MAX) workyHistory = workyHistory.slice(-WORKY_CHAT_MAX);
  saveWorkyChat();
}
// Worky-Team: Agenten aus agents.json (Server: /api/agents). Schlüssel im Chat: "agent:<id>"
let workyAgents = [];
const agentSessions = {};
const agentOf = (key) => (typeof key === 'string' && key.startsWith('agent:')) ? workyAgents.find((agent) => 'agent:' + agent.id === key) : null;
const labelOf = (key) => { const agent = agentOf(key); return agent ? agent.icon + ' ' + agent.name : (PROVIDER_LABELS[key] || 'Claude'); };
const agentReady = (agent) => agent && (agent.engine === 'claude' ? claudeStatus.dataset.state !== 'offline' : agyReady);

async function loadWorkyAgents() {
  try {
    const response = await fetch('/api/agents', { cache: 'no-store' });
    const result = await response.json();
    workyAgents = Array.isArray(result.agents) ? result.agents : [];
  } catch { workyAgents = []; }
  if (!workyAgents.length || providerSelect.querySelector('optgroup[data-team]')) return;
  const group = document.createElement('optgroup');
  group.label = 'Worky-Team · Spezialisten';
  group.dataset.team = 'true';
  for (const agent of workyAgents) {
    const option = document.createElement('option');
    option.value = 'agent:' + agent.id;
    option.textContent = agent.icon + ' ' + agent.name + ' – ' + agent.title;
    group.append(option);
  }
  providerSelect.append(group);
}

const startsWord = (text, word) => { let at = text.indexOf(word); while (at !== -1) { if (at === 0 || !/[a-z0-9äöüß]/.test(text[at - 1])) return true; at = text.indexOf(word, at + 1); } return false; };

// Worky wählt einen Spezialisten anhand seiner Stichwörter (meiste Treffer gewinnt)
// onlyIf (optional): nur Agenten, die diese Bedingung erfüllen
function pickWorkyAgent(message, onlyIf = null) {
  const text = message.toLocaleLowerCase('de');
  let best = null;
  let bestScore = 0;
  for (const agent of workyAgents) {
    // Stichwort zählt nur am Wortanfang (sonst steckt „rauch“ in „brauchen“)
    const score = (agent.trigger || []).reduce((sum, word) => sum + (startsWord(text, String(word).toLocaleLowerCase('de')) ? 1 : 0), 0);
    const weighted = score > 0 ? score + (Number(agent.priority) || 0) : 0;
    if (weighted > bestScore && agentReady(agent) && (!onlyIf || onlyIf(agent))) { best = agent; bestScore = weighted; }
  }
  return best;
}
const providerSelect = document.querySelector('#chat-provider');
const chatTitle = document.querySelector('#claude-chat-title');
const providerDescription = document.querySelector('#chat-provider-description');

function renderContextNotes() {
  contextList.replaceChildren();
  for (const [index, note] of selectedContextNotes.entries()) {
    const row = document.createElement('div');
    row.className = 'chat-context-item';
    const name = document.createElement('span');
    name.textContent = `${note.name} · ${(note.content.length / 1000).toFixed(1)} k Zeichen`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tiny-action';
    remove.textContent = 'Entfernen';
    remove.setAttribute('aria-label', `${note.name} aus dem Chat-Kontext entfernen`);
    remove.addEventListener('click', () => {
      selectedContextNotes.splice(index, 1);
      renderContextNotes();
    });
    row.append(name, remove);
    contextList.append(row);
  }
  contextHint.textContent = selectedContextNotes.length
    ? `${selectedContextNotes.length} Notiz(en) ausgewählt. Passende Tresor-Auszüge werden außerdem automatisch ergänzt. Entfernen gilt für nächste Nachrichten; bereits gesendete Inhalte bleiben im Chatverlauf.`
    : 'Die Gedächtnisnotiz und passende Ausschnitte aus docs/ sind automatisch dabei. Ausgewählte Notizen gelten nur in dieser Browser-Sitzung.';
}

function setClaudeStatus(state, message) {
  claudeStatus.dataset.state = state;
  claudeStatus.querySelector('span').textContent = message;
  const teamStatus = document.querySelector('#claude-provider-status');
  const sidebarStatus = document.querySelector('#sidebar-ai-state');
  if (teamStatus) teamStatus.lastChild.textContent = state === 'busy' ? ' Claude antwortet …' : state === 'ready' ? ' Claude angemeldet' : ' Claude offline';
  if (sidebarStatus) sidebarStatus.textContent = state === 'busy' ? 'Claude antwortet …' : state === 'ready' ? 'Claude angemeldet' : 'Claude noch offline';
}

function addChatMessage(kind, message) {
  const item = document.createElement('div');
  item.className = `chat-message ${kind}`;
  item.textContent = message;
  claudeMessages.append(item);
  claudeMessages.scrollTop = claudeMessages.scrollHeight;
  return item;
}

// Kontext für eine Frage: ausgewählte Notizen plus passende Tresor-Auszüge (lokal gesucht)
async function collectContextNotes(message) {
  const vaultResult = await window.IEVaultContext?.relevantNotes(message, selectedContextNotes.map((note) => note.name)) || { notes: [] };
  let contextBudget = Math.max(0, MAX_CONTEXT_TOTAL_CHARS - selectedContextNotes.reduce((sum, note) => sum + note.content.length, 0));
  const vaultNotes = (vaultResult.notes || []).slice(0, 10 - selectedContextNotes.length).map((note) => {
    const content = note.content.slice(0, contextBudget);
    contextBudget -= content.length;
    return { name: note.name, content, auto: true };
  }).filter((note) => note.content);
  return { contextNotes: [...selectedContextNotes, ...vaultNotes], vaultCount: vaultNotes.length };
}

// Liest die Live-Antwort (NDJSON) des Servers: delta = neuer Text, tool = Claude benutzt ein Werkzeug, done/error = Ende
async function readAnswerStream(response, live) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'delta') live.onDelta?.(event.text);
      else if (event.type === 'tool') live.onTool?.(event.name);
      else if (event.type === 'turn') live.onTurn?.();
      else if (event.type === 'image') live.onImage?.(event.mediaType, event.data);
      else if (event.type === 'todos') live.onTodos?.(event.todos);
      else if (event.type === 'done' || event.type === 'error') final = event;
    }
  }
  return final || { type: 'error', error: 'Die Verbindung zur Werkstatt ist abgebrochen.' };
}

// live (optional): { mode: 'fast'|'full', onDelta, onTool, onTurn } – full = echter Claude Code mit Skills und Spezialisten – nur Claude-Wege können live schreiben
async function askProvider(provider, message, contextNotes, live = null, retried = false) {
  const agent = agentOf(provider);
  const sessionId = agent ? agentSessions[agent.id] || null : provider === 'codex' ? codexSessionId : provider === 'openrouter' ? openRouterSessionId : provider === 'antigravity' ? agySessionId : claudeSessionId;
  const canStream = Boolean(live) && (agent ? (agent.engine === 'claude' || live.engine === 'claude') : provider === 'claude');
  const extra = canStream ? { stream: true, mode: ['fast', 'full'].includes(live.mode) ? live.mode : undefined, engine: live.engine === 'claude' ? 'claude' : undefined, images: Array.isArray(live.images) && live.images.length ? live.images : undefined } : {};
  const send = () => fetch(agent ? '/api/agent/chat' : PROVIDER_ENDPOINTS[provider], {
    method: 'POST',
    signal: workyAbort ? workyAbort.signal : undefined,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agent ? { agentId: agent.id, message, sessionId, contextNotes, ...extra } : { message, sessionId, contextNotes, ...extra })
  });
  let response;
  try {
    response = await send();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    // Server kurz weg (z. B. Neustart nach einer Änderung an server.mjs): kurz warten, einmal neu versuchen
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try { response = await send(); } catch (retryError) {
      if (retryError.name === 'AbortError') throw retryError;
      throw new Error('Der Werkstatt-Server antwortet gerade nicht. Läuft das schwarze Server-Fenster (Start-IE-Werkstatt.bat)? Dann einfach nochmal senden.');
    }
  }
  let result;
  if (canStream && response.ok && (response.headers.get('Content-Type') || '').includes('ndjson')) {
    let streamed = false;
    const watched = { ...live, onDelta(piece) { streamed = true; live.onDelta?.(piece); }, onTool(name) { streamed = true; live.onTool?.(name); } };
    const final = await readAnswerStream(response, watched);
    if (final.type === 'error') {
      // Spezialist mit altem gemerkten Lauf (z. B. Bauer von gestern, zu voll zum Fortsetzen): bricht er ab, bevor er
      // etwas getan hat, einmal frisch ohne den alten Lauf starten, statt gleich an Claude abzugeben
      if (agent && sessionId && !retried && !streamed && !final.checkpoint) {
        agentSessions[agent.id] = null;
        return askProvider(provider, message, contextNotes, live, true);
      }
      const failure = new Error(final.error || labelOf(provider) + ' konnte nicht antworten.');
      failure.checkpoint = final.checkpoint || null;
      throw failure;
    }
    result = final;
  } else {
    result = await response.json().catch(() => ({}));
  }
  // Kennt der Server die gemerkte Sitzung nicht (z. B. alter Chat von vor dem Update), einmal frisch beginnen
  if (!response.ok && sessionId && !retried && /gehört nicht zu dieser Werkstatt-Sitzung/.test(String(result.error || ''))) {
    if (agent) agentSessions[agent.id] = null;
    else if (provider === 'claude') claudeSessionId = null;
    return askProvider(provider, message, contextNotes, live, true);
  }
  if (!response.ok) throw new Error(result.error || labelOf(provider) + ' konnte nicht antworten.');
  if (agent) { agentSessions[agent.id] = result.sessionId || null; return result; }
  if (provider === 'codex') codexSessionId = result.sessionId;
  else if (provider === 'openrouter') openRouterSessionId = result.sessionId;
  else if (provider === 'antigravity') agySessionId = result.sessionId;
  else claudeSessionId = result.sessionId;
  return result;
}

function workyBubble() {
  const item = document.createElement('div');
  item.className = 'chat-message assistant worky';
  const head = document.createElement('div');
  head.className = 'worky-head';
  head.innerHTML = '<span class="worky-logo small" aria-hidden="true"><i></i><i></i><i></i></span><strong>Worky</strong>';
  const body = document.createElement('div');
  body.className = 'worky-body';
  const team = document.createElement('div');
  team.className = 'worky-team';
  item.append(head, body, team);
  claudeMessages.append(item);
  claudeMessages.scrollTop = claudeMessages.scrollHeight;
  return { item, body, team };
}

function workyChip(team, text, state) {
  const chip = document.createElement('span');
  chip.className = 'worky-chip ' + (state || '');
  chip.textContent = text;
  team.append(chip);
  return chip;
}

// Schnell-Weiche ohne zusätzliche KI-Abfrage (die selbst ~7 s kosten würde): kurze Fragen ohne Bau-, Fehler-
// oder Planungswörter = "fast", alles andere = "deep" (Spezialist, Tresor-Kontext, volle Werkzeuge).
const DEEP_WORDS = /\b(bau|baue|baut|einbau|ändere|ändern|änder|umbau|implementier|programmier|erstell|füge|hinzufüg|lösch|entfern|fix|repar|behebe|bug|fehler|geht nicht|funktioniert nicht|kaputt|f9|analysier|untersuch|prüf|review|plan|planen|konzept|refactor|commit|push|merge|studio|play|blender|szene|render|generier|erzeug|textur|material|modell|asset|werkzeug|verbunden|verbindung|zugriff|check|teste|mcp|pull|fetch|github|branch|zweig|pull request|füg|einfüg|rojo|teste|testpaket|schreib (den|mir|eine|ein) (code|skript|script|datei|notiz)|trag .* ein|dokumentier)/i;
function classifyWorkyMessage(message) {
  const text = String(message || '');
  if (text.length > 280 || (text.match(/\n/g) || []).length > 3 || text.includes('```')) return 'deep';
  return DEEP_WORDS.test(text) ? 'deep' : 'fast';
}

const TOOL_LABELS = { Read: 'liest eine Datei', Glob: 'sucht Dateien', Grep: 'durchsucht den Code', Edit: 'ändert eine Datei', Write: 'schreibt eine Datei', Bash: 'führt einen Befehl aus', PowerShell: 'führt einen Befehl aus', Agent: 'holt einen Spezialisten', Task: 'holt einen Spezialisten', Skill: 'nutzt einen Skill', TodoWrite: 'plant die Schritte', WebSearch: 'sucht im Web', WebFetch: 'liest eine Webseite' };
function toolLabel(name) {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  if (/Roblox_Studio__generate/.test(name)) return 'erzeugt etwas mit der Roblox-KI';
  if (/Roblox_Studio__search_asset/.test(name)) return 'sucht im Roblox-Katalog';
  if (/Roblox_Studio/i.test(name)) return 'schaut in Roblox Studio';
  if (/^mcp__blender__execute/.test(name)) return 'will Code in Blender ausführen';
  if (/^mcp__blender__/.test(name)) return 'schaut in Blender';
  if (/freigabe/i.test(name)) return 'wartet auf deine Freigabe';
  return 'benutzt ' + name;
}

// Live-Anzeige: Text erscheint beim Schreiben, die Kopfzeile zeigt, was Claude gerade tut
function liveAnswer(bubble, chip, label, mode, engine) {
  let text = '';
  let scheduled = false;
  const paint = () => {
    scheduled = false;
    if (bubble.item.classList.contains('stopped')) return; // nach Stopp nichts mehr übermalen
    if (window.IEMarkdown) window.IEMarkdown.renderInto(bubble.body, text, []);
    else bubble.body.textContent = text;
    claudeMessages.scrollTop = claudeMessages.scrollHeight;
  };
  return {
    mode,
    engine,
    onDelta(piece) {
      text += piece;
      bubble.item.classList.remove('thinking');
      chip.textContent = label + ' schreibt …';
      if (!scheduled) { scheduled = true; requestAnimationFrame(paint); }
    },
    onTool(name) { chip.textContent = label + ' ' + toolLabel(name) + ' …'; },
    onTurn() { if (text && !text.endsWith('\n\n')) text += '\n\n'; },
    onImage(mediaType, data) { showImageInBubble(bubble, mediaType, data); },
    onTodos(todos) { showTodos(bubble, todos); }
  };
}

// ===== Bilder: Timo hängt Screenshots an (📎, Strg+V, hineinziehen); Worky zeigt Bilder aus Studio/Blender =====
const pendingImages = [];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const attachmentsBox = document.querySelector('#worky-attachments');

function showImageInBubble(bubble, mediaType, data) {
  let gallery = bubble.item.querySelector(':scope > .worky-gallery');
  if (!gallery) {
    gallery = document.createElement('div');
    gallery.className = 'worky-gallery';
    const team = bubble.item.querySelector(':scope > .worky-team');
    if (team) team.before(gallery); else bubble.item.append(gallery);
  }
  const link = document.createElement('a');
  link.href = 'data:' + mediaType + ';base64,' + data;
  link.target = '_blank';
  link.rel = 'noopener';
  const img = document.createElement('img');
  img.src = link.href;
  img.alt = 'Bild';
  img.loading = 'lazy';
  link.append(img);
  gallery.append(link);
  claudeMessages.scrollTop = claudeMessages.scrollHeight;
}

function renderPendingImages() {
  if (!attachmentsBox) return;
  attachmentsBox.replaceChildren();
  attachmentsBox.hidden = pendingImages.length === 0;
  pendingImages.forEach((image, index) => {
    const chip = document.createElement('span');
    chip.className = 'worky-attachment';
    const img = document.createElement('img');
    img.src = 'data:' + image.mediaType + ';base64,' + image.data;
    img.alt = image.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Bild entfernen';
    remove.addEventListener('click', () => { pendingImages.splice(index, 1); renderPendingImages(); });
    chip.append(img, remove);
    attachmentsBox.append(chip);
  });
}

function addImageFile(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { addChatMessage('error', 'Nur Bilder (PNG, JPG, WebP, GIF) können angehängt werden.'); return; }
  if (file.size > IMAGE_MAX_BYTES) { addChatMessage('error', file.name + ': Das Bild ist größer als 5 MB.'); return; }
  if (pendingImages.length >= 4) { addChatMessage('error', 'Höchstens 4 Bilder pro Nachricht.'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const data = String(reader.result).split(',')[1] || '';
    pendingImages.push({ mediaType: file.type, data, name: file.name || 'Screenshot' });
    renderPendingImages();
  };
  reader.readAsDataURL(file);
}

document.querySelector('#worky-attach')?.addEventListener('click', () => document.querySelector('#worky-image-input')?.click());
document.querySelector('#worky-image-input')?.addEventListener('change', (event) => {
  for (const file of event.target.files || []) addImageFile(file);
  event.target.value = '';
});
claudeQuestion.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.items || [])].filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile());
  if (files.length) { event.preventDefault(); files.forEach(addImageFile); }
});
claudeForm.addEventListener('dragover', (event) => { if ([...(event.dataTransfer?.items || [])].some((item) => item.kind === 'file')) event.preventDefault(); });
claudeForm.addEventListener('drop', (event) => {
  const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith('image/'));
  if (files.length) { event.preventDefault(); files.forEach(addImageFile); }
});

// 📋 Live-Checkliste aus Workys Aufgabenliste (TodoWrite)
function showTodos(bubble, todos) {
  if (!Array.isArray(todos) || !todos.length) return;
  let box = bubble.item.querySelector(':scope > .worky-todos');
  if (!box) {
    box = document.createElement('div');
    box.className = 'worky-todos';
    bubble.body.before(box);
  }
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const title = document.createElement('div');
  title.className = 'worky-todos-title';
  title.textContent = 'Checkliste · ' + done + '/' + todos.length + ' erledigt';
  const list = document.createElement('ol');
  for (const todo of todos) {
    const item = document.createElement('li');
    item.className = 'todo-' + todo.status;
    item.textContent = (todo.status === 'completed' ? '✅ ' : todo.status === 'in_progress' ? '⏳ ' : '⬜ ') + todo.text;
    list.append(item);
  }
  box.replaceChildren(title, list);
}

// 📋 Plan zuerst: Worky hat einen Plan gezeigt und wartet auf Timos OK
function addPlanButtons(bubble) {
  const row = document.createElement('div');
  row.className = 'worky-quick worky-after';
  const go = document.createElement('button');
  go.type = 'button';
  go.textContent = '▶️ Los, umsetzen';
  go.addEventListener('click', () => {
    if (chatBusy) return;
    claudeQuestion.value = 'Los, setz den Plan so um.';
    claudeForm.requestSubmit();
    row.remove();
  });
  const change = document.createElement('button');
  change.type = 'button';
  change.textContent = '✏️ Plan ändern';
  change.addEventListener('click', () => {
    claudeQuestion.value = 'Ändere den Plan: ';
    claudeQuestion.focus();
    row.remove();
  });
  row.append(go, change);
  bubble.item.append(row);
}

// 📈 Verbrauch eines Auftrags: Dauer, Schritte, Tokens (Tokens = Textmenge, die Claude gelesen und geschrieben hat;
// davon hängt ab, wie viel vom Max-Kontingent verbraucht wird). Summe für heute im Browser gemerkt.
const USAGE_KEY = 'ie-worky-verbrauch-v1';
function formatTokens(value) {
  return value >= 1_000_000 ? (value / 1_000_000).toFixed(1) + ' Mio.' : value >= 1000 ? Math.round(value / 1000) + 'k' : String(value);
}
function showUsage(bubble, usage) {
  const today = new Date().toISOString().slice(0, 10);
  let total = { day: today, tokens: 0, runs: 0 };
  try { const saved = JSON.parse(localStorage.getItem(USAGE_KEY) || 'null'); if (saved && saved.day === today) total = saved; } catch { /* neu */ }
  total.tokens += Number(usage.tokens) || 0;
  total.runs += 1;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(total)); } catch { /* egal */ }
  const chip = workyChip(bubble.team, '📈 ' + (usage.seconds || 0) + ' s · ' + (usage.turns || 0) + ' Schritte · ' + formatTokens(Number(usage.tokens) || 0) + ' Tokens', 'done');
  chip.classList.add('usage');
  chip.title = 'Heute zusammen: ' + total.runs + ' Aufträge, ' + formatTokens(total.tokens) + ' Tokens. Genaue Restmenge deines Max-Kontingents: claude.ai → Einstellungen → Nutzung.';
}

// ↩️ Rückgängig: setzt genau die Dateien zurück, die Worky in diesem Auftrag geändert hat (Server: POST /api/undo)
function addUndoButton(bubble, checkpoint) {
  if (!checkpoint || !Array.isArray(checkpoint.files) || !checkpoint.files.length) return;
  const row = document.createElement('div');
  row.className = 'worky-quick worky-after worky-undo';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '↩️ Rückgängig (' + checkpoint.files.length + (checkpoint.files.length === 1 ? ' Datei)' : ' Dateien)');
  button.title = checkpoint.files.join('\n');
  const note = document.createElement('span');
  note.className = 'worky-undo-note';
  button.addEventListener('click', async () => {
    const list = checkpoint.files.slice(0, 15).join('\n') + (checkpoint.files.length > 15 ? '\n… und ' + (checkpoint.files.length - 15) + ' weitere' : '');
    if (!window.confirm('Diese Dateien auf den Stand vor dem Auftrag zurücksetzen?\n\n' + list)) return;
    button.disabled = true;
    const send = async (force) => {
      const response = await fetch('/api/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: checkpoint.id, force }) });
      return { response, result: await response.json().catch(() => ({})) };
    };
    try {
      let { response, result } = await send(false);
      if (response.status === 409 && Array.isArray(result.laterChanged)) {
        if (!window.confirm(result.error + '\n\nTrotzdem zurücksetzen? Dann gehen auch die späteren Änderungen an diesen Dateien verloren.')) { button.disabled = false; return; }
        ({ response, result } = await send(true));
      }
      if (!response.ok) throw new Error(result.error || 'Rückgängig hat nicht geklappt.');
      note.textContent = 'Zurückgesetzt: ' + (result.restored?.length || 0) + ' wiederhergestellt, ' + (result.removed?.length || 0) + ' neue Datei(en) entfernt. Rojo übernimmt das in Studio.';
      button.textContent = '↩️ Rückgängig gemacht';
    } catch (error) {
      note.textContent = error.message || 'Rückgängig hat nicht geklappt.';
      button.disabled = false;
    }
  });
  row.append(button, note);
  bubble.item.append(row);
}

// 🎤 Sprechen statt tippen: Spracherkennung des Browsers (Chrome/Edge). Der Text landet im Eingabefeld,
// Timo prüft ihn und schickt selbst ab. Hinweis: Der Browser schickt die Sprache dafür an seinen Anbieter.
const micButton = document.querySelector('#worky-mic');
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
if (micButton && SpeechRecognitionApi) {
  micButton.hidden = false;
  let recognition = null;
  let baseText = '';
  const stopListening = () => {
    recognition?.stop();
    recognition = null;
    micButton.textContent = '🎤 Sprechen';
    micButton.classList.remove('listening');
  };
  micButton.addEventListener('click', () => {
    if (recognition) { stopListening(); return; }
    recognition = new SpeechRecognitionApi();
    recognition.lang = 'de-DE';
    recognition.interimResults = true;
    recognition.continuous = true;
    baseText = claudeQuestion.value ? claudeQuestion.value.replace(/\s*$/, ' ') : '';
    recognition.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const piece = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalText += piece; else interim += piece;
      }
      claudeQuestion.value = (baseText + finalText + interim).slice(0, 6000);
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') addChatMessage('error', 'Mikrofon ist blockiert. Im Browser oben links beim Schloss-Symbol das Mikrofon erlauben.');
      stopListening();
    };
    recognition.onend = () => { if (recognition) stopListening(); };
    recognition.start();
    micButton.textContent = '⏹ Fertig';
    micButton.classList.add('listening');
    claudeQuestion.focus();
  });
}

// 🛡️ Fehler-Wächter: fragt alle 5 s beim Server nach neuen roten Zeilen aus Studio (nur solange eingeschaltet)
const guardToggle = document.querySelector('#worky-guard');
const guardState = document.querySelector('#worky-guard-state');
const guardAlert = document.querySelector('#worky-guard-alert');
let guardTimer = null;
let guardShown = '';
function renderGuard(result) {
  if (guardState) guardState.textContent = 'Wächter · ' + (result.mode || 'aus');
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const key = errors.map((error) => error.id).join(',');
  if (key === guardShown) return;
  guardShown = key;
  guardAlert.hidden = errors.length === 0;
  if (!errors.length) { guardAlert.replaceChildren(); return; }
  const title = document.createElement('strong');
  title.textContent = '🔴 ' + errors.length + (errors.length === 1 ? ' Fehler' : ' Fehler') + ' in Roblox Studio';
  const list = document.createElement('ul');
  for (const error of errors.slice(-4)) {
    const item = document.createElement('li');
    item.textContent = error.text;
    list.append(item);
  }
  const fix = document.createElement('button');
  fix.type = 'button';
  fix.className = 'primary-button';
  fix.textContent = '🐞 Worky, fix das';
  fix.addEventListener('click', () => {
    if (chatBusy) return;
    if (activeProvider !== 'worky') { providerSelect.value = 'worky'; providerSelect.dispatchEvent(new Event('change')); }
    claudeQuestion.value = 'Der Fehler-Wächter hat in Roblox Studio diese roten Zeilen gesehen:\n' + errors.slice(-6).map((error) => '- ' + error.text).join('\n') + '\n\nFinde die Ursache und behebe sie mit dem kleinsten sicheren Fix (Skill fehler-jagd). Danach Selbsttest.';
    claudeForm.requestSubmit();
    void fetch('/api/waechter/leeren', { method: 'POST' }).then(() => renderGuard({ mode: result.mode, errors: [] }));
  });
  const hide = document.createElement('button');
  hide.type = 'button';
  hide.className = 'tiny-action';
  hide.textContent = 'Ausblenden';
  hide.addEventListener('click', () => { void fetch('/api/waechter/leeren', { method: 'POST' }).then(() => renderGuard({ mode: result.mode, errors: [] })); });
  const actions = document.createElement('div');
  actions.className = 'worky-guard-actions';
  actions.append(fix, hide);
  guardAlert.replaceChildren(title, list, actions);
}
async function pollGuard() {
  if (document.hidden) return;
  try { renderGuard(await (await fetch('/api/waechter', { cache: 'no-store' })).json()); } catch { if (guardState) guardState.textContent = 'Wächter · Werkstatt nicht erreichbar'; }
}
function setGuard(on) {
  try { localStorage.setItem('ie-worky-waechter', on ? '1' : '0'); } catch { /* egal */ }
  if (guardTimer) clearInterval(guardTimer);
  guardTimer = null;
  if (on) { void pollGuard(); guardTimer = setInterval(pollGuard, 5000); }
  else { if (guardState) guardState.textContent = 'Wächter'; guardAlert.hidden = true; guardShown = ''; }
}
if (guardToggle) {
  let stored = '1';
  try { stored = localStorage.getItem('ie-worky-waechter') ?? '1'; } catch { /* Standard: an */ }
  guardToggle.checked = stored !== '0';
  guardToggle.addEventListener('change', () => setGuard(guardToggle.checked));
  setGuard(guardToggle.checked);
}

// Knopf unter einer Antwort: schickt den Selbsttest-Auftrag an Worky
function addSelfTestButton(bubble) {
  const row = document.createElement('div');
  row.className = 'worky-quick worky-after';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '🎮 Jetzt in Studio selbst testen';
  button.addEventListener('click', () => {
    if (chatBusy) return;
    claudeQuestion.value = 'Mach einen Selbsttest in Roblox Studio (Skill selbsttest) für das, was du gerade geändert hast, und berichte mit ✅/❌.';
    claudeForm.requestSubmit();
    row.remove();
  });
  row.append(button);
  bubble.item.append(row);
}

// Worky: Die passende KI (meist Claude oder ein Claude-Spezialist) antwortet und baut.
async function sendWorkyMessage(message, forcedLead, images = []) {
  const bubble = workyBubble();
  bubble.item.classList.add('thinking');
  const claudeReady = claudeStatus.dataset.state !== 'offline';
  const choice = typeof chooseProvider === 'function' ? chooseProvider(message) : { key: 'claude' };
  // Erklär-Fragen gehen an Claude, auch wenn Code-Wörter darin stehen; Codex nur für echte Umsetzung.
  const explainIntent = /\b(erklär|erkläre|erklären|was ist|was sind|wie funktioniert|warum|verstehe|zeig mir)\b/i.test(message);
  // Fließband braucht Befehle (Zweig, Commit, Pull Request): das kann nur Claude, nie Codex (z. B. wegen „Code-Karte“)
  const assemblyLine = /^\s*Fließband/i.test(message);
  let lead = choice.key === 'codex' && codexReady && !explainIntent && !assemblyLine ? 'codex' : 'claude';
  // Schnell-Weiche: einfache Fragen gehen direkt an Claude (schnelles Modell), Aufgaben an den Spezialisten
  const depth = forcedLead ? 'deep' : classifyWorkyMessage(message);
  // Aufgaben brauchen Werkzeuge (Befehle, Dateien ändern): nur Claude-Spezialisten können das. Passt keiner, macht es
  // Worky selbst als voller Claude Code und holt sich bei Bedarf einen Spezialisten. Antigravity-Rollen nur bei Direktwahl.
  const specialist = forcedLead || depth === 'fast' ? null : pickWorkyAgent(message, (agent) => agent.engine === 'claude');
  if (specialist && !(explainIntent && specialist.id === 'gameplay-programmer')) lead = 'agent:' + specialist.id;
  if (forcedLead) lead = forcedLead;
  if (lead === 'claude' && !claudeReady) lead = agyReady ? 'antigravity' : openRouterReady ? 'openrouter' : 'claude';
  if (images.length && lead !== 'claude' && !(agentOf(lead)?.engine === 'claude')) lead = 'claude';
  const leadAgent = agentOf(lead);
  if (leadAgent) {
    bubble.item.style.setProperty('--agent-color', leadAgent.color);
    bubble.item.classList.add('has-agent');
    const name = document.createElement('span');
    name.className = 'worky-agent';
    name.textContent = leadAgent.icon + ' ' + leadAgent.name;
    bubble.item.querySelector('.worky-head').append(name);
  }
  setClaudeStatus('busy', 'Worky arbeitet …');
  try {
    const fastLane = depth === 'fast' && lead === 'claude';
    workyChip(bubble.team, fastLane ? '⚡ Schnell-Antwort' : '🔬 Gründlich', 'done');
    let contextNotes = [...selectedContextNotes];
    if (!fastLane) {
      bubble.body.textContent = 'Ich suche passende Notizen im Tresor …';
      const collected = await collectContextNotes(message);
      contextNotes = collected.contextNotes;
      if (collected.vaultCount) workyChip(bubble.team, 'Obsidian · ' + collected.vaultCount + ' Notiz(en)', 'done');
    }
    // Gemini-Zweitmeinung ausgebaut (2026-10-22, Timo): kam oft leer zurück und kostete Zeit. Gemini bleibt Ersatz und Direktwahl.
    const leadChip = workyChip(bubble.team, labelOf(lead) + ' antwortet …', 'active');
    bubble.body.textContent = labelOf(lead) + ' arbeitet an der Antwort …';
    const leadMessage = message;
    let result;
    try {
      const live = liveAnswer(bubble, leadChip, labelOf(lead), fastLane ? 'fast' : 'full');
      live.images = images;
      result = await askProvider(lead, leadMessage, contextNotes, live);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      // Fällt die gewählte KI aus (z. B. Codex-Kontingent leer), übernimmt die nächste bereite KI.
      const fallback = (forcedLead ? [] : ['claude', 'antigravity', 'openrouter']).find((name) => name !== lead
        && (name === 'claude' ? claudeReady : name === 'antigravity' ? agyReady : openRouterReady));
      leadChip.textContent = labelOf(lead) + ' · nicht verfügbar';
      leadChip.className = 'worky-chip failed';
      leadChip.title = error.message || '';
      // Grund sichtbar machen (vorher nur beim Drüberfahren mit der Maus)
      if (fallback && error.message) workyChip(bubble.team, 'Grund: ' + String(error.message).slice(0, 140), 'failed').title = error.message;
      if (lead === 'codex') codexReady = false;
      if (!fallback) throw error;
      lead = fallback;
      const nextChip = workyChip(bubble.team, labelOf(lead) + ' übernimmt …', 'active');
      bubble.body.textContent = labelOf(lead) + ' übernimmt die Antwort …';
      // Claude als Ersatz arbeitet im vollen Gründlich-Modus (mit Befehlen), nicht in der kleinen Lese-Spur
      const fallbackLive = lead === 'claude' ? liveAnswer(bubble, nextChip, labelOf(lead), 'full') : null;
      if (fallbackLive) fallbackLive.images = images;
      result = await askProvider(lead, leadMessage, contextNotes, fallbackLive);
      nextChip.className = 'worky-chip done';
      nextChip.textContent = labelOf(lead) + ' · Antwort';
    }
    if (leadChip.classList.contains('active')) {
      leadChip.textContent = labelOf(lead) + ' · Antwort';
      leadChip.className = 'worky-chip done';
    }
    const activityText = Array.isArray(result.activity) && result.activity.length
      ? '\n\nWas dabei passiert ist:\n' + result.activity.map((item) => '• ' + item).join('\n')
      : '';
    const planReady = /\[\[PLAN\]\]\s*$/.test(String(result.reply || ''));
    if (planReady) result.reply = String(result.reply).replace(/\s*\[\[PLAN\]\]\s*$/, '');
    if (window.IEMarkdown) window.IEMarkdown.renderInto(bubble.body, result.reply, result.activity);
    else bubble.body.textContent = result.reply + activityText;
    if (planReady) addPlanButtons(bubble);
    bubble.item.classList.remove('thinking');
    rememberWorky({ kind: 'worky', text: String(result.reply || ''), activity: Array.isArray(result.activity) ? result.activity : [], agent: leadAgent ? leadAgent.id : null });
    if (result.checkpoint) addUndoButton(bubble, result.checkpoint);
    if (result.usage) showUsage(bubble, result.usage);
    // Worky lernt (Paket 4): Daumen unter der Antwort; nach Gründlich-Aufträgen mit Änderungen eine kurze Lern-Runde
    window.workflowLearn?.afterAnswer(bubble, { question: message, answer: String(result.reply || ''), activity: Array.isArray(result.activity) ? result.activity : [],
      autoRound: !fastLane && Array.isArray(result.activity) && result.activity.some((item) => /geändert|erstellt|changed|created/i.test(item)) });
    // Wurde etwas geändert, gibt es unter der Antwort einen Knopf für den Selbsttest in Studio
    if (Array.isArray(result.activity) && result.activity.some((item) => /geändert|erstellt/i.test(item))) addSelfTestButton(bubble);
    // Team-Runde: Hat ein Spezialist mit Schreibrecht Dateien geändert, schaut der Prüfer (reviewer in agents.json) automatisch drüber.
    const changedFiles = Array.isArray(result.activity) && result.activity.some((item) => /geändert|erstellt|changed|created/i.test(item));
    const reviewer = workyAgents.find((agent) => agent.reviewer);
    // Beim Fließband erledigt Worky Prüfung und Tresor selbst: keine zweite Team- und Tresor-Runde (assemblyLine oben)
    if (!assemblyLine && leadAgent?.write && leadAgent !== reviewer && changedFiles && reviewer && agentReady(reviewer)) {
      const review = workyBubble();
      review.item.classList.add('thinking', 'has-agent');
      review.item.style.setProperty('--agent-color', reviewer.color);
      const tag = document.createElement('span');
      tag.className = 'worky-agent';
      tag.textContent = reviewer.icon + ' ' + reviewer.name;
      review.item.querySelector('.worky-head').append(tag);
      review.body.textContent = 'Der Prüfer schaut sich die Änderungen von ' + leadAgent.name + ' an …';
      const chip = workyChip(review.team, reviewer.icon + ' Prüfer prüft …', 'active');
      setClaudeStatus('busy', 'Prüfer schaut drüber …');
      try {
        agentSessions[reviewer.id] = null; // jede Team-Runde frisch, über Claude (nur lesen)
        const check = await askProvider('agent:' + reviewer.id, 'Team-Runde: ' + leadAgent.icon + ' ' + leadAgent.name + ' hat gerade für Timos Auftrag „' + message.slice(0, 400) + '“ Dateien geändert. Seine Zusammenfassung:\n\n' + String(result.reply).slice(0, 3500) + '\n\nLies die genannten Dateien und prüfe kurz (höchstens 10 Punkte): Bricht etwas die Projektregeln, fehlt ein return, gibt es offensichtliche Fehler? Wenn alles passt, sag das in einem Satz.', contextNotes, liveAnswer(review, chip, reviewer.icon + ' Prüfer', 'full', 'claude'));
        agentSessions[reviewer.id] = null;
        if (window.IEMarkdown) window.IEMarkdown.renderInto(review.body, check.reply, []);
        else review.body.textContent = check.reply;
        rememberWorky({ kind: 'worky', text: String(check.reply || ''), activity: [], agent: reviewer.id });
        chip.textContent = reviewer.icon + ' Prüfer · fertig';
        chip.className = 'worky-chip done';
      } catch (error) {
        review.body.textContent = 'Der Prüfer konnte gerade nicht prüfen: ' + (error.message || 'unbekannter Fehler');
        chip.textContent = 'Prüfer · nicht verfügbar';
        chip.className = 'worky-chip failed';
      } finally {
        review.item.classList.remove('thinking');
      }
    }
    // Tresor-Runde: Wurde Spielcode (src/) geändert, trägt der Archivar die Änderung automatisch in Obsidian ein
    const archivist = workyAgents.find((agent) => agent.id === 'tresor-wart');
    // Welche Dateien geändert wurden, weiß der Sicherungspunkt genau (siehe Rückgängig)
    const changedFilesList = Array.isArray(result.checkpoint?.files) ? result.checkpoint.files : [];
    const changedGameCode = changedFilesList.some((file) => file.startsWith('src/'));
    // Hat der Bauer den Tresor schon selbst gepflegt (docs/ geändert, Chatverlauf zählt nicht), spart die Runde einen zweiten Lauf
    const docsAlreadyUpdated = changedFilesList.some((file) => file.startsWith('docs/') && !file.startsWith('docs/Werkstatt-Chatverlauf/'));
    if (!assemblyLine && changedGameCode && !docsAlreadyUpdated && archivist && agentReady(archivist) && leadAgent !== archivist && !workyAbort?.signal.aborted) {
      const notes = workyBubble();
      notes.item.classList.add('thinking', 'has-agent');
      notes.item.style.setProperty('--agent-color', archivist.color);
      const tag = document.createElement('span');
      tag.className = 'worky-agent';
      tag.textContent = archivist.icon + ' ' + archivist.name;
      notes.item.querySelector('.worky-head').append(tag);
      notes.body.textContent = 'Der Archivar trägt die Änderung in den Tresor ein …';
      const chip = workyChip(notes.team, archivist.icon + ' Tresor-Runde …', 'active');
      setClaudeStatus('busy', 'Archivar schreibt in den Tresor …');
      try {
        const changed = changedFilesList.map((file) => '- ' + file).join('\n');
        const entry = await askProvider('agent:' + archivist.id, 'Tresor-Runde (automatisch nach einer Änderung): Für Timos Auftrag „' + message.slice(0, 400) + '“ wurde gerade Folgendes geändert:\n' + changed + '\n\nZusammenfassung des Bauers:\n' + String(result.reply).slice(0, 3000) + '\n\nTrag das kurz und richtig in den Tresor ein (Skill tresor-pflegen): passende System-Notiz, Fahrplan (gebaut, noch nicht getestet), neue Dateien in die Code-Karte, neue Fehler in Stolpersteine. Nur docs/ ändern, Timos Notizen nie löschen. Antworte in höchstens 5 Zeilen, welche Notizen du ergänzt hast.', contextNotes, liveAnswer(notes, chip, archivist.icon + ' Archivar', 'full'));
        if (window.IEMarkdown) window.IEMarkdown.renderInto(notes.body, entry.reply, entry.activity || []);
        else notes.body.textContent = entry.reply;
        if (entry.checkpoint) addUndoButton(notes, entry.checkpoint);
        rememberWorky({ kind: 'worky', text: String(entry.reply || ''), activity: entry.activity || [], agent: archivist.id });
        chip.textContent = archivist.icon + ' Tresor · fertig';
        chip.className = 'worky-chip done';
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        notes.body.textContent = 'Die Tresor-Runde hat nicht geklappt: ' + (error.message || 'unbekannter Fehler') + ' – du kannst „📚 Tresor nachtragen“ drücken.';
        chip.textContent = 'Tresor · nicht geklappt';
        chip.className = 'worky-chip failed';
      } finally {
        notes.item.classList.remove('thinking');
      }
    }
    setClaudeStatus('ready', 'Worky bereit');
  } catch (error) {
    if (error.name === 'AbortError') {
      bubble.item.classList.add('stopped');
      bubble.body.textContent = '⏹ Abgebrochen. Worky hat aufgehört. Was schon geändert war, bleibt so – frag ihn ruhig, was er bis dahin gemacht hat.';
      bubble.team.querySelectorAll('.worky-chip.active').forEach((chip) => { chip.className = 'worky-chip failed'; chip.textContent = 'abgebrochen'; });
      setClaudeStatus('ready', 'Worky bereit');
      return;
    }
    bubble.item.classList.add('error');
    bubble.body.textContent = error.message || 'Worky konnte gerade nicht antworten.';
    if (error.checkpoint) addUndoButton(bubble, error.checkpoint);
    setClaudeStatus('error', 'Worky: Anfrage fehlgeschlagen');
    if (claudeReady) window.workflowLearn?.afterError(bubble, message, error.message || '');
  } finally {
    bubble.item.classList.remove('thinking');
    claudeMessages.scrollTop = claudeMessages.scrollHeight;
  }
}

async function sendClaudeMessage(event) {
  event.preventDefault();
  const message = claudeQuestion.value.trim();
  if (!message || chatBusy) return;
  if (activeProvider === 'worky' || agentOf(activeProvider)) {
    const welcomeBox = claudeMessages.querySelector('.chat-welcome');
    if (welcomeBox) welcomeBox.remove();
    const images = pendingImages.splice(0);
    renderPendingImages();
    const userItem = addChatMessage('user', message);
    for (const image of images) showImageInBubble({ item: userItem }, image.mediaType, image.data);
    rememberWorky({ kind: 'user', text: message + (images.length ? `\n\n📎 ${images.length} Bild(er) angehängt` : '') });
    claudeQuestion.value = '';
    chatBusy = true;
    claudeSend.disabled = true;
    claudeQuestion.disabled = true;
    workyAbort = new AbortController();
    setWorkyRunning(true);
    try { await sendWorkyMessage(message, agentOf(activeProvider) ? activeProvider : undefined, images); } finally {
      workyAbort = null;
      setWorkyRunning(false);
      saveWorkyChat();
      chatBusy = false;
      claudeSend.disabled = false;
      claudeQuestion.disabled = false;
      claudeQuestion.focus();
    }
    return;
  }

  const welcome = claudeMessages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
  addChatMessage('user', message);
  claudeQuestion.value = '';
  chatBusy = true;
  claudeSend.disabled = true;
  claudeQuestion.disabled = true;
  // Automatisch: die Stichwort-Regel aus router.js wählt; nicht verbundene Anbieter fallen auf Claude zurück.
  let provider = activeProvider;
  let autoNote = '';
  if (provider === 'auto') {
    const choice = typeof chooseProvider === 'function' ? chooseProvider(message) : { key: 'claude', reason: '' };
    const claudeReady = claudeStatus.dataset.state !== 'offline';
    provider = choice.key === 'codex' && codexReady ? 'codex' : 'claude';
    if ((choice.key === 'images' || choice.key === 'gemini') && agyReady) provider = 'antigravity';
    if (provider === 'claude' && !claudeReady && agyReady) provider = 'antigravity';
    if (provider === 'claude' && !claudeReady && openRouterReady) provider = 'openrouter';
    autoNote = provider === 'antigravity'
      ? `Automatisch gewählt: Antigravity (Gemini). ${choice.key === 'images' || choice.key === 'gemini' ? 'Passt zu Bildern und zweiten Meinungen.' : 'Claude ist gerade nicht bereit.'} Es liest und plant nur, ändert nichts.`
      : provider === 'openrouter'
      ? 'Automatisch gewählt: Gratis-KI (OpenRouter), weil Claude gerade nicht bereit ist. Sie kann nur antworten, nichts ändern.'
      : choice.key === 'codex' && !codexReady
        ? 'Automatisch gewählt: Claude (Codex wäre passender, ist aber gerade nicht bereit).'
        : choice.key === 'images' || choice.key === 'gemini'
          ? `Automatisch gewählt: Claude (${choice.provider} ist noch nicht verbunden).`
          : `Automatisch gewählt: ${PROVIDER_LABELS[provider]}. ${choice.reason || ''}`.trim();
  }
  const label = PROVIDER_LABELS[provider] || 'Claude';
  if (autoNote) addChatMessage('assistant', autoNote);
  setClaudeStatus('busy', `${label} antwortet …`);
  const pending = addChatMessage('assistant', `${label} denkt nach …`);

  try {
    pending.textContent = 'Durchsuche verbundene Obsidian-Notizen lokal und bereite den Chat vor …';
    const vaultResult = await window.IEVaultContext?.relevantNotes(message, selectedContextNotes.map((note) => note.name)) || { notes: [] };
    let contextBudget = Math.max(0, MAX_CONTEXT_TOTAL_CHARS - selectedContextNotes.reduce((sum, note) => sum + note.content.length, 0));
    const vaultNotes = (vaultResult.notes || []).slice(0, 10 - selectedContextNotes.length).map((note) => {
      const content = note.content.slice(0, contextBudget);
      contextBudget -= content.length;
      return { name: note.name, content };
    }).filter((note) => note.content);
    const contextNotes = [...selectedContextNotes, ...vaultNotes];
    pending.textContent = vaultNotes.length
      ? `${label} liest ${vaultNotes.length} passende Tresor-Notiz(en) und denkt nach …`
      : `${label} denkt nach …`;
    const sessionId = provider === 'codex' ? codexSessionId : provider === 'openrouter' ? openRouterSessionId : provider === 'antigravity' ? agySessionId : claudeSessionId;
    const response = await fetch(PROVIDER_ENDPOINTS[provider], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId, contextNotes })
    });
    const result = await response.json();
    if (!response.ok) {
      pending.className = 'chat-message error';
      const saved = result.memorySaved === true
        ? 'Der Fehler wurde im lokalen Obsidian-Tagesprotokoll festgehalten.'
        : 'Der Fehler konnte nicht im lokalen Obsidian-Tagesprotokoll gesichert werden.';
      pending.textContent = `${result.error || 'Die Nachricht konnte nicht gesendet werden.'}\n\n${saved}`;
      setClaudeStatus('error', `${label}: Anfrage fehlgeschlagen`);
      return;
    }
    const activityText = Array.isArray(result.activity) && result.activity.length
      ? `\n\nVom Anbieter gemeldete Werkstatt-Aktivität:\n${result.activity.map((item) => `• ${item}`).join('\n')}`
      : '';
    const savedNote = result.memorySaved === false ? '\n\n⚠ Diese Antwort konnte nicht im Obsidian-Chatverlauf gesichert werden.' : '';
    if (window.IEMarkdown) window.IEMarkdown.renderInto(pending, `${result.reply}${savedNote}`, result.activity);
    else pending.textContent = `${result.reply}${activityText}${savedNote}`;
    if (provider === 'codex') codexSessionId = result.sessionId;
    else if (provider === 'openrouter') openRouterSessionId = result.sessionId;
    else if (provider === 'antigravity') agySessionId = result.sessionId;
    else claudeSessionId = result.sessionId;
    setClaudeStatus('ready', `${label} verbunden`);
  } catch (error) {
    pending.className = 'chat-message error';
    pending.textContent = error.message || 'Der lokale Claude-Dienst ist nicht erreichbar.';
    setClaudeStatus('error', 'Verbindung fehlgeschlagen');
  } finally {
    chatBusy = false;
    claudeSend.disabled = false;
    claudeQuestion.disabled = false;
    claudeQuestion.focus();
  }
}

async function checkClaudeBridge() {
  try {
    const response = await fetch('/api/status');
    const state = await response.json();
    if (state.ready) {
      claudeQuestion.disabled = false;
      claudeSend.disabled = false;
      chatHint.textContent = state.serverOutdated ? 'Neuere Werkstatt-Serverdatei: bitte im Serverfenster Strg+C drücken und den Starter erneut öffnen.' : 'Deine Nachricht wird über dein Claude-Max-Kontingent gesendet.';
      setClaudeStatus('ready', 'Claude Max angemeldet');
    } else {
      chatHint.textContent = state.message;
      setClaudeStatus('offline', state.message);
    }
  } catch {
    chatHint.textContent = 'Starte Workflow mit Start-Workflow.bat und öffne danach http://127.0.0.1:4180.';
    setClaudeStatus('offline', 'Lokale Verbindung nicht gestartet');
  }
}

async function checkCodexBridge() {
  try {
    const response = await fetch('/api/codex/status');
    const state = await response.json();
    codexReady = Boolean(state.ready);
    const teamState = document.querySelector('#codex-provider-state');
    if (teamState) {
      teamState.textContent = codexReady ? 'online' : 'offline';
      teamState.dataset.state = codexReady ? 'ready' : 'offline';
    }
    if (activeProvider === 'codex') {
      claudeQuestion.disabled = !codexReady;
      claudeSend.disabled = !codexReady;
      chatHint.textContent = codexReady ? (state.serverOutdated ? 'Neuere Werkstatt-Serverdatei: bitte im Serverfenster Strg+C drücken und den Starter erneut öffnen.' : 'Deine Nachricht wird über die angemeldete Codex CLI gesendet.') : state.message;
      setClaudeStatus(codexReady ? 'ready' : 'offline', state.message);
    }
  } catch {
    codexReady = false;
    const teamState = document.querySelector('#codex-provider-state');
    if (teamState) { teamState.textContent = 'offline'; teamState.dataset.state = 'offline'; }
  }
}

async function checkAntigravityBridge() {
  try {
    const response = await fetch('/api/antigravity/status');
    const state = await response.json();
    agyReady = Boolean(state.ready);
    if (activeProvider === 'antigravity') {
      claudeQuestion.disabled = !agyReady;
      claudeSend.disabled = !agyReady;
      chatHint.textContent = agyReady ? 'Über dein Google-Konto (Antigravity Starter-Kontingent). Plan-Modus: liest und plant, ändert nichts.' : state.message;
      setClaudeStatus(agyReady ? 'ready' : 'offline', state.message);
    }
  } catch {
    agyReady = false;
  }
}

async function checkOpenRouterBridge() {
  try {
    const response = await fetch('/api/openrouter/status');
    const state = await response.json();
    openRouterReady = Boolean(state.ready);
    if (activeProvider === 'openrouter') {
      claudeQuestion.disabled = !openRouterReady;
      claudeSend.disabled = !openRouterReady;
      chatHint.textContent = openRouterReady ? 'Kostenlos über OpenRouter (etwa 50 Anfragen pro Tag). Nur Antworten, keine Änderungen.' : state.message;
      setClaudeStatus(openRouterReady ? 'ready' : 'offline', state.message);
    }
  } catch {
    openRouterReady = false;
  }
}

providerSelect.addEventListener('change', () => {
  activeProvider = providerSelect.value;
  claudeMessages.replaceChildren();
  const selectedAgent = agentOf(activeProvider);
  const label = activeProvider === 'worky' ? 'Worky' : activeProvider === 'auto' ? 'dem KI-Team' : selectedAgent ? selectedAgent.name : PROVIDER_LABELS[activeProvider] || 'Claude';
  document.querySelector('#claude-chat')?.classList.toggle('worky-mode', activeProvider === 'worky');
  const ready = selectedAgent ? agentReady(selectedAgent) : activeProvider === 'codex' ? codexReady : activeProvider === 'openrouter' ? openRouterReady : activeProvider === 'antigravity' ? agyReady : claudeStatus.dataset.state !== 'offline';
  chatTitle.firstChild.textContent = `Mit `;
  providerDescription.textContent = selectedAgent
    ? selectedAgent.icon + ' ' + selectedAgent.name + ': ' + selectedAgent.title + '. Läuft über ' + (selectedAgent.engine === 'claude' ? 'Claude (dein Max-Kontingent)' : 'Antigravity (dein Google-Konto' + (selectedAgent.model ? ', Modell ' + selectedAgent.model : '') + ')') + (selectedAgent.write ? ' und darf Projektdateien ändern; Studio nur mit Freigabe.' : ' und ändert nichts.')
    : activeProvider === 'codex'
    ? 'Codex arbeitet im Repo und kann Roblox Studio lesen (nicht ändern).'
    : activeProvider === 'antigravity'
      ? 'Antigravity (Gemini) über dein Google-Konto: liest Projektdateien und sucht im Web, plant und erklärt – ändert aber nichts.'
    : activeProvider === 'openrouter'
      ? 'Kostenlose Reserve-KI über OpenRouter: bekommt Obsidian-Kontext, kann aber nur antworten – keine Dateien, kein Studio.'
    : activeProvider === 'worky'
      ? 'Worky ist dein Teamleiter: Kurze Fragen beantwortet er sofort (⚡ Schnell), Aufgaben gibt er einem seiner ' + (workyAgents.length || 16) + ' Spezialisten (🔬 Gründlich). Die Antwort erscheint live.'
    : activeProvider === 'auto'
      ? 'Die Werkstatt wählt pro Nachricht die passende KI (Code → Codex, Planung und Erklärungen → Claude) und sagt dir, wer antwortet.'
      : 'Claude kann Projektdateien im Repo bearbeiten. Befehle sind gesperrt; Roblox Studio ändern nur nach deiner Freigabe.';
  claudeQuestion.placeholder = `Schreib ${label}, was du bauen willst …`;
  document.querySelector('label[for="claude-question"]').textContent = `Deine Nachricht an ${label}`;
  claudeQuestion.disabled = !ready;
  claudeSend.disabled = !ready;
  addChatMessage('assistant', selectedAgent ? selectedAgent.icon + ' ' + selectedAgent.name + ' ist bereit.' : activeProvider === 'worky' ? 'Worky ist bereit. Frag mich alles – ich hole die passenden Spezialisten dazu.' : activeProvider === 'auto' ? 'Das KI-Team wartet auf deine Frage. Pro Nachricht wird die passende KI gewählt.' : `${label} wartet auf deine Frage. Der Verlauf ist separat pro Anbieter.`);
  if (activeProvider === 'worky') restoreWorkyChat();
  if (activeProvider === 'codex') void checkCodexBridge();
  else if (activeProvider === 'openrouter') void checkOpenRouterBridge();
  else if (activeProvider === 'antigravity') void checkAntigravityBridge();
  else void checkClaudeBridge();
});

claudeForm.addEventListener('submit', sendClaudeMessage);

const workyStop = document.querySelector('#worky-stop');
const workyQuickButtons = [...document.querySelectorAll('#worky-quick button[data-prompt]')];
function setWorkyRunning(running) {
  if (workyStop) workyStop.hidden = !running;
  for (const button of workyQuickButtons) button.disabled = running;
}

// Zeigt den gemerkten Worky-Chat wieder an; Worky selbst erinnert sich über die gespeicherte Sitzung
function restoreWorkyChat(chatId = null) {
  if (!workyChats.chats.length) loadWorkyChats();
  if (chatId) workyChats.activeId = chatId;
  renderChatPicker();
  const saved = activeWorkyChat();
  if (!saved || !Array.isArray(saved.messages) || !saved.messages.length) return;
  workyHistory = saved.messages.filter((entry) => entry && typeof entry.text === 'string').slice(-WORKY_CHAT_MAX);
  claudeSessionId = typeof saved.claudeSessionId === 'string' ? saved.claudeSessionId : null;
  for (const id of Object.keys(agentSessions)) delete agentSessions[id];
  if (saved.agentSessions && typeof saved.agentSessions === 'object') {
    for (const [id, sessionId] of Object.entries(saved.agentSessions)) if (typeof sessionId === 'string') agentSessions[id] = sessionId;
  }
  claudeMessages.replaceChildren();
  const note = document.createElement('div');
  note.className = 'worky-restored';
  note.textContent = 'Chat „' + saved.title + '“ · Worky erinnert sich daran. Für ein neues Thema: „Neuer Chat“.';
  claudeMessages.append(note);
  for (const entry of workyHistory) {
    if (entry.kind === 'user') { addChatMessage('user', entry.text); continue; }
    const bubble = workyBubble();
    const agent = workyAgents.find((item) => item.id === entry.agent);
    if (agent) {
      bubble.item.style.setProperty('--agent-color', agent.color);
      bubble.item.classList.add('has-agent');
      const name = document.createElement('span');
      name.className = 'worky-agent';
      name.textContent = agent.icon + ' ' + agent.name;
      bubble.item.querySelector('.worky-head').append(name);
    }
    if (window.IEMarkdown) window.IEMarkdown.renderInto(bubble.body, entry.text, Array.isArray(entry.activity) ? entry.activity : []);
    else bubble.body.textContent = entry.text;
  }
  claudeMessages.scrollTop = claudeMessages.scrollHeight;
}

workyStop?.addEventListener('click', () => { workyAbort?.abort(); });

// Neuer, leerer Chat (der bisherige bleibt in der Liste)
function startFreshWorkyChat() {
  workyHistory = [];
  claudeSessionId = null;
  for (const id of Object.keys(agentSessions)) delete agentSessions[id];
  workyChats.activeId = null;
  persistWorkyChats();
  renderChatPicker();
  claudeMessages.replaceChildren();
  addChatMessage('assistant', 'Neuer Chat. Worky ist bereit – worum geht es?');
}

const chatSelect = document.querySelector('#worky-chat-select');
const chatSearch = document.querySelector('#worky-chat-search');
function renderChatPicker() {
  if (!chatSelect) return;
  const query = (chatSearch?.value || '').trim().toLocaleLowerCase('de');
  const chats = [...workyChats.chats].sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((chat) => !query || chat.title.toLocaleLowerCase('de').includes(query) || chat.messages.some((entry) => String(entry.text).toLocaleLowerCase('de').includes(query)));
  chatSelect.replaceChildren();
  const current = document.createElement('option');
  current.value = '';
  current.textContent = activeWorkyChat() ? '💬 ' + activeWorkyChat().title : '✨ Neuer Chat';
  chatSelect.append(current);
  for (const chat of chats) {
    if (chat.id === workyChats.activeId) continue;
    const option = document.createElement('option');
    option.value = chat.id;
    option.textContent = chat.title + ' · ' + new Date(chat.updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' (' + chat.messages.length + ')';
    chatSelect.append(option);
  }
  if (query && chats.length === 0) {
    const none = document.createElement('option');
    none.disabled = true;
    none.textContent = 'Kein Chat enthält „' + chatSearch.value.trim() + '“';
    chatSelect.append(none);
  }
}
chatSelect?.addEventListener('change', () => {
  const id = chatSelect.value;
  if (!id) return;
  if (chatBusy) { addChatMessage('error', 'Worky arbeitet gerade. Wechsle den Chat, wenn er fertig ist (oder drück Stopp).'); renderChatPicker(); return; }
  saveWorkyChat();
  if (chatSearch) chatSearch.value = '';
  restoreWorkyChat(id);
});
chatSearch?.addEventListener('input', renderChatPicker);
document.querySelector('#worky-chat-delete')?.addEventListener('click', () => {
  const chat = activeWorkyChat();
  if (!chat || chatBusy) return;
  if (!window.confirm('Den Chat „' + chat.title + '“ löschen? Das lässt sich nicht rückgängig machen.')) return;
  workyChats.chats = workyChats.chats.filter((item) => item.id !== chat.id);
  startFreshWorkyChat();
});
// Werkzeug-Knöpfe: füllen nur das Eingabefeld vor, Timo ergänzt und sendet selbst
for (const button of document.querySelectorAll('[data-fill]')) {
  button.addEventListener('click', () => {
    if (activeProvider !== 'worky') { providerSelect.value = 'worky'; providerSelect.dispatchEvent(new Event('change')); }
    claudeQuestion.value = button.dataset.fill || '';
    claudeQuestion.focus();
    claudeQuestion.setSelectionRange(claudeQuestion.value.length, claudeQuestion.value.length);
    claudeQuestion.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
document.querySelector('#worky-new-chat')?.addEventListener('click', () => {
  if (chatBusy) return;
  startFreshWorkyChat();
  claudeQuestion.focus();
});
for (const button of workyQuickButtons) {
  button.addEventListener('click', () => {
    if (chatBusy) return;
    if (activeProvider !== 'worky') { providerSelect.value = 'worky'; providerSelect.dispatchEvent(new Event('change')); }
    if (claudeSend.disabled) return;
    claudeQuestion.value = button.dataset.prompt || '';
    claudeForm.requestSubmit();
  });
}
document.querySelector('#add-chat-context').addEventListener('click', () => contextFileInput.click());
contextFileInput.addEventListener('change', async () => {
  const files = [...(contextFileInput.files || [])];
  contextFileInput.value = '';
  for (const file of files) {
    if (!file.name.toLocaleLowerCase().endsWith('.md')) {
      addChatMessage('error', `${file.name}: Bitte nur Markdown-Dateien (.md) auswählen.`);
      continue;
    }
    if (selectedContextNotes.length >= MAX_CONTEXT_FILES) {
      addChatMessage('error', `Es können höchstens ${MAX_CONTEXT_FILES} zusätzliche Notizen gleichzeitig ausgewählt sein.`);
      break;
    }
    if (file.size > MAX_CONTEXT_FILE_CHARS * 4) {
      addChatMessage('error', `${file.name}: Die Notiz ist zu groß (maximal 20.000 Zeichen).`);
      continue;
    }
    const content = await file.text();
    if (content.length > MAX_CONTEXT_FILE_CHARS) {
      addChatMessage('error', `${file.name}: Die Notiz ist zu groß (maximal 20.000 Zeichen).`);
      continue;
    }
    const totalChars = selectedContextNotes.reduce((total, note) => total + note.content.length, 0);
    if (totalChars + content.length > MAX_CONTEXT_TOTAL_CHARS) {
      addChatMessage('error', 'Der gesamte Zusatzkontext darf höchstens 30.000 Zeichen umfassen.');
      continue;
    }
    if (selectedContextNotes.some((note) => note.name === file.name)) {
      addChatMessage('error', `${file.name} ist bereits ausgewählt.`);
      continue;
    }
    selectedContextNotes.push({ name: file.name, content });
  }
  renderContextNotes();
});
claudeQuestion.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) claudeForm.requestSubmit();
});
checkClaudeBridge();
checkCodexBridge();
checkOpenRouterBridge();
checkAntigravityBridge();
loadWorkyAgents().then(() => { if (activeProvider === 'worky') restoreWorkyChat(); });
window.IEVaultContext?.restoreHandle().then(async (handle) => {
  if (!handle) return;
  const permission = await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt');
  contextHint.textContent = permission === 'granted'
    ? `„${handle.name}“ verbunden. Bis zu vier passende Notizen werden lokal gesucht und nur relevante Auszüge mit deiner Frage gesendet.`
    : `„${handle.name}“ gespeichert; für Chat-Zugriff bitte den Tresor unter Obsidian erneut auswählen.`;
}).catch(() => {});
