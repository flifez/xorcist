/**
 * Background service worker for Xorcist extension
 * Handles GitHub integration, rule management, and periodic sync
 */

// Default configuration
const DEFAULT_CONFIG = {
  rulesRepo: 'placeholder/xorcist-rules',
  rulesBranch: 'main',
  rulesPath: 'rules',
  syncInterval: 60 // minutes
};

// Default tags
const DEFAULT_TAGS = [
  { id: 'tag-social-media', name: 'social-media', color: '#4285f4' },
  { id: 'tag-news', name: 'news', color: '#ea4335' },
  { id: 'tag-ads', name: 'ads', color: '#fbbc04' },
  { id: 'tag-tech', name: 'tech', color: '#34a853' }
];

// Sync interval options (in minutes)
const SYNC_INTERVALS = {
  0: 'Manual only',
  15: 'Every 15 minutes',
  60: 'Every hour',
  360: 'Every 6 hours',
  1440: 'Daily'
};

/**
 * Extension lifecycle - installation and startup
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Xorcist extension installed/updated');

  // Run storage migration
  await migrateStorage();

  // Initialize default settings
  const stored = await chrome.storage.local.get(['enabled', 'autoApply', 'syncInterval']);
  if (stored.enabled === undefined) {
    await chrome.storage.local.set({ enabled: true });
  }
  if (stored.autoApply === undefined) {
    await chrome.storage.local.set({ autoApply: true });
  }
  if (stored.syncInterval === undefined) {
    await chrome.storage.local.set({ syncInterval: DEFAULT_CONFIG.syncInterval });
  }

  // Setup context menu
  chrome.contextMenus.create({
    id: 'xorcist-report',
    title: 'Report X branding here',
    contexts: ['selection', 'page']
  });

  // Setup periodic sync alarm
  await setupSyncAlarm();
});

/**
 * Service worker startup (for updates/restarts)
 */
chrome.runtime.onStartup.addListener(async () => {
  await setupSyncAlarm();
});

/**
 * Migrate storage from old schema to new schema
 */
async function migrateStorage() {
  const stored = await chrome.storage.local.get(['rules', 'communityRules', 'userRules']);

  // If old 'rules' exists but new schema doesn't, migrate
  if (stored.rules && !stored.communityRules) {
    console.log('Migrating storage schema...');

    // Add source field to existing rules
    const migratedRules = stored.rules.map(rule => ({
      ...rule,
      source: 'community',
      enabled: true
    }));

    await chrome.storage.local.set({
      communityRules: migratedRules,
      userRules: [],
      disabledRuleIds: []
    });

    // Remove old rules key
    await chrome.storage.local.remove('rules');

    console.log(`Migrated ${migratedRules.length} rules to new schema`);
  }

  // Ensure new fields exist
  if (!stored.communityRules) {
    await chrome.storage.local.set({ communityRules: [] });
  }
  if (!stored.userRules) {
    await chrome.storage.local.set({ userRules: [] });
  }

  // Initialize tags if not present
  const tagsStored = await chrome.storage.local.get(['tags']);
  if (!tagsStored.tags) {
    const defaultTagsWithMeta = DEFAULT_TAGS.map(tag => ({
      ...tag,
      enabled: true,
      createdAt: new Date().toISOString()
    }));
    await chrome.storage.local.set({ tags: defaultTagsWithMeta });
    console.log('Initialized default tags');
  }
}

/**
 * Setup or update the sync alarm
 */
async function setupSyncAlarm() {
  const stored = await chrome.storage.local.get(['syncInterval']);
  const interval = stored.syncInterval || DEFAULT_CONFIG.syncInterval;

  // Clear existing alarm
  await chrome.alarms.clear('syncRules');

  if (interval > 0) {
    chrome.alarms.create('syncRules', {
      delayInMinutes: 1, // Initial sync after 1 minute
      periodInMinutes: interval
    });
    console.log(`Sync alarm set for every ${interval} minutes`);
  } else {
    console.log('Periodic sync disabled');
  }
}

