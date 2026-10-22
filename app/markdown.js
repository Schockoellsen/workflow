// Kleiner, sicherer Markdown-Darsteller für KI-Antworten in der Werkstatt.
// Erst wird ALLES escaped, dann werden nur bekannte Muster (Überschriften, Listen, Code, fett, kursiv,
// Links mit http/https) in Elemente umgewandelt. Kein HTML aus der Antwort wird je ausgeführt.
(() => {
  const escapeHtml = (text) => String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function inline(text) {
    // text ist bereits escaped
    const codes = [];
    let out = text.replace(/`([^`\n]+)`/g, (_, code) => { codes.push(code); return `\u0000${codes.length - 1}\u0000`; });
    out = out
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return out.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
  }

  function render(markdown) {
    const lines = escapeHtml(String(markdown || '').replace(/\r\n/g, '\n')).split('\n');
    const html = [];
    let list = null; // 'ul' | 'ol'
    let paragraph = [];
    const flushParagraph = () => { if (paragraph.length) { html.push(`<p>${inline(paragraph.join('<br>'))}</p>`); paragraph = []; } };
    const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
      if (fence) {
        flushParagraph(); closeList();
        const body = [];
        i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1; }
        const lang = fence[1] ? `<span class="md-lang">${fence[1]}</span>` : '';
        html.push(`<div class="md-code">${lang}<pre><code>${body.join('\n')}</code></pre></div>`);
        continue;
      }
      // Tabelle: | a | b | mit Trennzeile |---|---|
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flushParagraph(); closeList();
        const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => inline(cell.trim()));
        const head = cells(line);
        const rows = [];
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i += 1; }
        i -= 1;
        html.push(`<div class="md-table"><table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) { flushParagraph(); closeList(); const level = Math.min(heading[1].length + 2, 6); html.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
      const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (bullet || numbered) {
        flushParagraph();
        const kind = bullet ? 'ul' : 'ol';
        if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
        html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
        continue;
      }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushParagraph(); closeList(); html.push('<hr>'); continue; }
      const quote = line.match(/^&gt;\s?(.*)$/);
      if (quote) { flushParagraph(); closeList(); html.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
      if (!line.trim()) { flushParagraph(); closeList(); continue; }
      closeList();
      paragraph.push(line);
    }
    flushParagraph(); closeList();
    return html.join('');
  }

  // Setzt formatierten Inhalt in ein Element; die Liste der Aktivitäten kommt als kleiner Kasten darunter.
  function renderInto(element, markdown, activity) {
    element.classList.add('md');
    let html = render(markdown);
    if (Array.isArray(activity) && activity.length) {
      html += `<div class="md-activity"><span>Was dabei passiert ist</span><ul>${activity.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
    }
    element.innerHTML = html;
    // UI-Entwürfe von Worky (/entwuerfe/<name>.html) als Vorschau einbetten (abgeschottet, ohne Skripte)
    const mockups = [...new Set((element.textContent.match(/\/entwuerfe\/[A-Za-z0-9_-]{1,60}\.html/g) || []))].slice(0, 3);
    for (const mockup of mockups) {
      const frame = document.createElement('iframe');
      frame.src = mockup;
      frame.className = 'md-mockup';
      frame.title = 'UI-Entwurf ' + mockup;
      frame.setAttribute('sandbox', '');
      frame.loading = 'lazy';
      const open = document.createElement('a');
      open.href = mockup;
      open.target = '_blank';
      open.rel = 'noopener';
      open.className = 'md-mockup-link';
      open.textContent = 'Entwurf groß öffnen ↗';
      element.append(frame, open);
    }
    // Sound-Vorschauen (Freesound-mp3) bekommen einen kleinen Abspieler
    for (const link of element.querySelectorAll('a[href^="https://cdn.freesound.org/previews/"], a[href^="https://freesound.org/data/previews/"]')) {
      if (!/\.mp3$/i.test(link.getAttribute('href') || '')) continue;
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'none';
      audio.src = link.href;
      audio.className = 'md-audio';
      link.after(audio);
    }
  }

  window.IEMarkdown = { render, renderInto };
})();
