// Worky lernt (Workflow Paket 4): Daumen, Lern-Vorschläge und Wissen für alle Projekte.
// Ehrlich: Das KI-Modell selbst lernt nicht. Worky wird schlauer, weil Gelerntes in Dateien steht, die er vor jeder
// Arbeit liest (docs/Stolpersteine.md, docs/Wissensdatenbank.md im Projekt, daten/wissen/Allgemein.md für alle).
// Nichts landet dort ohne Timos Klick auf „Übernehmen“.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const KINDS = { stolperstein: 'Fehler gemerkt', regel: 'Neue Regel', allgemein: 'Für alle Projekte' };
const LEARNED_HEADING = '## Von Worky gelernt';

export function createLearning(dataDir) {
  const storeFile = path.join(dataDir, 'lernen.json');
  const sharedFile = path.join(dataDir, 'wissen', 'Allgemein.md');

  function load() {
    try {
      const saved = JSON.parse(readFileSync(storeFile, 'utf8'));
      return {
        settings: { shareGeneral: saved.settings?.shareGeneral !== false, autoRound: saved.settings?.autoRound !== false },
        feedback: Array.isArray(saved.feedback) ? saved.feedback : [],
        proposals: Array.isArray(saved.proposals) ? saved.proposals : []
      };
    } catch {
      return { settings: { shareGeneral: true, autoRound: true }, feedback: [], proposals: [] };
    }
  }
  let store = load();
  function save() {
    // Nicht endlos wachsen lassen
    store.feedback = store.feedback.slice(-500);
    store.proposals = store.proposals.slice(-300);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(storeFile, JSON.stringify(store, null, 2), 'utf8');
  }

  const clip = (value, max) => String(value || '').replace(/\r/g, '').trim().slice(0, max);
  const today = () => new Date().toISOString().slice(0, 10);

  // Zeilen, die wie Einträge aussehen („- …“ oder Tabellenzeilen), so zählt auch Timos Tresor
  function countEntries(file) {
    try {
      return readFileSync(file, 'utf8').split('\n').filter((line) => /^(- |\| )/.test(line) && !/^\|\s*-/.test(line)).length;
    } catch { return 0; }
  }
  function countSkills(root) {
    try { return readdirSync(path.join(root, '.claude', 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length; } catch { return 0; }
  }
  // Fette Titel der vorhandenen Einträge, damit die Lern-Runde nichts doppelt vorschlägt
  function knownTitles(root) {
    const titles = [];
    for (const name of ['Stolpersteine.md', 'Wissensdatenbank.md']) {
      try {
        for (const line of readFileSync(path.join(root, 'docs', name), 'utf8').split('\n')) {
          const match = /^- \*\*(.+?)\*\*/.exec(line);
          if (match) titles.push(match[1].slice(0, 120));
        }
      } catch { /* Datei fehlt: nichts bekannt */ }
    }
    try {
      for (const line of readFileSync(sharedFile, 'utf8').split('\n')) {
        const match = /^- \*\*(.+?)\*\*/.exec(line);
        if (match) titles.push(match[1].slice(0, 120));
      }
    } catch { /* noch kein gemeinsames Wissen */ }
    return titles.slice(-120);
  }

  function sharedKnowledge(maxChars = 2500) {
    if (!store.settings.shareGeneral) return '';
    try {
      const lines = readFileSync(sharedFile, 'utf8').split('\n').filter((line) => line.startsWith('- '));
      let text = '';
      for (const line of lines.reverse()) {
        if (text.length + line.length > maxChars) break;
        text = line + '\n' + text;
      }
      return text.trim();
    } catch { return ''; }
  }

  function addFeedback(project, data) {
    const entry = {
      id: randomUUID(), project: project.id, rating: data.rating === 'down' ? 'down' : 'up',
      question: clip(data.question, 600), answer: clip(data.answer, 1500), note: clip(data.note, 600), at: new Date().toISOString()
    };
    store.feedback.push(entry);
    save();
    return entry;
  }

  // Prompt für die Lern-Runde: nur echte, konkrete Lehren aus genau diesem Lauf, als JSON
  function roundPrompt(project, data) {
    const rejected = store.proposals.filter((item) => item.project === project.id && item.status === 'abgelehnt').slice(-12).map((item) => `- ${item.titel}`);
    const known = knownTitles(project.root);
    return [
      `Du bist die Lern-Runde von Worky (KI-Assistent in Timos App Workflow) für das Projekt „${project.name}“ (${project.kindLabel}).`,
      'Schau dir den Auftrag unten an und entscheide, ob es daraus etwas zu lernen gibt, das beim nächsten Mal Zeit oder Fehler spart.',
      'Regeln:',
      '- Höchstens 2 Vorschläge. Gibt es nichts wirklich Neues, gib eine leere Liste zurück (das ist oft richtig).',
      '- Nur konkrete Lehren aus genau diesem Lauf (ein Fehler und seine Ursache, eine Regel, die ihn verhindert, ein Kniff, der geklappt hat). Keine allgemeinen Tipps wie „sorgfältig testen“.',
      '- Nichts erfinden: Was nicht aus dem Lauf hervorgeht, gehört nicht hinein.',
      '- art: „stolperstein“ (ein passierter Fehler mit Lösung), „regel“ (so machen wir es künftig in diesem Projekt) oder „allgemein“ (gilt für jedes Spiel, z. B. Luau, Git, Blender, Workflow-Bedienung).',
      '- titel: kurz, höchstens 12 Wörter. text: 1 bis 2 Sätze mit Regel oder Lösung. warum: 1 Satz Ursache. Alles auf Deutsch, einfache Sprache.',
      '- Schlag nichts vor, was schon bekannt ist oder was Timo abgelehnt hat (Listen unten).',
      'Antworte NUR mit JSON in genau dieser Form, ohne Text davor oder danach:',
      '{"vorschlaege":[{"art":"regel","titel":"…","text":"…","warum":"…"}]}',
      '',
      `Anlass: ${data.source === 'daumen' ? 'Timo hat die Antwort mit 👎 bewertet.' : data.source === 'fehler' ? 'Der Auftrag ist mit einem Fehler abgebrochen.' : 'Worky hat einen Auftrag erledigt und dabei Dateien geändert.'}`,
      ...(data.note ? [`Timos Kommentar: ${clip(data.note, 600)}`] : []),
      '',
      `Timos Auftrag:\n${clip(data.question, 1500)}`,
      '',
      `Worky hat geantwortet (gekürzt):\n${clip(data.answer, 3500)}`,
      ...(Array.isArray(data.activity) && data.activity.length ? ['', 'Was dabei passiert ist:', ...data.activity.slice(0, 30).map((item) => `- ${clip(item, 200)}`)] : []),
      ...(data.error ? ['', `Fehlermeldung: ${clip(data.error, 800)}`] : []),
      '',
      'SCHON BEKANNT (nicht nochmal vorschlagen):',
      ...(known.length ? known.map((title) => `- ${title}`) : ['- (noch nichts)']),
      '',
      'VON TIMO ABGELEHNT (nicht nochmal vorschlagen):',
      ...(rejected.length ? rejected : ['- (nichts)'])
    ].join('\n');
  }

  // Antwort der KI lesen: erstes {...} nehmen, Felder prüfen, Doppeltes aussortieren
  function addProposals(project, raw, source) {
    let parsed = null;
    const match = /\{[\s\S]*\}/.exec(String(raw || ''));
    if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = null; } }
    const list = Array.isArray(parsed?.vorschlaege) ? parsed.vorschlaege.slice(0, 2) : [];
    const known = new Set([...knownTitles(project.root), ...store.proposals.map((item) => item.titel)].map((title) => title.toLocaleLowerCase('de')));
    const added = [];
    for (const item of list) {
      const art = KINDS[item?.art] ? item.art : null;
      const titel = clip(item?.titel, 140).replace(/\*\*/g, '');
      const text = clip(item?.text, 500).replace(/\n+/g, ' ');
      if (!art || !titel || !text || known.has(titel.toLocaleLowerCase('de'))) continue;
      const proposal = {
        id: randomUUID(), project: project.id, projectName: project.name, art, titel, text,
        warum: clip(item?.warum, 300).replace(/\n+/g, ' '), source, status: 'offen', at: new Date().toISOString()
      };
      store.proposals.push(proposal);
      added.push(proposal);
    }
    if (added.length) save();
    return added;
  }

  async function appendUnderHeading(file, title, line) {
    let text = '';
    try { text = await readFile(file, 'utf8'); } catch { text = `# ${title}\n`; }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let addition = '';
    if (!text.endsWith('\n')) addition += eol;
    if (!text.includes(LEARNED_HEADING)) addition += `${eol}${LEARNED_HEADING}${eol}${eol}`;
    else if (!text.trimEnd().split(/\r?\n/).pop().startsWith('- ')) addition += eol;
    addition += line + eol;
    if (existsSync(file)) await appendFile(file, addition, 'utf8');
    else { mkdirSync(path.dirname(file), { recursive: true }); await writeFile(file, text + addition, 'utf8'); }
  }

  // Übernehmen: als Zeile in die passende Notiz; Ablehnen: merken, damit es nicht wiederkommt
  async function decide(id, take, projects) {
    const proposal = store.proposals.find((item) => item.id === id && item.status === 'offen');
    if (!proposal) throw Object.assign(new Error('Diesen Vorschlag gibt es nicht mehr.'), { status: 404 });
    if (take) {
      const warum = proposal.warum ? ` *Warum:* ${proposal.warum}` : '';
      if (proposal.art === 'allgemein') {
        await appendUnderHeading(sharedFile, 'Wissen für alle Projekte', `- **${proposal.titel}** – ${proposal.text}${warum} *Gelernt:* ${today()} in ${proposal.projectName}.`);
      } else {
        const project = projects.find((item) => item.id === proposal.project);
        if (!project || !existsSync(project.root)) throw Object.assign(new Error('Das Projekt dieses Vorschlags ist nicht mehr da.'), { status: 409 });
        const file = proposal.art === 'stolperstein' ? 'Stolpersteine.md' : 'Wissensdatenbank.md';
        await appendUnderHeading(path.join(project.root, 'docs', file), file.replace('.md', ''), `- **${proposal.titel}** – ${proposal.text}${warum} *Gelernt:* ${today()} (Worky-Lern-Runde).`);
      }
    }
    proposal.status = take ? 'uebernommen' : 'abgelehnt';
    proposal.decidedAt = new Date().toISOString();
    save();
    return proposal;
  }

  function overview(project, agentCount) {
    const mine = (item) => item.project === project.id || item.art === 'allgemein';
    let shared = [];
    try { shared = readFileSync(sharedFile, 'utf8').split('\n').filter((line) => line.startsWith('- ')).slice(-12).reverse(); } catch { shared = []; }
    const feedback = store.feedback.filter((item) => item.project === project.id);
    return {
      settings: store.settings,
      kinds: KINDS,
      stats: {
        fehler: countEntries(path.join(project.root, 'docs', 'Stolpersteine.md')),
        regeln: countEntries(path.join(project.root, 'docs', 'Wissensdatenbank.md')),
        faehigkeiten: countSkills(project.root),
        spezialisten: agentCount,
        daumenHoch: feedback.filter((item) => item.rating === 'up').length,
        daumenRunter: feedback.filter((item) => item.rating === 'down').length
      },
      proposals: store.proposals.filter((item) => item.status === 'offen' && mine(item)).reverse(),
      learned: store.proposals.filter((item) => item.status === 'uebernommen' && mine(item)).slice(-8).reverse(),
      shared
    };
  }

  function setSettings(data) {
    if (typeof data.shareGeneral === 'boolean') store.settings.shareGeneral = data.shareGeneral;
    if (typeof data.autoRound === 'boolean') store.settings.autoRound = data.autoRound;
    save();
    return store.settings;
  }

  const openCount = (project) => store.proposals.filter((item) => item.status === 'offen' && (item.project === project.id || item.art === 'allgemein')).length;

  return { addFeedback, roundPrompt, addProposals, decide, overview, setSettings, sharedKnowledge, openCount, settings: () => store.settings };
}
