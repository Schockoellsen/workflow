// Stichwort-Regel für den Chat (Auswahl „Automatisch“ und Worky): welche KI passt zu einer Frage.
// Die frühere „KI-Empfehlung“ im Inspektor ist seit 2026-10-21 der Prompt-Ersteller (unten).
function chooseProvider(question) {
  const text = question.toLocaleLowerCase('de');
  const imageIntent = /bild|bild(er)?gener|mock.?up|referenzbild|visual|grafik|icon|illustration|wie soll .* aussehen|design.?entwurf/.test(text);
  const codeIntent = /luau|script|skript|code|programm|bug|fehler|remote|datastore|funktion|server|client|debug|implementier|datei/.test(text);
  const reviewIntent = /pr[uü]f|review|analys|passt .* code|sicher|architektur|datenfluss/.test(text);
  const ideaIntent = /idee|plan|konzept|spielgef[uü]hl|roadmap|verbesser|maschine|fabrik|produktion|system/.test(text);

  if (imageIntent) return {
    provider: 'ChatGPT Images', key: 'images', symbol: '◉',
    reason: 'Deine Frage zielt auf ein Bild oder einen visuellen Entwurf. ChatGPT Images passt dafür; nutze das Ergebnis zuerst als Referenz, nicht als fertiges Roblox-Asset.',
    second: 'Claude kann danach den Entwurf mit docs/Kunst-Bibel.md und docs/Designsystem.md abgleichen.',
    role: 'Erstelle einen visuellen Konzeptentwurf oder bearbeite das beigefügte Referenzbild. Halte dich an die Stilregeln in docs/Kunst-Bibel.md und docs/Designsystem.md, sofern sie dir vorliegen. Das Ergebnis ist eine prüfbare Referenz, kein automatisch integriertes Roblox-Asset. Wenn du die Notizen nicht lesen kannst, frage danach und erfinde keine Stilregeln.'
  };
  if (codeIntent && reviewIntent) return {
    provider: 'Codex', key: 'codex', symbol: '⌘',
    reason: 'Du bittest um eine Code- oder Architekturprüfung. Codex ist als Prüfer vorgeschlagen; Claude kann zusätzlich den bisherigen Spielkontext abgleichen.',
    second: 'Claude — Kontextprüfung anhand der Projektregeln.',
    role: 'Prüfe den beschriebenen Code- oder Architekturvorschlag. Lies zuerst die betroffenen Dateien und docs/Technik.md. Liste konkrete Belege mit Pfaden und Zeilen, Risiken und Widersprüche auf. Ändere keine Dateien und führe keine Befehle oder Tests aus. Schlage nötige Prüfungen nur als Plan vor.'
  };
  if (codeIntent) return {
    provider: 'Codex', key: 'codex', symbol: '⌘',
    reason: 'Du fragst nach Luau, Code oder einer Umsetzung. Codex ist für den konkreten Codevorschlag vorgeschlagen; Claude kann als Zweitprüfer dienen.',
    second: 'Claude — prüft, ob der Vorschlag zum bestehenden Spiel passt.',
    role: 'Untersuche den Auftrag im bestehenden Industrial-Empire-Projekt. Lies zuerst relevante Dateien und docs/Technik.md. Erstelle zunächst nur einen Plan mit betroffenen Pfaden, vorgeschlagenen Änderungen, geschützter Spiellogik, Risiken, Prüfung und Rückweg. Ändere keine Dateien und führe keine Skripte, Builds oder Tests aus. Warte auf ausdrückliche Freigabe.'
  };
  if (ideaIntent) return {
    provider: 'Claude', key: 'claude', symbol: 'C',
    reason: 'Du planst eine Spielidee oder ein System. Claude kennt den bisherigen Projektkontext; Gemini kann anschließend eine zweite Perspektive liefern.',
    second: 'Gemini — optionale zweite Meinung zu Alternativen und Spielerlebnis.',
    role: 'Hilf, die Idee verständlich und passend zu Industrial Empire zu planen. Nutze die vorhandene Vision, Roadmap und passenden Obsidian-Notizen. Trenne klar zwischen vorhandenem Code, Empfehlung und Vermutung. Bewahre bestehende Spiellogik. Erstelle Aufgaben nur als Entwürfe; ändere keine Dateien und warte auf Freigabe.'
  };
  return {
    provider: 'Claude', key: 'claude', symbol: 'C',
    reason: 'Für eine allgemeine Frage zum vorhandenen Spiel passt Claude als erklärender Tutor. Gemini kann bei Bedarf eine zweite Erklärung geben.',
    second: 'Gemini — optionale alternative Erklärung.',
    role: 'Erkläre deine Antwort in einfachem Deutsch und beziehe sie auf Industrial Empire. Trenne direkte Belege aus Projektdateien von Empfehlungen und Vermutungen. Erkläre Fachbegriffe. Ändere keine Dateien und führe keine Skripte oder Tests aus.'
  };
}

// ===== Prompt-Ersteller: Wunsch eingeben, Ziel wählen, fertigen Prompt bekommen (Server: POST /api/prompt) =====
const promptWish = document.querySelector('#prompt-wish');
const promptTarget = document.querySelector('#prompt-target');
const promptBuild = document.querySelector('#prompt-build');
const promptStatus = document.querySelector('#prompt-status');
const promptResultBox = document.querySelector('#prompt-result-box');
const promptResult = document.querySelector('#prompt-result');
const promptToWorky = document.querySelector('#prompt-to-worky');

async function buildPrompt() {
  const wish = promptWish.value.trim();
  if (!wish) { promptWish.focus(); return; }
  promptBuild.disabled = true;
  promptStatus.textContent = 'Claude schreibt deinen Prompt … (etwa 10–20 Sekunden)';
  try {
    const response = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wish, target: promptTarget.value })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Der Prompt konnte nicht erstellt werden.');
    promptResult.value = result.prompt;
    promptResultBox.hidden = false;
    // Nur Worky-Aufträge kann man direkt an Worky geben; die anderen gehören in das jeweilige Werkzeug
    promptToWorky.hidden = promptTarget.value !== 'worky';
    promptStatus.textContent = 'Fertig: Prompt für ' + result.label + '.';
    promptResultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    promptStatus.textContent = error.message || 'Der Prompt konnte nicht erstellt werden.';
  } finally {
    promptBuild.disabled = false;
  }
}

promptBuild.addEventListener('click', buildPrompt);
promptWish.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) buildPrompt();
});

document.querySelector('#prompt-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(promptResult.value);
    showRouteToast('Prompt kopiert.');
  } catch {
    promptResult.focus();
    promptResult.select();
    showRouteToast('Prompt markiert. Kopiere ihn mit Strg+C.');
  }
});

// Legt den Prompt ins Worky-Eingabefeld; Timo schickt ihn selbst ab
promptToWorky.addEventListener('click', () => {
  const select = document.querySelector('#chat-provider');
  if (select && select.value !== 'worky') { select.value = 'worky'; select.dispatchEvent(new Event('change')); }
  const question = document.querySelector('#claude-question');
  question.value = promptResult.value.slice(0, 6000);
  question.focus();
  question.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showRouteToast('Prompt liegt im Worky-Eingabefeld. Prüfen und auf Senden drücken.');
});

function showRouteToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2500);
}