/**
 * Alarm handler
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'syncRules') {
    console.log('Running scheduled sync...');
    await syncCommunityRules();
  }
});

/**
 * Context menu handler
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'xorcist-report' && tab?.id) {
    await chrome.tabs.sendMessage(tab.id, { type: 'START_SELECTION' });
  }
});

/**
 * Message handler
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    // Existing handlers
    case 'PROPOSE_FIX':
      return await proposeFix(message.proposal);

    case 'SYNC_RULES':
      return await syncCommunityRules();

    case 'GET_RULES':
      return await getMergedRules();

    // New handlers for user rules
    case 'SAVE_LOCAL_RULE':
      return await saveLocalRule(message.rule);

    case 'SHARE_RULE':
      return await shareRule(message.ruleId);

    case 'DELETE_USER_RULE':
      return await deleteUserRule(message.ruleId);

    case 'UPDATE_USER_RULE':
      return await updateUserRule(message.rule);

    case 'TOGGLE_RULE':
      return await toggleRule(message.ruleId, message.enabled);

    case 'EXPORT_USER_RULES':
      return await exportUserRules();

    case 'IMPORT_USER_RULES':
      return await importUserRules(message.rules, message.mode);

    case 'SET_SYNC_INTERVAL':
      return await setSyncInterval(message.interval);

    case 'GET_SYNC_STATUS':
      return await getSyncStatus();

    // Tag management
    case 'GET_TAGS':
      return await getTags();

    case 'CREATE_TAG':
      return await createTag(message.name, message.color);

    case 'UPDATE_TAG':
      return await updateTag(message.tagId, message.updates);

    case 'DELETE_TAG':
      return await deleteTag(message.tagId);

    case 'TOGGLE_TAG':
      return await toggleTag(message.tagId, message.enabled);

    case 'ADD_TAG_TO_RULE':
      return await addTagToRule(message.ruleId, message.tagId);

    case 'REMOVE_TAG_FROM_RULE':
      return await removeTagFromRule(message.ruleId, message.tagId);

    // Batch operations
    case 'SAVE_BATCH_RULES':
      return await saveBatchRules(message.rules);

    default:
      return { error: 'Unknown message type' };
  }
}

/**
 * Get merged rules from both sources (user rules take priority)
 * Filters out rules that are disabled or have disabled tags
 */
async function getMergedRules() {
  const stored = await chrome.storage.local.get(['communityRules', 'userRules', 'disabledRuleIds', 'tags']);
  const disabled = new Set(stored.disabledRuleIds || []);
  const tags = stored.tags || [];
  const disabledTagIds = new Set(tags.filter(t => !t.enabled).map(t => t.id));

  // Check if rule is enabled (not individually disabled and no disabled tags)
  const isRuleEnabled = (rule) => {
    if (disabled.has(rule.id)) return false;
    if (rule.enabled === false) return false;
    // If rule has tags and ANY tag is disabled, rule is disabled
    if (rule.tags && rule.tags.length > 0) {
      if (rule.tags.some(tagId => disabledTagIds.has(tagId))) {
        return false;
      }
    }
    return true;
  };

  const userRules = (stored.userRules || []).filter(isRuleEnabled);
  const communityRules = (stored.communityRules || []).filter(isRuleEnabled);

  // User rules first (higher priority)
  return { rules: [...userRules, ...communityRules] };
}

/**
 * Save a rule locally (user rule)
 */
