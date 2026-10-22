async function openWorkshopApp(button, endpoint, label) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = `${label} wird geöffnet …`;
  try {
    const response = await fetch(endpoint, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `${label} konnte nicht geöffnet werden.`);
    showToast(`${label} geöffnet.`);
  } catch (error) {
    showToast(error.message || `${label} konnte nicht geöffnet werden.`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.querySelector('#open-studio').addEventListener('click', (event) => {
  void openWorkshopApp(event.currentTarget, '/api/open/studio', 'Industrial Empire in Roblox Studio');
});

document.querySelector('#open-rojo').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Rojo startet …';
  try {
    const response = await fetch('/api/open/rojo', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Rojo konnte nicht gestartet werden.');
    showToast(result.alreadyRunning
      ? `Rojo läuft bereits unter ${result.address}. Verbinde das Rojo-Plugin in Studio.`
      : `Rojo läuft unter ${result.address}. Verbinde jetzt das Rojo-Plugin in Studio.`);
  } catch (error) {
    showToast(error.message || 'Rojo konnte nicht gestartet werden.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

document.querySelector('#open-obsidian').addEventListener('click', (event) => {
  void openWorkshopApp(event.currentTarget, '/api/open/obsidian', 'Obsidian');
});

document.querySelector('#open-blender').addEventListener('click', (event) => {
  void openWorkshopApp(event.currentTarget, '/api/open/blender', 'Blender');
});

document.querySelector('#open-github').addEventListener('click', (event) => {
  void openWorkshopApp(event.currentTarget, '/api/open/github', 'GitHub Desktop');
});
