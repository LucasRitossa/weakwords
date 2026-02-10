(function() {
  'use strict';

  const MAX_WORD_DURATION_MS = 3000;

  let currentTestErroredWords = new Set();
  let currentTestWordTimings = new Map();
  let currentTestSlowWords = new Map();
  let lastActiveWordIndex = -1;
  let testStartTime = null;
  let wordsObserver = null;
  let resultObserver = null;
  let isTestActive = false;
  let cachedSettings = null;
  let lastSpaceTimestamp = null;

  async function refreshSettingsCache() {
    const data = await storage.get();
    cachedSettings = data.settings || {};
  }

  function setupSettingsListener() {
    const api = (typeof browser !== 'undefined' && browser.storage) ? browser :
                (typeof chrome !== 'undefined' && chrome.storage) ? chrome : null;
    if (api?.storage?.onChanged) {
      api.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE_KEY]) {
          refreshSettingsCache();
        }
      });
    }
  }

  function setupKeydownListener() {
    document.addEventListener('keydown', function onKeydown(e) {
      if (!isTestActive) return;
      if (e.key === ' ') {
        lastSpaceTimestamp = e.timeStamp;
        return;
      }
      const activeWord = document.querySelector('#words .word.active');
      if (activeWord && activeWord.getAttribute('data-wordindex') === '0' && !currentTestWordTimings.has(0)) {
        currentTestWordTimings.set(0, e.timeStamp);
      }
    }, true);
  }

  function resetTestSession() {
    currentTestErroredWords.clear();
    currentTestWordTimings.clear();
    currentTestSlowWords.clear();
    lastActiveWordIndex = -1;
    testStartTime = Date.now();
    isTestActive = true;
  }

  function getWordText(wordElement) {
    if (!wordElement) return '';
    const letters = wordElement.querySelectorAll('letter');
    if (letters.length > 0) {
      return Array.from(letters).map(l => l.textContent).join('').trim();
    }
    return wordElement.textContent.trim();
  }

  function getTargetWordFromWordElement(wordElement) {
    if (!wordElement) return '';
    const letters = wordElement.querySelectorAll('letter:not(.extra)');
    if (letters.length === 0) return '';
    return Array.from(letters).map(l => l.textContent).join('').trim();
  }

  function getMonkeyTypeMode() {
    const btn = document.querySelector('#testConfig .mode .textButton.active');
    return btn ? btn.getAttribute('mode') : null;
  }

  function checkForErrors() {
    if (getMonkeyTypeMode() === 'custom' && (cachedSettings?.disableTrackingInCustomMode ?? true)) return;

    const wordsContainer = document.querySelector('#words');
    if (!wordsContainer) return;

    const allWords = wordsContainer.querySelectorAll('.word');
    const errorWords = Array.from(allWords).filter((wordEl) => {
      return wordEl.classList.contains('error') ||
        wordEl.querySelector('letter.incorrect, letter.corrected') !== null;
    });
    if (errorWords.length === 0) return;

    errorWords.forEach((wordEl) => {
      const index = wordEl.getAttribute('data-wordindex') || '0';
      const targetWord = getTargetWordFromWordElement(wordEl);
      const wordKey = `${index}:${targetWord}`;

      if (!targetWord || targetWord.length === 0) return;
      if (currentTestErroredWords.has(wordKey)) return;

      currentTestErroredWords.add(wordKey);
      recordError(targetWord);
    });
  }

  function checkWordTiming() {
    if (getMonkeyTypeMode() === 'custom' && (cachedSettings?.disableTrackingInCustomMode ?? true)) return;

    const activeWord = document.querySelector('#words .word.active');
    if (!activeWord) return;

    const wordIndex = parseInt(activeWord.getAttribute('data-wordindex') || '-1');
    if (wordIndex === -1) return;

    const isTransition = wordIndex !== lastActiveWordIndex && lastActiveWordIndex >= 0;
    let now;
    if (isTransition && lastSpaceTimestamp != null) {
      now = lastSpaceTimestamp;
      lastSpaceTimestamp = null;
    } else {
      now = performance.now();
    }

    if (isTransition) {
      const prevStartTime = currentTestWordTimings.get(lastActiveWordIndex);
      if (prevStartTime) {
        const duration = now - prevStartTime;
        const prevWordEl = document.querySelector(`#words .word[data-wordindex="${lastActiveWordIndex}"]`);
        if (prevWordEl) {
          const prevTargetWord = getTargetWordFromWordElement(prevWordEl);

          if (prevTargetWord && duration > 50 && duration <= MAX_WORD_DURATION_MS) {
            const chars = prevTargetWord.length;
            const minutes = duration / 60000;
            const wpm = minutes > 0 ? (chars / 5) / minutes : 0;
            const prevWordKey = `${lastActiveWordIndex}:${prevTargetWord}`;
            if (!currentTestErroredWords.has(prevWordKey)) {
              if (!currentTestSlowWords.has(prevTargetWord)) {
                currentTestSlowWords.set(prevTargetWord, { durations: [], wpms: [] });
              }
              const data = currentTestSlowWords.get(prevTargetWord);
              data.durations.push(duration);
              data.wpms.push(wpm);
              recordSlowWord(prevTargetWord, wpm);
            }
          }
        }
      }
    }

    if (!currentTestWordTimings.has(wordIndex) && wordIndex !== 0) {
      currentTestWordTimings.set(wordIndex, now);
    }

    lastActiveWordIndex = wordIndex;
  }

  function recordError(word) {
    if (!word) return;
    storage.update((latest) => {
      const updatedErroredWords = { ...latest.erroredWords };
      updatedErroredWords[word] = (updatedErroredWords[word] || 0) + 1;
      return {
        ...latest,
        erroredWords: updatedErroredWords,
        lastUpdate: Date.now()
      };
    }).catch(() => {});
  }

  function recordSlowWord(word, wpm) {
    if (!word || wpm <= 0) return;
    storage.update((latest) => {
      const updatedSlowWords = { ...latest.slowWords };
      if (!updatedSlowWords[word]) {
        updatedSlowWords[word] = { count: 0, avgSpeed: 0, samples: [] };
      }
      const wordData = updatedSlowWords[word];
      wordData.count++;
      wordData.samples.push(Math.round(wpm));
      const cap = Math.max(1, latest.settings?.slowWordHistoryCount ?? 50);
      if (wordData.samples.length > cap) {
        wordData.samples = wordData.samples.slice(-cap);
      }
      const sum = wordData.samples.reduce((a, b) => a + b, 0);
      wordData.avgSpeed = sum / wordData.samples.length;
      return {
        ...latest,
        slowWords: updatedSlowWords,
        lastUpdate: Date.now()
      };
    }).catch(() => {});
  }

  function onTestEnd() {
    isTestActive = false;
  }

  function detectNewTest() {
    const wordsContainer = document.querySelector('#words');
    if (!wordsContainer) return false;
    const activeWord = wordsContainer.querySelector('.word.active');
    if (activeWord) {
      const activeIndex = parseInt(activeWord.getAttribute('data-wordindex') || '0');
      if (activeIndex === 0 && lastActiveWordIndex > 5) {
        resetTestSession();
        return true;
      }
    }
    return false;
  }

  function startWordsObserver() {
    const wordsContainer = document.querySelector('#words');
    if (!wordsContainer) {
      setTimeout(startWordsObserver, 1000);
      return;
    }

    if (wordsObserver) {
      wordsObserver.disconnect();
    }

    wordsObserver = new MutationObserver((mutations) => {
      let shouldCheck = false;

      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          shouldCheck = true;
        }
        if (mutation.type === 'childList') {
          shouldCheck = true;
          if (mutation.target === wordsContainer) {
            detectNewTest();
          }
        }
      }

      if (shouldCheck && isTestActive) {
        checkForErrors();
        checkWordTiming();
      }
    });

    wordsObserver.observe(wordsContainer, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });
    resetTestSession();
  }

  function startResultObserver() {
    const resultElement = document.querySelector('#result');
    if (!resultElement) {
      setTimeout(startResultObserver, 1000);
      return;
    }

    if (resultObserver) {
      resultObserver.disconnect();
    }

    resultObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isHidden = resultElement.classList.contains('hidden');

          if (!isHidden && isTestActive) {
            onTestEnd();
          } else if (isHidden && !isTestActive) {
            resetTestSession();
          }
        }
      }
    });

    resultObserver.observe(resultElement, {
      attributes: true,
      attributeFilter: ['class']
    });
    if (!resultElement.classList.contains('hidden')) {
      isTestActive = false;
    }
  }



  const THEME_STORAGE_KEY = 'weakwordsTheme';
  const THEME_VARS = ['bg-color', 'main-color', 'sub-color', 'sub-alt-color', 'text-color', 'error-color'];
  let themeObserver = null;

  function captureAndStoreMonkeyTypeTheme() {
    try {
      const root = document.documentElement;
      if (!root) return;
      const style = window.getComputedStyle(root);
      if (!style) return;
      const theme = {};
      THEME_VARS.forEach((name) => {
        const value = style.getPropertyValue('--' + name).trim();
        if (value) theme[name] = value;
      });
      if (Object.keys(theme).length === 0) return;
      const api = (typeof chrome !== 'undefined' && chrome.storage) ? chrome : (typeof browser !== 'undefined' && browser.storage) ? browser : null;
      if (api) {
        api.storage.local.set({ [THEME_STORAGE_KEY]: theme }).catch(() => {});
      }
    } catch (_) {}
  }

  function debounce(fn, ms) {
    let timeout = null;
    return function () {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = null;
        fn();
      }, ms);
    };
  }

  const debouncedCaptureAndStoreMonkeyTypeTheme = debounce(captureAndStoreMonkeyTypeTheme, 80);

  function startThemeObserver() {
    const maxAttempts = 8;
    const pollInterval = 250;
    let attempts = 0;

    function tryAttach() {
      const themeEl = document.getElementById('theme');
      if (themeEl) {
        captureAndStoreMonkeyTypeTheme();
        if (themeObserver) themeObserver.disconnect();
        themeObserver = new MutationObserver(() => {
          debouncedCaptureAndStoreMonkeyTypeTheme();
        });
        themeObserver.observe(themeEl, { childList: true, characterData: true, attributes: true, subtree: true });
        return true;
      }
      attempts++;
      if (attempts < maxAttempts) setTimeout(tryAttach, pollInterval);
    }

    setTimeout(tryAttach, pollInterval);
  }

  function initialize() {
    if (window.location.hostname !== 'monkeytype.com') return;

    function start() {
      refreshSettingsCache();
      setupSettingsListener();
      setupKeydownListener();
      startWordsObserver();
      startResultObserver();
      setTimeout(captureAndStoreMonkeyTypeTheme, 500);
      startThemeObserver();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  try {
    initialize();
  } catch (err) {
    console.error('[weakwords] init failed', err);
  }
})();
