/**
 * Reporter - Element picker and inline editor for proposing fixes
 * Similar to ad blocker element pickers
 */

const XorcistReporter = {
  isActive: false,
  selectedElement: null,
  originalContent: null,
  highlightedElement: null,
  toolbar: null,
  editPanel: null,
  lastSavedRuleId: null,
  matchAllSites: false,
  pendingNotes: '',
  // Batch mode state
  batchMode: false,
  onRuleCreated: null,

  /**
   * Initialize the reporter
   */
  init() {
    this.createToolbar();
    this.createEditPanel();
    this.setupMessageListener();
  },

  /**
   * Create the floating toolbar
   */
  createToolbar() {
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'xorcist-toolbar';
    this.toolbar.innerHTML = `
      <div class="xorcist-toolbar-content">
        <span class="xorcist-toolbar-hint">Click any element to select</span>
        <div class="xorcist-toolbar-actions" style="display:none">
          <button class="xorcist-btn xorcist-btn-edit" title="Edit element (E)">Edit</button>
          <button class="xorcist-btn xorcist-btn-remove" title="Remove element (D)">Remove</button>
          <button class="xorcist-btn xorcist-btn-save" title="Save rule (Enter)">Save</button>
        </div>
        <button class="xorcist-btn xorcist-btn-cancel">Cancel</button>
      </div>
    `;

    // Button handlers
    this.toolbar.querySelector('.xorcist-btn-edit').onclick = () => this.enableEditing();
    this.toolbar.querySelector('.xorcist-btn-remove').onclick = () => this.markForRemoval();
    this.toolbar.querySelector('.xorcist-btn-save').onclick = () => this.save();
    this.toolbar.querySelector('.xorcist-btn-cancel').onclick = () => this.deactivate();
  },

  /**
   * Create the editing panel
   */
  createEditPanel() {
    this.editPanel = document.createElement('div');
    this.editPanel.id = 'xorcist-edit-panel';
    this.editPanel.innerHTML = `
      <div class="xorcist-edit-panel-header">
        <span class="xorcist-edit-panel-title">Edit Element</span>
        <button class="xorcist-edit-panel-close">&times;</button>
      </div>
      <div class="xorcist-edit-panel-body">
        <div class="xorcist-edit-section">
          <label class="xorcist-edit-label">Original Content (read-only)</label>
          <pre class="xorcist-edit-original"></pre>
        </div>
        <div class="xorcist-edit-section">
          <label class="xorcist-edit-label">Replacement Content</label>
          <textarea class="xorcist-edit-textarea" placeholder="Enter replacement content..."></textarea>
        </div>
        <div class="xorcist-edit-section">
          <label class="xorcist-edit-label">Notes (optional - included when sharing to community)</label>
          <textarea class="xorcist-edit-notes" placeholder="Why this change? Any context for reviewers..."></textarea>
        </div>
      </div>
      <div class="xorcist-edit-panel-footer">
        <button class="xorcist-btn xorcist-btn-cancel xorcist-edit-cancel">Cancel</button>
        <button class="xorcist-btn xorcist-btn-save xorcist-edit-apply">Apply Changes</button>
      </div>
    `;

    // Panel handlers
    this.editPanel.querySelector('.xorcist-edit-panel-close').onclick = () => this.closeEditPanel();
    this.editPanel.querySelector('.xorcist-edit-cancel').onclick = () => this.closeEditPanel();
    this.editPanel.querySelector('.xorcist-edit-apply').onclick = () => this.applyEdit();
  },

  /**
   * Listen for messages from popup/background
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'START_SELECTION':
          this.activate();
          sendResponse({ status: 'ok' });
          break;
        case 'CANCEL_SELECTION':
          this.deactivate();
          sendResponse({ status: 'ok' });
          break;
        case 'GET_STATS':
          const { textOccurrences, elementOccurrences } = XorcistDetector.scan();
          sendResponse({
            textCount: textOccurrences.length,
            elementCount: elementOccurrences.length
          });
          break;
        case 'APPLY_RULES':
          XorcistReplacer.applyAll();
          sendResponse({ status: 'ok' });
          break;
      }
      return true;
    });
  },

  /**
   * Activate element picker mode
   */
  activate() {
    if (this.isActive) return;
    this.isActive = true;

    document.body.appendChild(this.toolbar);
    this.toolbar.classList.add('xorcist-visible');

    // Show hint, hide actions
    this.toolbar.querySelector('.xorcist-toolbar-hint').style.display = '';
    this.toolbar.querySelector('.xorcist-toolbar-actions').style.display = 'none';

    document.addEventListener('mousemove', this.handleMouseMove, true);
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('keydown', this.handleKeydown, true);

    // Prevent scrolling while picking
    document.body.style.cursor = 'crosshair';
  },

  /**
   * Deactivate picker mode
   */
  deactivate() {
    if (!this.isActive) return;
    this.isActive = false;

    // Restore original content if not submitted
    if (this.selectedElement) {
      this.selectedElement.classList.remove('xorcist-highlight', 'xorcist-selected', 'xorcist-editing', 'xorcist-removed');
      if (this.originalContent !== null) {
        this.selectedElement.outerHTML = this.originalContent;
      }
    }

    // Clear highlight
    if (this.highlightedElement) {
      this.highlightedElement.classList.remove('xorcist-highlight');
    }

    // Remove edit panel if open
    if (this.editPanel.parentElement) {
      this.editPanel.classList.remove('xorcist-visible');
      this.editPanel.remove();
    }

    // Remove toolbar
    this.toolbar.classList.remove('xorcist-visible');
    setTimeout(() => this.toolbar.remove(), 200);

    // Remove listeners
    document.removeEventListener('mousemove', this.handleMouseMove, true);
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('keydown', this.handleKeydown, true);

    document.body.style.cursor = '';
    this.selectedElement = null;
    this.originalContent = null;
    this.highlightedElement = null;
    this.pendingNotes = '';
  },

  /**
   * Handle mouse movement for highlighting
   */
  handleMouseMove: function(e) {
    if (!XorcistReporter.isActive || XorcistReporter.selectedElement) return;

    const target = e.target;

    // Don't highlight our own UI
    if (target.closest('#xorcist-toolbar') || target.closest('.xorcist-toast') || target.closest('#xorcist-edit-panel') || target.closest('#xorcist-batch-panel')) return;

    // Remove previous highlight
    if (XorcistReporter.highlightedElement && XorcistReporter.highlightedElement !== target) {
      XorcistReporter.highlightedElement.classList.remove('xorcist-highlight');
    }

    // Add highlight to current target
    target.classList.add('xorcist-highlight');
    XorcistReporter.highlightedElement = target;
  },

  /**
   * Handle click to select element
   */
  handleClick: function(e) {
    if (!XorcistReporter.isActive) return;

    // Ignore clicks on our UI
    if (e.target.closest('#xorcist-toolbar') || e.target.closest('.xorcist-toast') || e.target.closest('#xorcist-edit-panel') || e.target.closest('#xorcist-batch-panel')) return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.target;

    // If already have a selection, this click might be for editing
    if (XorcistReporter.selectedElement) {
      if (target === XorcistReporter.selectedElement || XorcistReporter.selectedElement.contains(target)) {
        return; // Allow interaction with selected element
      }
      // Clicking elsewhere - deselect and select new
      XorcistReporter.selectedElement.classList.remove('xorcist-selected', 'xorcist-editing', 'xorcist-removed');
      if (XorcistReporter.originalContent !== null) {
        XorcistReporter.selectedElement.outerHTML = XorcistReporter.originalContent;
      }
      // Close edit panel if open
      if (XorcistReporter.editPanel.parentElement) {
        XorcistReporter.editPanel.classList.remove('xorcist-visible');
        XorcistReporter.editPanel.remove();
      }
    }

    // Select the element
    target.classList.remove('xorcist-highlight');
    target.classList.add('xorcist-selected');

    XorcistReporter.selectedElement = target;
    XorcistReporter.originalContent = XorcistReporter.getCleanOuterHTML(target);
    XorcistReporter.highlightedElement = null;

    // Update toolbar
    XorcistReporter.toolbar.querySelector('.xorcist-toolbar-hint').style.display = 'none';
    XorcistReporter.toolbar.querySelector('.xorcist-toolbar-actions').style.display = 'flex';
  },

  /**
   * Handle keyboard shortcuts
   */
  handleKeydown: function(e) {
    if (!XorcistReporter.isActive) return;

    // Allow typing in edit panel textarea
    if (e.target.closest('#xorcist-edit-panel')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        XorcistReporter.closeEditPanel();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      XorcistReporter.deactivate();
    }

    // Shortcuts when element is selected
    if (XorcistReporter.selectedElement) {
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        XorcistReporter.enableEditing();
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        XorcistReporter.markForRemoval();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        XorcistReporter.save();
      }
    }
  },

  /**
   * Show edit panel for selected element
   */
  enableEditing() {
    if (!this.selectedElement) return;

    this.selectedElement.classList.remove('xorcist-removed');
    this.selectedElement.classList.add('xorcist-editing');

    // Populate edit panel with original content
    const originalPre = this.editPanel.querySelector('.xorcist-edit-original');
    const editTextarea = this.editPanel.querySelector('.xorcist-edit-textarea');
    const notesTextarea = this.editPanel.querySelector('.xorcist-edit-notes');

    // Show the content (use textContent for text, innerHTML for HTML structure)
    const content = this.originalContent;
    originalPre.textContent = content;
    editTextarea.value = content;
    notesTextarea.value = this.pendingNotes || '';

    // Show the panel
    document.body.appendChild(this.editPanel);
    this.editPanel.classList.add('xorcist-visible');
    editTextarea.focus();
    editTextarea.select();
  },

  /**
   * Close the edit panel without applying changes
   */
  closeEditPanel() {
    this.editPanel.classList.remove('xorcist-visible');
    setTimeout(() => this.editPanel.remove(), 200);

    if (this.selectedElement) {
      this.selectedElement.classList.remove('xorcist-editing');
    }
  },

  /**
   * Apply changes from edit panel to element
   */
  applyEdit() {
    if (!this.selectedElement) return;

    const editTextarea = this.editPanel.querySelector('.xorcist-edit-textarea');
    const notesTextarea = this.editPanel.querySelector('.xorcist-edit-notes');
    const newContent = editTextarea.value;

    // Store notes for when rule is saved
    this.pendingNotes = notesTextarea.value.trim();

    // Get parent and position before replacement
    const parent = this.selectedElement.parentElement;
    const nextSibling = this.selectedElement.nextSibling;

    // Replace the element using outerHTML
    this.selectedElement.outerHTML = newContent;

    // Get reference to the new element
    if (nextSibling) {
      this.selectedElement = nextSibling.previousElementSibling;
    } else if (parent) {
      this.selectedElement = parent.lastElementChild;
    }

    // Re-apply selected class to new element
    if (this.selectedElement) {
      this.selectedElement.classList.add('xorcist-selected');
    }

    // Close the panel
    this.editPanel.classList.remove('xorcist-visible');
    setTimeout(() => this.editPanel.remove(), 200);
  },

  /**
   * Mark element for removal
   */
  markForRemoval() {
    if (!this.selectedElement) return;

    // Close edit panel if open
    if (this.editPanel.parentElement) {
      this.editPanel.classList.remove('xorcist-visible');
      this.editPanel.remove();
    }

    this.selectedElement.classList.remove('xorcist-editing');
    this.selectedElement.classList.add('xorcist-removed');
  },

  /**
   * Create a rule object from the current selection
   */
  createRuleObject() {
    if (!this.selectedElement) return null;

    const isRemoval = this.selectedElement.classList.contains('xorcist-removed');
    const newContent = this.getCleanOuterHTML(this.selectedElement);

    let action, replacement;
    if (isRemoval) {
      action = 'remove';
      replacement = null;
    } else {
      action = 'replace';
      replacement = newContent;
    }

    return {
      hostname: window.location.hostname,
      urlPattern: window.location.hostname.replace(/\./g, '\\.'),
      selector: this.generateSelector(this.selectedElement),
      contentPattern: this.escapeRegex(this.originalContent.substring(0, 100)),
      action,
      replacement,
      metadata: {
        reportedUrl: window.location.href,
        originalContent: this.originalContent,
        notes: this.pendingNotes || null
      }
    };
  },

  /**
   * Reset selection for next pick (batch mode)
   */
  resetForNextSelection() {
    // Clear current selection
    if (this.selectedElement) {
      this.selectedElement.classList.remove('xorcist-selected', 'xorcist-editing', 'xorcist-removed');
      this.originalContent = null;
    }

    this.selectedElement = null;
    this.originalContent = null;
    this.highlightedElement = null;
    this.pendingNotes = '';

    // Reset toolbar to hint mode
    this.toolbar.querySelector('.xorcist-toolbar-hint').style.display = '';
    this.toolbar.querySelector('.xorcist-toolbar-actions').style.display = 'none';
  },

  /**
   * Activate batch mode with callback
   */
  activateBatchMode(onRuleCreated) {
    this.batchMode = true;
    this.onRuleCreated = onRuleCreated;

    // Update toolbar button text
    const saveBtn = this.toolbar.querySelector('.xorcist-btn-save');
    saveBtn.textContent = 'Add to Batch';
    saveBtn.title = 'Add rule to batch (Enter)';

    this.activate();
  },

  /**
   * Deactivate batch mode
   */
  deactivateBatchMode() {
    this.batchMode = false;
    this.onRuleCreated = null;

    // Reset toolbar button text
    const saveBtn = this.toolbar.querySelector('.xorcist-btn-save');
    saveBtn.textContent = 'Save';
    saveBtn.title = 'Save rule (Enter)';

    this.deactivate();
  },

  /**
   * Save the rule locally (or add to batch if in batch mode)
   */
  async save() {
    if (!this.selectedElement) return;

    const isRemoval = this.selectedElement.classList.contains('xorcist-removed');
    const newContent = this.getCleanOuterHTML(this.selectedElement);
    const hasChanges = isRemoval || newContent !== this.originalContent;

    if (!hasChanges) {
      this.showToast('No changes made. Edit the element or mark for removal.', 'error');
      return;
    }

    const rule = this.createRuleObject();
    if (!rule) return;

    // Batch mode: add to batch panel instead of saving
    if (this.batchMode && this.onRuleCreated) {
      // Keep the changes visible
      this.selectedElement.classList.remove('xorcist-selected', 'xorcist-editing');
      this.originalContent = null;

      // Add to batch
      this.onRuleCreated(rule);
      this.showToast('Rule added to batch', 'success');

      // Reset for next selection
      this.resetForNextSelection();
      return;
    }

    // Normal mode: save directly
    const saveBtn = this.toolbar.querySelector('.xorcist-btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_LOCAL_RULE',
        rule
      });

      if (response.success) {
        this.lastSavedRuleId = response.ruleId;

        // Keep the changes visible
        this.selectedElement.classList.remove('xorcist-selected', 'xorcist-editing');
        this.originalContent = null; // Prevent restore on deactivate

        // Show toast with share option
        this.showToastWithAction(
          'Rule saved!',
          'Share to community',
          () => this.shareLastRule(),
          'success'
        );

        this.deactivate();
      } else {
        this.showToast(response.error || 'Failed to save', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    } catch (err) {
      this.showToast('Error: ' + err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  },

  /**
   * Share the last saved rule to community
   */
  async shareLastRule() {
    if (!this.lastSavedRuleId) return;

    this.showToast('Creating PR...', 'info');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SHARE_RULE',
        ruleId: this.lastSavedRuleId
      });

      if (response.success) {
        this.showToastWithAction(
          'PR created!',
          'View PR',
          () => window.open(response.prUrl, '_blank'),
          'success'
        );
      } else {
        this.showToast(response.error || 'Failed to create PR', 'error');
      }
    } catch (err) {
      this.showToast('Error: ' + err.message, 'error');
    }
  },

  /**
   * Escape special regex characters
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  /**
   * Generate a unique CSS selector for an element
   */
  generateSelector(element) {
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    const path = [];
    let current = element;

    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();

      // Add classes (limit to avoid overly specific selectors)
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2);
        for (const cls of classes) {
          if (cls && !cls.startsWith('xorcist-')) {
            selector += `.${CSS.escape(cls)}`;
          }
        }
      }

      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          c => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  },

  /**
   * Get clean outerHTML with xorcist classes stripped out
   */
  getCleanOuterHTML(element) {
    // Clone the element to avoid modifying the original
    const clone = element.cloneNode(true);

    // Remove xorcist classes from clone and all descendants
    const removeXorcistClasses = (el) => {
      if (el.classList) {
        const toRemove = [];
        el.classList.forEach(cls => {
          if (cls.startsWith('xorcist-')) {
            toRemove.push(cls);
          }
        });
        toRemove.forEach(cls => el.classList.remove(cls));

        // Clean up empty class attribute
        if (el.classList.length === 0) {
          el.removeAttribute('class');
        }
      }
    };

    removeXorcistClasses(clone);
    clone.querySelectorAll('*').forEach(removeXorcistClasses);

    return clone.outerHTML;
  },

  /**
   * Show a toast notification
   */
  showToast(message, type = 'info') {
    // Remove any existing toasts
    document.querySelectorAll('.xorcist-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `xorcist-toast xorcist-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('xorcist-toast-visible');
    });

    setTimeout(() => {
      toast.classList.remove('xorcist-toast-visible');
      setTimeout(() => toast.remove(), 200);
    }, 3000);
  },

  /**
   * Show a toast with an action button
   */
  showToastWithAction(message, actionText, actionFn, type = 'info') {
    // Remove any existing toasts
    document.querySelectorAll('.xorcist-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `xorcist-toast xorcist-toast-${type} xorcist-toast-with-action`;
    toast.innerHTML = `
      <span class="xorcist-toast-message">${message}</span>
      <button class="xorcist-toast-action">${actionText}</button>
    `;

    toast.querySelector('.xorcist-toast-action').onclick = (e) => {
      e.stopPropagation();
      actionFn();
      toast.classList.remove('xorcist-toast-visible');
      setTimeout(() => toast.remove(), 200);
    };

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('xorcist-toast-visible');
    });

    // Longer timeout for action toasts
    setTimeout(() => {
      toast.classList.remove('xorcist-toast-visible');
      setTimeout(() => toast.remove(), 200);
    }, 6000);
  }
};

// Initialize when DOM is ready
XorcistReporter.init();

// Watch for DOM changes (rules are applied by replacer.init())
const observer = new MutationObserver(() => {
  XorcistReplacer.applyAll();
});
observer.observe(document.body, { childList: true, subtree: true });

// Expose to window
window.XorcistReporter = XorcistReporter;
