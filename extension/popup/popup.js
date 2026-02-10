(function() {
  'use strict';

  async function applyMonkeyTypeTheme() {
    const api = getBrowserAPI();
    if (!api) return;
    const result = await api.storage.local.get(THEME_STORAGE_KEY);
    const theme = result[THEME_STORAGE_KEY];
    if (!theme || typeof theme !== 'object') return;
    const root = document.documentElement;
    Object.entries(theme).forEach(([key, value]) => {
      if (value) root.style.setProperty('--' + key, value);
    });
  }

  let currentTab = 'slow';
  let data = null;

  function showMainView() {
    document.getElementById('main-view').classList.remove('hidden');
    document.getElementById('export-view').classList.add('hidden');
  }

  function showExportView() {
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('export-view').classList.remove('hidden');
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('active', c.id === `tab-${tab}`);
    });
  }

  function el(tag, className, textContent) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (textContent !== undefined) e.textContent = textContent;
    return e;
  }

  function renderSlowWords() {
    const container = document.getElementById('slow-words');
    const settings = data.settings || {};
    const minSamples = settings.minSamples || 1;
    const wordsToShow = settings.wordsToShow || 50;

    const entries = Object.entries(data.slowWords || {})
      .filter(([_, d]) => d && d.samples && d.samples.length >= minSamples)
      .sort((a, b) => a[1].avgSpeed - b[1].avgSpeed)
      .slice(0, wordsToShow);

    if (entries.length === 0) {
      const empty = el('div', 'empty', 'no slow words tracked yet');
      container.replaceChildren(empty);
      return;
    }

    const speeds = entries.map(([_, d]) => d.avgSpeed);
    const minSpeed = Math.min(...speeds);
    const maxSpeed = Math.max(...speeds);
    const range = maxSpeed - minSpeed || 1;

    const fragment = document.createDocumentFragment();
    entries.forEach(([word, stats], index) => {
      const normalized = (stats.avgSpeed - minSpeed) / range;
      const speedClass = normalized < 0.33 ? 'slow' : normalized > 0.66 ? 'fast' : '';
      const item = el('div', 'word-item');
      item.dataset.word = word;
      item.dataset.index = String(index);
      item.appendChild(el('span', 'word-text', word));
      const statSpan = el('span', 'word-stat ' + speedClass, stats.avgSpeed.toFixed(0) + ' wpm (' + stats.count + 'x)');
      item.appendChild(statSpan);
      const delBtn = el('button', 'delete-btn');
      delBtn.title = 'Remove word';
      delBtn.textContent = '×';
      item.appendChild(delBtn);
      fragment.appendChild(item);
    });
    container.replaceChildren(fragment);
  }

  function renderErrorWords() {
    const container = document.getElementById('error-words');
    const wordsToShow = (data.settings || {}).wordsToShow || 50;

    const entries = Object.entries(data.erroredWords || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, wordsToShow);

    if (entries.length === 0) {
      const empty = el('div', 'empty', 'no error words tracked yet');
      container.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    entries.forEach(([word, count], index) => {
      const item = el('div', 'word-item');
      item.dataset.word = word;
      item.dataset.index = String(index);
      item.appendChild(el('span', 'word-text', word));
      item.appendChild(el('span', 'word-stat', count + ' error' + (count > 1 ? 's' : '')));
      const delBtn = el('button', 'delete-btn');
      delBtn.title = 'Remove word';
      delBtn.textContent = '×';
      item.appendChild(delBtn);
      fragment.appendChild(item);
    });
    container.replaceChildren(fragment);
  }

  function renderSettings() {
    const settings = data.settings || {};
    document.getElementById('words-to-show').value = settings.wordsToShow || 50;
    document.getElementById('min-samples').value = settings.minSamples || 1;
    document.getElementById('slow-word-history-count').value = settings.slowWordHistoryCount ?? 50;
    const disableCustom = document.getElementById('disable-tracking-custom');
    if (disableCustom) disableCustom.checked = settings.disableTrackingInCustomMode !== false;

    document.getElementById('stat-slow').textContent = Object.keys(data.slowWords || {}).length;
    document.getElementById('stat-errors').textContent = Object.keys(data.erroredWords || {}).length;
    
    if (data.lastUpdate) {
      const date = new Date(data.lastUpdate);
      document.getElementById('stat-updated').textContent = date.toLocaleString();
    } else {
      document.getElementById('stat-updated').textContent = 'never';
    }
  }

  async function render() {
    data = await storage.get();
    renderSlowWords();
    renderErrorWords();
    renderSettings();
  }

  function copyWords(type) {
    const words = type === 'slow'
      ? Object.entries(data.slowWords || {})
          .filter(([_, d]) => d.samples && d.samples.length >= (data.settings?.minSamples || 1))
          .sort((a, b) => a[1].avgSpeed - b[1].avgSpeed)
          .slice(0, data.settings?.wordsToShow || 50)
          .map(([word]) => word)
      : Object.entries(data.erroredWords || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, data.settings?.wordsToShow || 50)
          .map(([word]) => word);

    if (words.length === 0) {
      showStatus('no words to copy', 'error');
      return;
    }

    navigator.clipboard.writeText(words.join(' ')).then(() => {
      showStatus(`copied ${words.length} words`, 'success');
    }).catch(() => {
      showStatus('failed to copy', 'error');
    });
  }

  async function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weakwords-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus('data exported', 'success');
  }

  async function importData(file) {
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      
      if (!imported.slowWords && !imported.erroredWords) {
        throw new Error('invalid format');
      }

      await storage.set({
        ...data,
        slowWords: { ...data.slowWords, ...imported.slowWords },
        erroredWords: { ...data.erroredWords, ...imported.erroredWords },
        lastUpdate: Date.now()
      });
      
      await render();
      showStatus('data imported', 'success');
    } catch (e) {
      showStatus('import failed: ' + e.message, 'error');
    }
  }

  async function clearData() {
    if (await confirmClearAllData()) {
      await storage.set({
        slowWords: {},
        erroredWords: {},
        settings: data.settings,
        lastUpdate: Date.now()
      });
      
      await render();
      showStatus('all data cleared', 'success');
    }
  }

  async function clearSlowWords() {
    if (await confirmClearList('slow')) {
      await storage.set({
        ...data,
        slowWords: {},
        lastUpdate: Date.now()
      });
      
      await render();
      showStatus('slow words cleared', 'success');
    }
  }

  async function clearErrorWords() {
    if (await confirmClearList('error')) {
      await storage.set({
        ...data,
        erroredWords: {},
        lastUpdate: Date.now()
      });
      
      await render();
      showStatus('error words cleared', 'success');
    }
  }

  async function saveSettings() {
    const wordsToShow = parseInt(document.getElementById('words-to-show').value) || 50;
    const minSamples = parseInt(document.getElementById('min-samples').value) || 1;
    const slowWordHistoryCount = parseInt(document.getElementById('slow-word-history-count').value) || 50;
    const disableCustomEl = document.getElementById('disable-tracking-custom');
    const disableTrackingInCustomMode = disableCustomEl ? disableCustomEl.checked : true;

    data.settings = {
      ...data.settings,
      wordsToShow: Math.max(5, Math.min(200, wordsToShow)),
      minSamples: Math.max(1, Math.min(10, minSamples)),
      slowWordHistoryCount: Math.max(1, Math.min(500, slowWordHistoryCount)),
      disableTrackingInCustomMode
    };

    await storage.set(data);
    await render();
    showStatus('settings saved', 'success');
  }

  async function deleteWord(type, button) {
    const wordItem = button.closest('.word-item');
    if (!wordItem) return;

    const word = wordItem.dataset.word;
    if (!word) return;

    try {
      const current = await storage.get();

      if (type === 'slow') {
        delete current.slowWords[word];
      } else if (type === 'error') {
        delete current.erroredWords[word];
      }

      await storage.set({
        ...current,
        lastUpdate: Date.now()
      });

      await render();
      showStatus(`removed "${word}"`, 'success');
    } catch (error) {
      showStatus('failed to remove word', 'error');
    }
  }

  async function confirmClearAllData() {
    return confirmDialog(
      'Clear All Data',
      'Clear ALL tracking data?',
      'This will remove ALL slow and error words.',
      'remove all',
      'cancel'
    );
  }

  async function confirmClearList(listType) {
    const capitalizedName = listType.charAt(0).toUpperCase() + listType.slice(1);
    return confirmDialog(
      `Clear ${capitalizedName} List`,
      `Clear ALL ${listType} word data?`,
      `This will remove all ${listType} words.`,
      'clear all',
      'cancel'
    );
  }

  function confirmDialog(title, question, description, confirmText, cancelText) {
    const existingDialog = document.getElementById('custom-confirm-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    const dialog = document.createElement('div');
    dialog.id = 'custom-confirm-dialog';
    dialog.className = 'confirm-dialog';
    dialog.appendChild(el('div', 'confirm-dialog-title', title));
    dialog.appendChild(el('div', 'confirm-dialog-question', question));
    if (description) {
      dialog.appendChild(el('div', 'confirm-dialog-desc', description));
    }
    const actions = el('div', 'confirm-dialog-actions');
    const btnYes = el('button', 'btn confirm-dialog-btn confirm-dialog-yes', confirmText);
    btnYes.type = 'button';
    btnYes.id = 'confirm-yes';
    const btnNo = el('button', 'btn confirm-dialog-btn confirm-dialog-no', cancelText);
    btnNo.type = 'button';
    btnNo.id = 'confirm-no';
    actions.appendChild(btnYes);
    actions.appendChild(btnNo);
    dialog.appendChild(actions);

    document.body.appendChild(dialog);

    return new Promise((resolve) => {
      const handleChoice = (confirmed) => {
        dialog.remove();
        document.removeEventListener('keydown', handleKeyDown);
        resolve(confirmed);
      };

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          handleChoice(false);
        } else if (e.key === 'Enter') {
          handleChoice(true);
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      btnYes.addEventListener('click', () => handleChoice(true), { once: true });
      btnNo.addEventListener('click', () => handleChoice(false), { once: true });
    });
  }

  function showStatus(message, type = '') {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = 'status ' + type;
    
    setTimeout(() => {
      status.textContent = '';
      status.className = 'status';
    },3000);
  }

  function setupListeners() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    document.getElementById('copy-slow').addEventListener('click', () => copyWords('slow'));
    document.getElementById('copy-errors').addEventListener('click', () => copyWords('errors'));
    document.getElementById('clear-slow').addEventListener('click', clearSlowWords);
    document.getElementById('clear-errors').addEventListener('click', clearErrorWords);
    document.getElementById('slow-words').addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-btn')) {
        deleteWord('slow', e.target);
      }
    });

    document.getElementById('error-words').addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-btn')) {
        deleteWord('error', e.target);
      }
    });
    document.getElementById('open-export').addEventListener('click', showExportView);
    document.getElementById('back-btn').addEventListener('click', showMainView);
    document.getElementById('export-data').addEventListener('click', exportData);
    document.getElementById('import-data').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', (e) => {
      if (e.target.files[0]) {
        importData(e.target.files[0]);
        e.target.value = '';
      }
    });
    document.getElementById('clear-data').addEventListener('click', clearData);
    document.getElementById('words-to-show').addEventListener('change', saveSettings);
    document.getElementById('min-samples').addEventListener('change', saveSettings);
    document.getElementById('slow-word-history-count').addEventListener('change', saveSettings);
    const disableCustomEl = document.getElementById('disable-tracking-custom');
    if (disableCustomEl) disableCustomEl.addEventListener('change', saveSettings);
  }

  function setupStorageListener() {
    const api = getBrowserAPI();
    if (!api?.storage?.onChanged) return;
    api.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes[THEME_STORAGE_KEY]) applyMonkeyTypeTheme();
      if (changes[STORAGE_KEY] || changes[THEME_STORAGE_KEY]) render();
    });
  }

  async function init() {
    await applyMonkeyTypeTheme();
    setupListeners();
    setupStorageListener();
    await render();
  }

  init();
})();
