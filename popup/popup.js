/**
 * Popup script - Controls the extension popup UI
 */

document.addEventListener('DOMContentLoaded', async () => {
  const enabledToggle = document.getElementById('enabled-toggle');
  const textCount = document.getElementById('text-count');
  const elementCount = document.getElementById('element-count');
  const rulesCount = document.getElementById('rules-count');
  const reportBtn = document.getElementById('report-btn');
  const batchBtn = document.getElementById('batch-btn');
  const applyBtn = document.getElementById('apply-btn');
  const statusSection = document.getElementById('status-section');
  const statusMessage = document.getElementById('status-message');
  const optionsLink = document.getElementById('options-link');

  // Load initial state
  const stored = await chrome.storage.local.get(['enabled', 'communityRules', 'userRules', 'disabledRuleIds']);
  enabledToggle.checked = stored.enabled !== false;

  // Count active rules (user + community, minus disabled)
  const disabled = new Set(stored.disabledRuleIds || []);
  const userRules = (stored.userRules || []).filter(r => r.enabled !== false && !disabled.has(r.id));
  const communityRules = (stored.communityRules || []).filter(r => !disabled.has(r.id));
  rulesCount.textContent = userRules.length + communityRules.length;

  // Get stats from content script
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATS' });
      textCount.textContent = response.textCount || 0;
      elementCount.textContent = response.elementCount || 0;
    }
  } catch (e) {
    textCount.textContent = '-';
    elementCount.textContent = '-';
  }

  // Toggle enabled state
  enabledToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ enabled: enabledToggle.checked });
    showStatus(enabledToggle.checked ? 'Extension enabled' : 'Extension disabled');
  });

  // Report button - start selection mode
  reportBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_SELECTION' });
        window.close();
      }
    } catch (e) {
      showStatus('Cannot report on this page', true);
    }
  });

  // Batch edit button - start batch mode
  batchBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_BATCH_MODE' });
        window.close();
      }
    } catch (e) {
      showStatus('Cannot start batch mode on this page', true);
    }
  });

  // Apply rules button
  applyBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'APPLY_RULES' });
        showStatus('Rules applied');
      }
    } catch (e) {
      showStatus('Cannot apply rules on this page', true);
    }
  });

  // Options link
  optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  function showStatus(message, isError = false) {
    statusSection.style.display = 'block';
    statusSection.className = isError ? 'status error' : 'status';
    statusMessage.textContent = message;

    setTimeout(() => {
      statusSection.style.display = 'none';
    }, 2000);
  }
});