async function saveLocalRule(ruleData) {
  try {
    const stored = await chrome.storage.local.get(['userRules']);
    const userRules = stored.userRules || [];

    const rule = {
      id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      ...ruleData,
      source: 'user',
      enabled: true,
      metadata: {
        ...ruleData.metadata,
        createdAt: new Date().toISOString()
      }
    };

    userRules.push(rule);
    await chrome.storage.local.set({ userRules });

    return { success: true, ruleId: rule.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Share a user rule to the community (create PR)
 */
async function shareRule(ruleId) {
  const stored = await chrome.storage.local.get(['userRules', 'githubToken', 'rulesRepo']);

  if (!stored.githubToken) {
    return { success: false, error: 'GitHub token not configured. Please set it in options.' };
  }

  const rule = (stored.userRules || []).find(r => r.id === ruleId);
  if (!rule) {
    return { success: false, error: 'Rule not found' };
  }

  // Convert to proposal format and use existing PR flow
  const proposal = {
    url: rule.metadata?.reportedUrl || '',
    hostname: rule.hostname,
    selector: rule.selector,
    originalContent: rule.metadata?.originalContent || '',
    action: rule.action,
    replacement: rule.replacement,
    notes: rule.metadata?.notes || null,
    timestamp: Date.now()
  };

  return await proposeFix(proposal);
}

/**
 * Delete a user rule
 */
async function deleteUserRule(ruleId) {
  console.log('deleteUserRule called with:', ruleId);
  try {
    const stored = await chrome.storage.local.get(['userRules']);
    const userRules = stored.userRules || [];
    console.log('Current rules:', userRules.length, 'IDs:', userRules.map(r => r.id));

    const filtered = userRules.filter(r => r.id !== ruleId);
    console.log('After filter:', filtered.length);

    await chrome.storage.local.set({ userRules: filtered });
    return { success: true };
  } catch (error) {
    console.error('deleteUserRule error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update a user rule
 */
async function updateUserRule(updatedRule) {
  try {
    const stored = await chrome.storage.local.get(['userRules']);
    const userRules = stored.userRules || [];
    const index = userRules.findIndex(r => r.id === updatedRule.id);

    if (index === -1) {
      return { success: false, error: 'Rule not found' };
    }

    userRules[index] = {
      ...userRules[index],
      ...updatedRule,
      metadata: {
        ...userRules[index].metadata,
        updatedAt: new Date().toISOString()
      }
    };

    await chrome.storage.local.set({ userRules });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Toggle a rule's enabled state
 */
async function toggleRule(ruleId, enabled) {
  try {
    const stored = await chrome.storage.local.get(['userRules', 'communityRules', 'disabledRuleIds']);
    let disabledRuleIds = stored.disabledRuleIds || [];

    // Check if it's a user rule
    const userRules = stored.userRules || [];
    const userRuleIndex = userRules.findIndex(r => r.id === ruleId);

    if (userRuleIndex !== -1) {
      // Toggle user rule's enabled field
      userRules[userRuleIndex].enabled = enabled;
      await chrome.storage.local.set({ userRules });
    } else {
      // For community rules, use disabledRuleIds
      if (enabled) {
        disabledRuleIds = disabledRuleIds.filter(id => id !== ruleId);
      } else {
        if (!disabledRuleIds.includes(ruleId)) {
          disabledRuleIds.push(ruleId);
        }
      }
      await chrome.storage.local.set({ disabledRuleIds });
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Export user rules
 */
async function exportUserRules() {
  const stored = await chrome.storage.local.get(['userRules']);
  return { rules: stored.userRules || [] };
}

/**
 * Import user rules
 */
async function importUserRules(rules, mode = 'merge') {
  try {
    if (!Array.isArray(rules)) {
      return { success: false, error: 'Invalid rules format' };
    }

    const stored = await chrome.storage.local.get(['userRules']);
    let userRules = stored.userRules || [];

    // Validate and normalize imported rules
    const importedRules = rules.map(rule => ({
      ...rule,
      id: rule.id || `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      source: 'user',
      enabled: rule.enabled !== false,
      metadata: {
        ...rule.metadata,
        importedAt: new Date().toISOString()
      }
    }));

    if (mode === 'replace') {
      userRules = importedRules;
    } else {
      // Merge: add new rules, skip duplicates by id
      const existingIds = new Set(userRules.map(r => r.id));
      for (const rule of importedRules) {
        if (!existingIds.has(rule.id)) {
          userRules.push(rule);
        }
      }
    }

    await chrome.storage.local.set({ userRules });
    return { success: true, imported: importedRules.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Set sync interval and update alarm
 */
async function setSyncInterval(interval) {
  try {
    await chrome.storage.local.set({ syncInterval: interval });
    await setupSyncAlarm();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get sync status
 */
async function getSyncStatus() {
  const stored = await chrome.storage.local.get([
    'syncInterval',
    'lastSyncAttempt',
    'lastSyncSuccess',
    'syncError',
    'communityRules',
    'userRules'
  ]);

  return {
    syncInterval: stored.syncInterval || DEFAULT_CONFIG.syncInterval,
    lastSyncAttempt: stored.lastSyncAttempt || null,
    lastSyncSuccess: stored.lastSyncSuccess || null,
    syncError: stored.syncError || null,
    communityRulesCount: (stored.communityRules || []).length,
    userRulesCount: (stored.userRules || []).length
  };
}

/**
 * Sync community rules from the repository
 */
async function syncCommunityRules() {
  const stored = await chrome.storage.local.get(['githubToken', 'rulesRepo', 'lastSyncAttempt']);
  const token = stored.githubToken;
  const repo = stored.rulesRepo || DEFAULT_CONFIG.rulesRepo;

  // Rate limiting: skip if last attempt was < 5 minutes ago
  const now = Date.now();
  if (stored.lastSyncAttempt && (now - stored.lastSyncAttempt) < 5 * 60 * 1000) {
    console.log('Skipping sync: rate limited');
    return { success: false, error: 'Rate limited. Try again later.' };
  }

  await chrome.storage.local.set({ lastSyncAttempt: now });

  try {
    const [owner, repoName] = repo.split('/');

    // Fetch rules directory
    const contents = await githubApi(
      `/repos/${owner}/${repoName}/contents/${DEFAULT_CONFIG.rulesPath}`,
      token
    );

    const rules = [];

    // Recursively fetch all rule files
    for (const item of contents) {
      if (item.type === 'dir') {
        try {
          const subContents = await githubApi(item.url.replace('https://api.github.com', ''), token);
          for (const file of subContents) {
            if (file.name.endsWith('.json')) {
              const ruleData = await githubApi(file.url.replace('https://api.github.com', ''), token);
              const decoded = JSON.parse(atob(ruleData.content));
              rules.push({
                ...decoded,
                source: 'community',
                enabled: true
              });
            }
          }
        } catch (e) {
          console.warn('Failed to fetch subdirectory:', item.path, e);
        }
      } else if (item.name.endsWith('.json')) {
        try {
          const ruleData = await githubApi(item.url.replace('https://api.github.com', ''), token);
          const decoded = JSON.parse(atob(ruleData.content));
          rules.push({
            ...decoded,
            source: 'community',
            enabled: true
          });
        } catch (e) {
          console.warn('Failed to fetch rule:', item.path, e);
        }
      }
    }

    await chrome.storage.local.set({
      communityRules: rules,
      lastSyncSuccess: now,
      syncError: null
    });

    console.log(`Synced ${rules.length} community rules`);
    return { success: true, rules };

  } catch (error) {
    console.error('Failed to sync rules:', error);
    await chrome.storage.local.set({ syncError: error.message });
    return { success: false, error: error.message || 'Failed to sync rules' };
  }
}

/**
 * Propose a fix by creating a PR in the rules repository
 */
async function proposeFix(proposal) {
  const stored = await chrome.storage.local.get(['githubToken', 'rulesRepo']);
  const token = stored.githubToken;
  const repo = stored.rulesRepo || DEFAULT_CONFIG.rulesRepo;

  if (!token) {
    return { success: false, error: 'GitHub token not configured. Please set it in options.' };
  }

  try {
    const [owner, repoName] = repo.split('/');
    const branchName = `fix/${Date.now()}-${sanitizeForBranch(proposal.hostname)}`;

    // Get default branch SHA
    const repoInfo = await githubApi(`/repos/${owner}/${repoName}`, token);
    const defaultBranch = repoInfo.default_branch;
    const refData = await githubApi(`/repos/${owner}/${repoName}/git/ref/heads/${defaultBranch}`, token);
    const baseSha = refData.object.sha;

    // Create new branch
    await githubApi(`/repos/${owner}/${repoName}/git/refs`, token, 'POST', {
      ref: `refs/heads/${branchName}`,
      sha: baseSha
    });

    // Create rule file
    const rule = {
      id: `rule-${Date.now()}`,
      hostname: proposal.hostname,
      urlPattern: escapeRegex(proposal.hostname),
      selector: proposal.selector,
      contentPattern: escapeRegex(extractXPattern(proposal.originalContent)),
      action: proposal.action,
      replacement: proposal.replacement,
      metadata: {
        reportedUrl: proposal.url,
        originalContent: proposal.originalContent,
        notes: proposal.notes,
        createdAt: new Date().toISOString()
      }
    };

    const filePath = `${DEFAULT_CONFIG.rulesPath}/${proposal.hostname.replace(/\./g, '_')}/${rule.id}.json`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(rule, null, 2))));

    await githubApi(`/repos/${owner}/${repoName}/contents/${filePath}`, token, 'PUT', {
      message: `Add rule for ${proposal.hostname}: ${proposal.action} X branding`,
      content: content,
      branch: branchName
    });

    // Create pull request
    const pr = await githubApi(`/repos/${owner}/${repoName}/pulls`, token, 'POST', {
      title: `[Xorcist] ${proposal.action} X branding on ${proposal.hostname}`,
      body: formatPRBody(proposal, rule),
      head: branchName,
      base: defaultBranch
    });

    return { success: true, prUrl: pr.html_url, prNumber: pr.number };

  } catch (error) {
    console.error('Failed to propose fix:', error);
    return { success: false, error: error.message || 'Failed to create PR' };
  }
}

/**
 * Get all tags
 */
async function getTags() {
  const stored = await chrome.storage.local.get(['tags']);
  return { tags: stored.tags || [] };
}

/**
 * Create a new tag
 */
async function createTag(name, color) {
  try {
    if (!name || name.length < 2 || name.length > 30) {
      return { success: false, error: 'Tag name must be 2-30 characters' };
    }
    if (!/^[\w\s-]+$/.test(name)) {
      return { success: false, error: 'Tag name can only contain letters, numbers, spaces, and hyphens' };
    }

    const stored = await chrome.storage.local.get(['tags']);
    const tags = stored.tags || [];

    // Check for duplicates (case-insensitive)
    if (tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      return { success: false, error: 'Tag already exists' };
    }

    const tag = {
      id: `tag-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      name: name.trim(),
      color: color || getDefaultTagColor(name),
      enabled: true,
      createdAt: new Date().toISOString()
    };

    tags.push(tag);
    await chrome.storage.local.set({ tags });
    return { success: true, tag };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update a tag
 */
async function updateTag(tagId, updates) {
  try {
    const stored = await chrome.storage.local.get(['tags']);
    const tags = stored.tags || [];
    const index = tags.findIndex(t => t.id === tagId);

    if (index === -1) {
      return { success: false, error: 'Tag not found' };
    }

    tags[index] = { ...tags[index], ...updates };
    await chrome.storage.local.set({ tags });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete a tag
 */
async function deleteTag(tagId) {
  try {
    const stored = await chrome.storage.local.get(['tags', 'userRules']);
    const tags = stored.tags || [];
    const userRules = stored.userRules || [];

    // Remove tag from tags list
    const filteredTags = tags.filter(t => t.id !== tagId);

    // Remove tag from all rules that have it
    const updatedRules = userRules.map(rule => {
      if (rule.tags && rule.tags.includes(tagId)) {
        return { ...rule, tags: rule.tags.filter(t => t !== tagId) };
      }
      return rule;
    });

    await chrome.storage.local.set({ tags: filteredTags, userRules: updatedRules });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Toggle a tag's enabled state (different from toggleRule)
 */
async function toggleTag(tagId, enabled) {
  try {
    const stored = await chrome.storage.local.get(['tags']);
    const tags = stored.tags || [];
    const index = tags.findIndex(t => t.id === tagId);

    if (index === -1) {
      return { success: false, error: 'Tag not found' };
    }

    tags[index].enabled = enabled;
    await chrome.storage.local.set({ tags });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Add a tag to a rule
 */
async function addTagToRule(ruleId, tagId) {
  try {
    const stored = await chrome.storage.local.get(['userRules', 'tags']);
    const userRules = stored.userRules || [];
    const tags = stored.tags || [];

    // Verify tag exists
    if (!tags.some(t => t.id === tagId)) {
      return { success: false, error: 'Tag not found' };
    }

    const ruleIndex = userRules.findIndex(r => r.id === ruleId);
    if (ruleIndex === -1) {
      return { success: false, error: 'Rule not found' };
    }

    // Initialize tags array if needed
    if (!userRules[ruleIndex].tags) {
      userRules[ruleIndex].tags = [];
    }

    // Add tag if not already present
    if (!userRules[ruleIndex].tags.includes(tagId)) {
      userRules[ruleIndex].tags.push(tagId);
      await chrome.storage.local.set({ userRules });
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Remove a tag from a rule
 */
async function removeTagFromRule(ruleId, tagId) {
  try {
    const stored = await chrome.storage.local.get(['userRules']);
    const userRules = stored.userRules || [];

    const ruleIndex = userRules.findIndex(r => r.id === ruleId);
    if (ruleIndex === -1) {
      return { success: false, error: 'Rule not found' };
    }

    if (userRules[ruleIndex].tags) {
      userRules[ruleIndex].tags = userRules[ruleIndex].tags.filter(t => t !== tagId);
      await chrome.storage.local.set({ userRules });
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Save multiple rules at once (batch mode)
 */
async function saveBatchRules(rulesData) {
  try {
    if (!Array.isArray(rulesData) || rulesData.length === 0) {
      return { success: false, error: 'No rules to save' };
    }

    const stored = await chrome.storage.local.get(['userRules']);
    const userRules = stored.userRules || [];
    const savedIds = [];

    for (const ruleData of rulesData) {
      const rule = {
        id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        ...ruleData,
        source: 'user',
        enabled: true,
        metadata: {
          ...ruleData.metadata,
          createdAt: new Date().toISOString()
        }
      };
      userRules.push(rule);
      savedIds.push(rule.id);
    }

    await chrome.storage.local.set({ userRules });
    return { success: true, ruleIds: savedIds, count: savedIds.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get default color for a tag based on name hash
 */
function getDefaultTagColor(name) {
  const colors = ['#4285f4', '#ea4335', '#fbbc04', '#34a853', '#673ab7', '#e91e63'];
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

/**
 * GitHub API helper
 */
async function githubApi(endpoint, token, method = 'GET', body = null) {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Xorcist-Extension'
  };

  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const options = { method, headers };

  if (body) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `GitHub API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Helper functions
 */
function sanitizeForBranch(str) {
  return str.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 30);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractXPattern(content) {
  const patterns = [
    /\bX\b/,
    /\bX\.com\b/i,
    /\bTwitter\s*X\b/i
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[0];
  }

  return content.substring(0, 50);
}

function formatPRBody(proposal, rule) {
  let changeSection = '';

  if (proposal.action === 'replace' && proposal.replacement) {
    // Show diff format for replacements
    changeSection = `### Changes (Diff)
\`\`\`diff
- ${proposal.originalContent.split('\n').join('\n- ')}
+ ${proposal.replacement.split('\n').join('\n+ ')}
\`\`\``;
  } else if (proposal.action === 'remove') {
    changeSection = `### Content to Remove
\`\`\`diff
- ${proposal.originalContent.split('\n').join('\n- ')}
\`\`\``;
  } else {
    changeSection = `### Original Content
\`\`\`
${proposal.originalContent}
\`\`\``;
  }

  return `## Xorcist Rule Proposal

**Site:** ${proposal.hostname}
**URL:** ${proposal.url}
**Action:** \`${proposal.action}\`

${changeSection}

### Selector
\`\`\`css
${proposal.selector}
\`\`\`

${proposal.notes ? `### Notes\n${proposal.notes}\n` : ''}
---
*This PR was automatically generated by the Xorcist browser extension.*
`;
}
