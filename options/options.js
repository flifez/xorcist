/**
 * Options page script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const githubToken = document.getElementById('github-token');
  const rulesRepo = document.getElementById('rules-repo');
  const syncInterval = document.getElementById('sync-interval');
  const autoApply = document.getElementById('auto-apply');
  const lastSyncEl = document.getElementById('last-sync');
  const syncErrorContainer = document.getElementById('sync-error-container');
  const syncErrorEl = document.getElementById('sync-error');
  const communityRulesEl = document.getElementById('community-rules');
  const userRulesEl = document.getElementById('user-rules');
  const communityCountEl = document.getElementById('community-count');
  const userCountEl = document.getElementById('user-count');
  const syncBtn = document.getElementById('sync-btn');
  const importBtn = document.getElementById('import-btn');
  const exportBtn = document.getElementById('export-btn');
  const importFile = document.getElementById('import-file');
  const saveBtn = document.getElementById('save-btn');
  const saveStatus = document.getElementById('save-status');

  // Tag elements
  const tagsList = document.getElementById('tags-list');
  const addTagBtn = document.getElementById('add-tag-btn');
  const tagModal = document.getElementById('tag-modal');
  const tagNameInput = document.getElementById('tag-name');
  const tagColorPicker = document.getElementById('tag-color-picker');
  const tagCreateBtn = document.getElementById('tag-create');
  const tagCancelBtn = document.getElementById('tag-cancel');
  const tagPickerModal = document.getElementById('tag-picker-modal');
  const tagPickerList = document.getElementById('tag-picker-list');
  const tagPickerClose = document.getElementById('tag-picker-close');

  // Track expanded accordion sections
  const expandedSections = new Set();

  // All tags for reference
  let allTags = [];
  let selectedTagColor = '#4285f4';
  let currentTagPickerRuleId = null;

  // Load initial data
  await loadSettings();
  await loadSyncStatus();
  await loadTags();
  await loadRules();

  // Event handlers
  saveBtn.addEventListener('click', saveSettings);
  syncBtn.addEventListener('click', syncRules);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', handleImport);
  exportBtn.addEventListener('click', handleExport);

  // Sync interval change
  syncInterval.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      type: 'SET_SYNC_INTERVAL',
      interval: parseInt(syncInterval.value)
    });
  });

  // Tag modal handlers
  addTagBtn.addEventListener('click', () => {
    tagModal.style.display = 'flex';
    tagNameInput.value = '';
    tagNameInput.focus();
    selectedTagColor = '#4285f4';
    tagColorPicker.querySelectorAll('.color-option').forEach(o => {
      o.classList.toggle('selected', o.dataset.color === selectedTagColor);
    });
  });

  tagCancelBtn.addEventListener('click', () => {
    tagModal.style.display = 'none';
  });

  tagModal.querySelector('.modal-close').addEventListener('click', () => {
    tagModal.style.display = 'none';
  });

  tagColorPicker.addEventListener('click', (e) => {
    const option = e.target.closest('.color-option');
    if (!option) return;
    tagColorPicker.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
    option.classList.add('selected');
    selectedTagColor = option.dataset.color;
  });

  tagCreateBtn.addEventListener('click', async () => {
    const name = tagNameInput.value.trim();
    if (!name) {
      showStatus('Please enter a tag name', true);
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: 'CREATE_TAG',
      name,
      color: selectedTagColor
    });

    if (response.success) {
      tagModal.style.display = 'none';
      showStatus('Tag created');
      await loadTags();
    } else {
      showStatus(response.error || 'Failed to create tag', true);
    }
  });

  tagNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      tagCreateBtn.click();
    }
  });

  // Tag picker modal handlers
  tagPickerClose.addEventListener('click', () => {
    tagPickerModal.style.display = 'none';
    currentTagPickerRuleId = null;
  });

  tagPickerModal.querySelector('.modal-close').addEventListener('click', () => {
    tagPickerModal.style.display = 'none';
    currentTagPickerRuleId = null;
  });

  /**
   * Load settings from storage
   */
  async function loadSettings() {
    const stored = await chrome.storage.local.get([
      'githubToken',
      'rulesRepo',
      'syncInterval',
      'autoApply'
    ]);

    githubToken.value = stored.githubToken || '';
    rulesRepo.value = stored.rulesRepo || 'placeholder/xorcist-rules';
    syncInterval.value = stored.syncInterval !== undefined ? stored.syncInterval : 60;
    autoApply.checked = stored.autoApply !== false;
  }

  /**
   * Load sync status
   */
  async function loadSyncStatus() {
    const status = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });

    if (status.lastSyncSuccess) {
      lastSyncEl.textContent = formatTime(status.lastSyncSuccess);
    } else {
      lastSyncEl.textContent = 'Never';
    }

    if (status.syncError) {
      syncErrorContainer.style.display = '';
      syncErrorEl.textContent = status.syncError;
    } else {
      syncErrorContainer.style.display = 'none';
    }
  }

  /**
   * Load tags from storage
   */
  async function loadTags() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TAGS' });
    allTags = response.tags || [];
    renderTags();
  }

  /**
   * Render tags list
   */
  function renderTags() {
    if (!allTags.length) {
      tagsList.innerHTML = '<p class="empty-state">No tags yet</p>';
      return;
    }

    tagsList.innerHTML = allTags.map(tag => `
      <div class="tag-item ${tag.enabled ? '' : 'disabled'}" data-tag-id="${escapeHtml(tag.id)}">
        <span class="tag-color" style="background:${tag.color}"></span>
        <span class="tag-name">${escapeHtml(tag.name)}</span>
        <input type="checkbox" class="tag-toggle" ${tag.enabled ? 'checked' : ''}>
        <button class="tag-delete" title="Delete tag">&times;</button>
      </div>
    `).join('');

    // Add toggle handlers
    tagsList.querySelectorAll('.tag-toggle').forEach(toggle => {
      toggle.addEventListener('change', handleTagToggle);
    });

    // Add delete handlers
    tagsList.querySelectorAll('.tag-delete').forEach(btn => {
      btn.addEventListener('click', handleTagDelete);
    });
  }

  /**
   * Handle tag toggle
   */
  async function handleTagToggle(e) {
    const tagItem = e.target.closest('.tag-item');
    const tagId = tagItem.dataset.tagId;
    const enabled = e.target.checked;

    const response = await chrome.runtime.sendMessage({
      type: 'TOGGLE_TAG',
      tagId,
      enabled
    });

    if (response.success) {
      tagItem.classList.toggle('disabled', !enabled);
      showStatus(enabled ? 'Tag enabled' : 'Tag disabled');
    } else {
      e.target.checked = !enabled;
      showStatus(response.error || 'Failed to toggle tag', true);
    }
  }

  /**
   * Handle tag delete
   */
  async function handleTagDelete(e) {
    const tagItem = e.target.closest('.tag-item');
    const tagId = tagItem.dataset.tagId;

    const response = await chrome.runtime.sendMessage({
      type: 'DELETE_TAG',
      tagId
    });

    if (response.success) {
      showStatus('Tag deleted');
      await loadTags();
      await loadRules(); // Reload rules to update tag displays
    } else {
      showStatus(response.error || 'Failed to delete tag', true);
    }
  }

  /**
   * Load rules from storage
   */
  async function loadRules() {
    const stored = await chrome.storage.local.get([
      'communityRules',
      'userRules',
      'disabledRuleIds'
    ]);

    const communityRules = stored.communityRules || [];
    const userRules = stored.userRules || [];
    const disabledIds = new Set(stored.disabledRuleIds || []);

    communityCountEl.textContent = `${communityRules.length} rules`;
    userCountEl.textContent = `${userRules.length} rules`;

    renderRulesAccordion(communityRulesEl, communityRules, disabledIds, 'community');
    renderRulesAccordion(userRulesEl, userRules, new Set(), 'user');
  }

  /**
   * Group rules by hostname
   */
  function groupByHostname(rules) {
    const groups = {};
    for (const rule of rules) {
      const host = rule.hostname || '*';
      if (!groups[host]) {
        groups[host] = [];
      }
      groups[host].push(rule);
    }
    return groups;
  }

  /**
   * Render rules as accordion grouped by site
   */
  function renderRulesAccordion(container, rules, disabledIds, type) {
    if (!rules.length) {
      container.innerHTML = `<p class="empty-state">No ${type === 'user' ? 'local' : 'community'} rules</p>`;
      return;
    }

    const groups = groupByHostname(rules);
    const hostnames = Object.keys(groups).sort();

    container.innerHTML = hostnames.map(hostname => {
      const siteRules = groups[hostname];
      const sectionId = `${type}-${hostname}`;
      const isExpanded = expandedSections.has(sectionId);

      return `
        <div class="accordion-section" data-section="${sectionId}">
          <div class="accordion-header" data-section="${sectionId}">
            <span class="accordion-icon">${isExpanded ? '▼' : '▶'}</span>
            <span class="accordion-title">${escapeHtml(hostname)}</span>
            <span class="accordion-count">${siteRules.length}</span>
          </div>
          <div class="accordion-content ${isExpanded ? 'expanded' : ''}">
            ${siteRules.map(rule => renderRuleItem(rule, disabledIds, type)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Add accordion toggle handlers
    container.querySelectorAll('.accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        const sectionId = header.dataset.section;
        const section = header.closest('.accordion-section');
        const content = section.querySelector('.accordion-content');
        const icon = header.querySelector('.accordion-icon');

        if (expandedSections.has(sectionId)) {
          expandedSections.delete(sectionId);
          content.classList.remove('expanded');
          icon.textContent = '▶';
        } else {
          expandedSections.add(sectionId);
          content.classList.add('expanded');
          icon.textContent = '▼';
        }
      });
    });

    // Add toggle handlers
    container.querySelectorAll('.rule-toggle').forEach(toggle => {
      toggle.addEventListener('change', handleToggle);
    });
  }

  // Use event delegation for user rule actions (attach once to container)
  userRulesEl.addEventListener('click', handleRuleAction);

  /**
   * Render a single rule item
   */
  function renderRuleItem(rule, disabledIds, type) {
    const isDisabled = type === 'user' ? rule.enabled === false : disabledIds.has(rule.id);
    const ruleId = escapeHtml(rule.id);
    const ruleTags = rule.tags || [];

    // Build tags HTML
    const tagsHtml = ruleTags.map(tagId => {
      const tag = allTags.find(t => t.id === tagId);
      if (!tag) return '';
      return `<span class="rule-tag" style="background:${tag.color}20;color:${tag.color}">${escapeHtml(tag.name)}</span>`;
    }).join('');

    return `
      <div class="rule-item ${isDisabled ? 'disabled' : ''}" data-rule-id="${ruleId}">
        <input type="checkbox" class="rule-toggle" ${isDisabled ? '' : 'checked'} data-type="${type}">
        <div class="rule-info">
          <div class="rule-detail">
            <span class="rule-badge ${rule.action}">${rule.action}</span>
            <span class="rule-pattern">${escapeHtml(truncate(rule.contentPattern || rule.selector || '...', 50))}</span>
          </div>
          ${type === 'user' ? `
            <div class="rule-tags">
              ${tagsHtml}
              <button class="rule-tag-add" data-action="add-tag">+</button>
            </div>
          ` : ''}
        </div>
        ${type === 'user' ? `
          <div class="rule-actions">
            <button class="rule-action share" data-action="share">Share</button>
            <button class="rule-action delete" data-action="delete">Delete</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Handle rule toggle
   */
  async function handleToggle(e) {
    const item = e.target.closest('.rule-item');
    const ruleId = item.dataset.ruleId;
    const enabled = e.target.checked;

    const response = await chrome.runtime.sendMessage({
      type: 'TOGGLE_RULE',
      ruleId,
      enabled
    });

    if (response.success) {
      item.classList.toggle('disabled', !enabled);
    } else {
      // Revert checkbox on failure
      e.target.checked = !enabled;
      showStatus(response.error || 'Failed to toggle rule', true);
    }
  }

  /**
   * Handle rule action (share/delete/add-tag)
   */
  async function handleRuleAction(e) {
    e.preventDefault();
    e.stopPropagation();

    // Check for add-tag button
    const addTagBtn = e.target.closest('.rule-tag-add');
    if (addTagBtn) {
      const item = addTagBtn.closest('.rule-item');
      if (item) {
        openTagPicker(item.dataset.ruleId);
      }
      return;
    }

    const btn = e.target.closest('.rule-action');
    if (!btn) return;

    // Prevent double-clicks
    if (btn.disabled) return;

    const item = btn.closest('.rule-item');
    if (!item) return;

    const ruleId = item.dataset.ruleId;
    const action = btn.dataset.action;

    console.log('Rule action:', action, 'for rule:', ruleId, 'button:', btn);

    if (action === 'share') {
      btn.disabled = true;
      btn.textContent = 'Sharing...';

      const response = await chrome.runtime.sendMessage({
        type: 'SHARE_RULE',
        ruleId
      });

      if (response.success) {
        showStatus('PR created!');
        window.open(response.prUrl, '_blank');
      } else {
        showStatus(response.error || 'Failed to share', true);
      }

      btn.disabled = false;
      btn.textContent = 'Share';

    } else if (action === 'delete') {
      // Note: confirm() is blocked in extension options pages
      btn.disabled = true;
      btn.textContent = 'Deleting...';

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'DELETE_USER_RULE',
          ruleId
        });

        console.log('Delete response:', response);

        if (response && response.success) {
          showStatus('Rule deleted');
          await loadRules();
        } else {
          showStatus(response?.error || 'Failed to delete', true);
          btn.disabled = false;
          btn.textContent = 'Delete';
        }
      } catch (err) {
        console.error('Delete error:', err);
        showStatus('Error: ' + err.message, true);
        btn.disabled = false;
        btn.textContent = 'Delete';
      }
    }
  }

  /**
   * Open tag picker modal for a rule
   */
  async function openTagPicker(ruleId) {
    currentTagPickerRuleId = ruleId;

    // Get current rule's tags
    const stored = await chrome.storage.local.get(['userRules']);
    const userRules = stored.userRules || [];
    const rule = userRules.find(r => r.id === ruleId);
    const ruleTags = rule?.tags || [];

    if (!allTags.length) {
      tagPickerList.innerHTML = '<p class="empty-state">No tags available. Create tags first.</p>';
    } else {
      tagPickerList.innerHTML = allTags.map(tag => {
        const isSelected = ruleTags.includes(tag.id);
        return `
          <div class="tag-picker-item ${isSelected ? 'selected' : ''}" data-tag-id="${escapeHtml(tag.id)}">
            <input type="checkbox" class="tag-picker-checkbox" ${isSelected ? 'checked' : ''}>
            <span class="tag-color" style="background:${tag.color}"></span>
            <span class="tag-name">${escapeHtml(tag.name)}</span>
          </div>
        `;
      }).join('');

      // Add click handlers
      tagPickerList.querySelectorAll('.tag-picker-item').forEach(item => {
        item.addEventListener('click', handleTagPickerToggle);
      });
    }

    tagPickerModal.style.display = 'flex';
  }

  /**
   * Handle tag picker item toggle
   */
  async function handleTagPickerToggle(e) {
    if (!currentTagPickerRuleId) return;

    const item = e.currentTarget;
    const tagId = item.dataset.tagId;
    const checkbox = item.querySelector('.tag-picker-checkbox');
    const isCurrentlySelected = checkbox.checked;

    // Toggle the checkbox
    checkbox.checked = !isCurrentlySelected;
    item.classList.toggle('selected', !isCurrentlySelected);

    // Send message to add or remove tag
    const messageType = isCurrentlySelected ? 'REMOVE_TAG_FROM_RULE' : 'ADD_TAG_TO_RULE';
    const response = await chrome.runtime.sendMessage({
      type: messageType,
      ruleId: currentTagPickerRuleId,
      tagId
    });

    if (!response.success) {
      // Revert on failure
      checkbox.checked = isCurrentlySelected;
      item.classList.toggle('selected', isCurrentlySelected);
      showStatus(response.error || 'Failed to update tags', true);
    } else {
      // Reload rules to update the display
      await loadRules();
    }
  }

  /**
   * Save settings
   */
  async function saveSettings() {
    await chrome.storage.local.set({
      githubToken: githubToken.value,
      rulesRepo: rulesRepo.value,
      autoApply: autoApply.checked
    });

    showStatus('Settings saved!');
  }

  /**
   * Sync rules from repository
   */
  async function syncRules() {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';

    const response = await chrome.runtime.sendMessage({ type: 'SYNC_RULES' });

    if (response.success) {
      showStatus(`Synced ${response.rules.length} rules`);
      await loadRules();
      await loadSyncStatus();
    } else {
      showStatus(response.error || 'Sync failed', true);
      await loadSyncStatus();
    }

    syncBtn.disabled = false;
    syncBtn.textContent = 'Sync Now';
  }

  /**
   * Handle import
   */
  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const rules = JSON.parse(text);

      if (!Array.isArray(rules)) {
        throw new Error('Invalid format: expected array of rules');
      }

      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_USER_RULES',
        rules,
        mode: 'merge'
      });

      if (response.success) {
        showStatus(`Imported ${response.imported} rules`);
        await loadRules();
      } else {
        showStatus(response.error || 'Import failed', true);
      }
    } catch (err) {
      showStatus('Invalid file: ' + err.message, true);
    }

    // Reset file input
    e.target.value = '';
  }

  /**
   * Handle export
   */
  async function handleExport() {
    const response = await chrome.runtime.sendMessage({ type: 'EXPORT_USER_RULES' });
    const rules = response.rules || [];

    if (!rules.length) {
      showStatus('No rules to export', true);
      return;
    }

    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `xorcist-rules-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showStatus(`Exported ${rules.length} rules`);
  }

  /**
   * Show status message
   */
  function showStatus(message, isError = false) {
    saveStatus.textContent = message;
    saveStatus.className = isError ? 'save-status error' : 'save-status';

    setTimeout(() => {
      saveStatus.textContent = '';
    }, 3000);
  }

  /**
   * Format timestamp
   */
  function formatTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;

    return new Date(timestamp).toLocaleDateString();
  }

  /**
   * Truncate string
   */
  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  /**
   * Escape HTML
   */
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
