(() => {
  const DB_NAME = 'industrial-empire-workshop-vault';
  const STORE_NAME = 'handles';
  const HANDLE_KEY = 'active-vault';
  const MAX_FILES = 600;
  const MAX_INDEX_CHARS = 20_000_000;
  const MAX_DEPTH = 8;
  const MAX_FILE_BYTES = 160_000;
  const MAX_NOTES = 4;
  const MAX_TOTAL_CHARS = 10_000;
  const MAX_EXCERPT_CHARS = 4_000;
  const ignoredFolders = new Set(['.obsidian', '.trash', '.git', 'node_modules', 'werkstatt-chatverlauf']);
  let noteCache = null;
  let cacheVaultName = '';
  let cacheTime = 0;
  let cachedScannedCount = 0;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeHandle(handle) {
    noteCache = null;
    cachedScannedCount = 0;
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }

  async function restoreHandle() {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(HANDLE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  async function permission(handle) {
    try { return await handle.queryPermission({ mode: 'read' }) === 'granted'; }
    catch { return false; }
  }

  function termsFor(query) {
    const ignored = new Set(['aber', 'alle', 'auch', 'bitte', 'dann', 'dass', 'dein', 'deine', 'dies', 'eine', 'einer', 'einem', 'einen', 'hier', 'kann', 'kannst', 'machen', 'mein', 'meine', 'mich', 'noch', 'oder', 'sein', 'soll', 'und', 'uns', 'was', 'wenn', 'wird', 'wie']);
    return [...new Set((query.toLocaleLowerCase('de').match(/[\p{L}\p{N}]{3,}/gu) || []).filter((term) => !ignored.has(term)))];
  }

  function excerpt(content, terms) {
    const blocks = content.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
    const ranked = blocks.map((text, index) => {
      const lower = text.toLocaleLowerCase('de');
      const score = terms.reduce((sum, term) => sum + Math.min(lower.split(term).length - 1, 5), 0);
      return { text, index, score };
    }).filter((block) => block.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    const chosen = [];
    let length = 0;
    for (const block of ranked) {
      const remaining = MAX_EXCERPT_CHARS - length;
      if (remaining <= 0) break;
      const text = block.text.slice(0, remaining);
      chosen.push({ index: block.index, text });
      length += text.length + 2;
    }
    return chosen.sort((a, b) => a.index - b.index).map((block) => block.text).join('\n\n');
  }

  function redactSensitiveText(content) {
    return content
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[privater Schlüssel ausgelassen]')
      .replace(/\b(authorization\s*:\s*bearer|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwort|secret)\s*[:=]\s*["']?[^\s"'`,;]+/gi, '$1=[Wert ausgelassen]');
  }

  async function relevantNotes(query, excludedNames = []) {
    let handle;
    try { handle = await restoreHandle(); }
    catch { return { notes: [], reason: 'storage-unavailable' }; }
    if (!handle || !await permission(handle)) return { notes: [], reason: 'permission' };
    const terms = termsFor(query);
    if (!terms.length) return { notes: [], reason: 'no-search-terms' };

    const cacheValid = noteCache && cacheVaultName === handle.name && Date.now() - cacheTime < 60_000;
    const candidates = cacheValid ? noteCache : [];
    let visited = cacheValid ? cachedScannedCount : 0;
    let indexedChars = 0;
    async function walk(directory, prefix = '', depth = 0, output = []) {
      if (depth > MAX_DEPTH || visited >= MAX_FILES) return;
      for await (const [name, entry] of directory.entries()) {
        if (visited >= MAX_FILES) break;
        if (entry.kind === 'directory') {
          if (!ignoredFolders.has(name.toLocaleLowerCase('de'))) await walk(entry, prefix ? `${prefix}/${name}` : name, depth + 1, output);
          continue;
        }
        if (entry.kind !== 'file' || !name.toLocaleLowerCase('de').endsWith('.md')) continue;
        visited += 1;
        try {
          const file = await entry.getFile();
          if (file.size > MAX_FILE_BYTES || indexedChars + file.size > MAX_INDEX_CHARS) continue;
          const content = await file.text();
          indexedChars += content.length;
          const noteName = prefix ? `${prefix}/${name}` : name;
          const lower = content.toLocaleLowerCase('de');
          const title = noteName.toLocaleLowerCase('de');
          output.push({ name: noteName, content, lower, title });
        } catch { /* Eine gesperrte oder gelöschte Einzelnotiz überspringen. */ }
      }
    }

    if (!cacheValid) {
      visited = 0;
      const scanned = [];
      try { await walk(handle, '', 0, scanned); }
      catch { return { notes: [], reason: 'read-failed' }; }
      noteCache = scanned;
      cacheVaultName = handle.name;
      cacheTime = Date.now();
      cachedScannedCount = visited;
      candidates.splice(0, candidates.length, ...scanned);
    }

    const ranked = candidates.filter((note) => !excludedNames.includes(note.name)).map((note) => {
      let score = 0;
      for (const term of terms) {
        if (note.title.includes(term)) score += 8;
        score += Math.min(note.lower.split(term).length - 1, 8);
      }
      return { ...note, score };
    }).filter((note) => note.score > 0).sort((a, b) => b.score - a.score);
    let remaining = MAX_TOTAL_CHARS;
    const notes = [];
    for (const candidate of ranked) {
      if (notes.length >= MAX_NOTES || remaining < 300) break;
      const content = redactSensitiveText(excerpt(candidate.content, terms)).slice(0, Math.min(MAX_EXCERPT_CHARS, remaining));
      if (!content) continue;
      notes.push({ name: candidate.name, content });
      remaining -= content.length;
    }
    return {
      notes,
      reason: visited >= MAX_FILES ? 'file-limit' : 'ok',
      vaultName: handle.name,
      noteCount: candidates.length,
      scannedCount: visited
    };
  }

  window.IEVaultContext = { storeHandle, restoreHandle, relevantNotes };
})();
