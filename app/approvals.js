// Freigaben-Leiste: zeigt, was eine KI gerade tun will (z. B. Roblox Studio ändern), und lässt
// Timo „Erlauben“ oder „Ablehnen“ klicken. Ohne Klick lehnt der Server nach 4 Minuten ab.
(() => {
  const POLL_MS = 1500;
  const panel = document.createElement('aside');
  panel.className = 'approval-dock';
  panel.setAttribute('aria-live', 'polite');
  panel.hidden = true;
  document.body.append(panel);

  const shown = new Map();
  const decided = new Set();

  const friendlyTool = (name) => {
    const short = name.replace(/^mcp__Roblox_Studio__/, 'Roblox Studio · ').replace(/^mcp__blender__/, 'Blender · ').replace(/^mcp__/, '');
    const labels = {
      'Blender · execute_blender_code': 'Blender · Python-Code ausführen (vorher Strg+S!)',
      'Blender · execute_blender_code_for_cli': 'Blender · Code in einem Hintergrund-Blender ausführen',
      'Blender · render_viewport_to_path': 'Blender · Bild rendern und speichern',
      'Blender · render_thumbnail_to_path': 'Blender · kleines Vorschaubild rendern',
      'Roblox Studio · execute_luau': 'Roblox Studio · Luau-Code ausführen',
      'Roblox Studio · start_stop_play': 'Roblox Studio · Play starten/stoppen',
      'Roblox Studio · multi_edit': 'Roblox Studio · Skripte ändern',
      'Roblox Studio · insert_asset': 'Roblox Studio · Asset einfügen',
      'Roblox Studio · generate_mesh': 'Roblox Studio · 3D-Modell per KI erzeugen',
      'Roblox Studio · generate_procedural_model': 'Roblox Studio · Bauteil-Modell per KI erzeugen (mit Reglern)',
      'Roblox Studio · generate_material': 'Roblox Studio · Material per KI erzeugen',
      'Roblox Studio · generate_texture': 'Roblox Studio · Modell per KI neu texturieren (ersetzt das Original!)',
      'Roblox Studio · upload_image': 'Roblox Studio · Bild bei Roblox hochladen'
    };
    return labels[short] || short;
  };

  const secondsLeft = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000));

  async function decide(id, decision, card) {
    decided.add(id);
    card.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      const response = await fetch('/api/approvals/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Die Entscheidung konnte nicht gesendet werden.');
      if (typeof showToast === 'function') showToast(decision === 'allow' ? 'Erlaubt.' : 'Abgelehnt.');
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message);
    }
    void refresh();
  }

  function render(approvals) {
    const openIds = new Set(approvals.map((item) => item.id));
    for (const [id, card] of shown) {
      if (!openIds.has(id)) { card.remove(); shown.delete(id); }
    }
    for (const item of approvals) {
      let card = shown.get(item.id);
      if (!card) {
        card = document.createElement('section');
        card.className = 'approval-card';
        const head = document.createElement('div');
        head.className = 'approval-head';
        const title = document.createElement('strong');
        title.textContent = `${item.provider} möchte: ${friendlyTool(item.toolName)}`;
        const timer = document.createElement('small');
        timer.className = 'approval-timer';
        head.append(title, timer);
        const details = document.createElement('pre');
        details.textContent = item.input || '{}';
        const actions = document.createElement('div');
        actions.className = 'approval-actions';
        const deny = document.createElement('button');
        deny.type = 'button';
        deny.className = 'outline-button';
        deny.textContent = 'Ablehnen';
        deny.addEventListener('click', () => decide(item.id, 'deny', card));
        const allow = document.createElement('button');
        allow.type = 'button';
        allow.className = 'primary-button';
        allow.textContent = 'Erlauben';
        allow.addEventListener('click', () => decide(item.id, 'allow', card));
        if (item.truncated) {
          // Zu lang, um alles zu sehen: nicht blind erlauben, lieber Worky um kleinere Schritte bitten
          allow.disabled = true;
          allow.title = 'Zu lang zum Prüfen. Ablehnen und Worky um kleinere Schritte bitten.';
        }
        actions.append(deny, allow);
        card.append(head, details, actions);
        panel.append(card);
        shown.set(item.id, card);
      }
      const seconds = secondsLeft(item.expiresAt);
      card.querySelector('.approval-timer').textContent = `noch ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} – sonst abgelehnt`;
    }
    panel.hidden = shown.size === 0;
  }

  async function refresh() {
    try {
      const response = await fetch('/api/approvals', { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      render(Array.isArray(result.approvals) ? result.approvals.filter((item) => !decided.has(item.id)) : []);
    } catch { /* Server kurz weg (z. B. Neustart): beim nächsten Durchlauf wieder */ }
  }

  void refresh();
  window.setInterval(refresh, POLL_MS);
})();
