const STORAGE_KEY = 'wordTrackerData';
const THEME_STORAGE_KEY = 'weakwordsTheme';

const defaultData = {
  slowWords: {},
  erroredWords: {},
  settings: {
    wordsToShow: 50,
    minSamples: 1,
    slowThreshold: 0,
    disableTrackingInCustomMode: true,
    slowWordHistoryCount: 50
  },
  lastUpdate: 0
};

function getBrowserAPI() {
  if (typeof browser !== 'undefined' && browser.storage) {
    return browser;
  }
  if (typeof chrome !== 'undefined' && chrome.storage) {
    return chrome;
  }
  if (typeof window !== 'undefined') {
    if (window.browser?.storage) return window.browser;
    if (window.chrome?.storage) return window.chrome;
  }
  return null;
}

let writeQueue = Promise.resolve();

const storage = {
  async get() {
    const api = getBrowserAPI();
    if (!api) {
      console.error('[Storage] no API');
      return { ...defaultData };
    }
    try {
      const result = await api.storage.local.get(STORAGE_KEY);
      return { ...defaultData, ...(result[STORAGE_KEY] || {}) };
    } catch (e) {
      console.error('[Storage] get failed', e);
      return { ...defaultData };
    }
  },

  async set(data) {
    const api = getBrowserAPI();
    if (!api) {
      console.error('[Storage] no API');
      return;
    }
    try {
      await api.storage.local.set({
        [STORAGE_KEY]: { ...defaultData, ...data }
      });
    } catch (e) {
      console.error('[Storage] set failed', e);
    }
  },

  async clear() {
    const api = getBrowserAPI();
    if (!api) {
      console.error('[Storage] no API');
      return;
    }
    try {
      await api.storage.local.remove(STORAGE_KEY);
    } catch (e) {
      console.error('[Storage] clear failed', e);
    }
  },

  async update(updater) {
    writeQueue = writeQueue.then(async () => {
      try {
        const current = await this.get();
        const updated = updater(current);
        await this.set(updated);
      } catch (e) {
        console.error('[Storage] update failed', e);
      }
    });
    return writeQueue;
  }
};
