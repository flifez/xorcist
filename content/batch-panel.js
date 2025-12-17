/**
 * Batch Panel - Draggable floating panel for batch rule creation
 * Allows users to add multiple rules and save them all at once
 */

const XorcistBatchPanel = {
  isVisible: false,
  position: { x: null, y: null },
  pendingRules: [],
  panel: null,
  isDragging: false,
  dragOffset: { x: 0, y: 0 },

  /**
   * Initialize the batch panel
   */
  init() {
    this.createPanel();
    this.setupMessageListener();
  },

  /**
   * Create the panel DOM element
   */
  createPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'xorcist-batch-panel';
    this.panel.innerHTML = `
      <div class="xorcist-batch-header">
        <div class="xorcist-batch-header-drag">
          <div class="xorcist-batch-drag-line"></div>
          <div class="xorcist-batch-drag-line"></div>
          <div class="xorcist-batch-drag-line"></div>
        </div>
        <span class="xorcist-batch-title">Batch Edit</span>
        <span class="xorcist-batch-count">0</span>
      </div>
      <div class="xorcist-batch-body">
        <p class="xorcist-batch-empty">No rules added yet. Select elements to add rules.</p>
      </div>
      <div class="xorcist-batch-footer">
        <button class="xorcist-batch-btn xorcist-batch-btn-add">+ Add</button>
        <button class="xorcist-batch-btn xorcist-batch-btn-save" disabled>Save All (0)</button>
      </div>
    `;

    // Setup drag handlers on header
    const header = this.panel.querySelector('.xorcist-batch-header');
    header.addEventListener('mousedown', (e) => this.startDrag(e));
    document.addEventListener('mousemove', (e) => this.onDrag(e));
    document.addEventListener('mouseup', () => this.endDrag());

    // Button handlers
    this.panel.querySelector('.xorcist-batch-btn-add').onclick = () => {
      if (window.XorcistReporter && window.XorcistReporter.isActive) {
        // Already active, just continue
        return;
      }
      // Activate picker in batch mode
      if (window.XorcistReporter) {
        window.XorcistReporter.activateBatchMode((rule) => {
          this.addRule(rule);
        });
      }
    };

    this.panel.querySelector('.xorcist-batch-btn-save').onclick = () => this.saveAll();
  },

  /**
   * Setup message listener for batch mode activation
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'START_BATCH_MODE') {
        this.show();
        // Activate picker in batch mode
        if (window.XorcistReporter) {
          window.XorcistReporter.activateBatchMode((rule) => {
            this.addRule(rule);
          });
        }
        sendResponse({ status: 'ok' });
      }
      return false;
    });
  },

  /**
   * Show the panel
   */
  show() {
    if (!document.body.contains(this.panel)) {
      document.body.appendChild(this.panel);
    }

    // Set initial position if not set
    if (this.position.x === null || this.position.y === null) {
      this.position.x = window.innerWidth - 340;
      this.position.y = 100;
    }

    // Clamp position to viewport
    this.position.x = Math.max(20, Math.min(this.position.x, window.innerWidth - 340));
    this.position.y = Math.max(20, Math.min(this.position.y, window.innerHeight - 200));

    this.panel.style.left = this.position.x + 'px';
    this.panel.style.top = this.position.y + 'px';
    this.panel.style.display = 'flex';
    this.isVisible = true;
  },

  /**
   * Hide the panel
   */
  hide() {
    this.panel.style.display = 'none';
    this.isVisible = false;
    // Deactivate batch mode in reporter
    if (window.XorcistReporter) {
      window.XorcistReporter.deactivateBatchMode();
    }
  },

  /**
   * Add a rule to the pending list
   */
  addRule(rule) {
    // Generate temporary ID
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const pendingRule = { ...rule, tempId };
    this.pendingRules.push(pendingRule);
    this.render();
  },

  /**
   * Remove a rule from the pending list
   */
  removeRule(tempId) {
    this.pendingRules = this.pendingRules.filter(r => r.tempId !== tempId);
    this.render();
  },

  /**
   * Render the pending rules list
   */
  render() {
    const body = this.panel.querySelector('.xorcist-batch-body');
    const count = this.panel.querySelector('.xorcist-batch-count');
    const saveBtn = this.panel.querySelector('.xorcist-batch-btn-save');

    count.textContent = this.pendingRules.length;
    saveBtn.textContent = `Save All (${this.pendingRules.length})`;
    saveBtn.disabled = this.pendingRules.length === 0;

    if (this.pendingRules.length === 0) {
      body.innerHTML = '<p class="xorcist-batch-empty">No rules added yet. Select elements to add rules.</p>';
      return;
    }

    body.innerHTML = this.pendingRules.map(rule => `
      <div class="xorcist-batch-rule" data-temp-id="${this.escapeHtml(rule.tempId)}">
        <div class="xorcist-batch-rule-info">
          <div class="xorcist-batch-rule-hostname">${this.escapeHtml(rule.hostname || '*')}</div>
          <div class="xorcist-batch-rule-detail">
            <span class="xorcist-batch-rule-action ${rule.action}">${rule.action}</span>
            ${rule.action === 'replace' ?
              `<span class="xorcist-batch-rule-text">"${this.escapeHtml(this.truncate(rule.metadata?.originalContent || '', 20))}" → "${this.escapeHtml(this.truncate(rule.replacement || '', 20))}"</span>` :
              `<span class="xorcist-batch-rule-text">"${this.escapeHtml(this.truncate(rule.metadata?.originalContent || rule.contentPattern || '', 30))}"</span>`
            }
          </div>
        </div>
        <button class="xorcist-batch-rule-remove" title="Remove">&times;</button>
      </div>
    `).join('');

    // Add remove handlers
    body.querySelectorAll('.xorcist-batch-rule-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const ruleEl = e.target.closest('.xorcist-batch-rule');
        const tempId = ruleEl.dataset.tempId;
        this.removeRule(tempId);
      });
    });
  },

  /**
   * Save all pending rules
   */
  async saveAll() {
    if (this.pendingRules.length === 0) return;

    const saveBtn = this.panel.querySelector('.xorcist-batch-btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    // Prepare rules for saving (remove tempId)
    const rulesToSave = this.pendingRules.map(({ tempId, ...rule }) => rule);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_BATCH_RULES',
        rules: rulesToSave
      });

      if (response.success) {
        // Show success toast
        this.showToast(`${response.count} rules saved!`, 'success');
        // Clear pending rules
        this.pendingRules = [];
        this.render();
        // Hide panel and deactivate picker
        this.hide();
      } else {
        this.showToast(response.error || 'Failed to save rules', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = `Save All (${this.pendingRules.length})`;
      }
    } catch (error) {
      this.showToast('Error: ' + error.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = `Save All (${this.pendingRules.length})`;
    }
  },

  /**
   * Start dragging the panel
   */
  startDrag(e) {
    if (e.target.closest('.xorcist-batch-btn')) return; // Don't drag when clicking buttons

    this.isDragging = true;
    this.dragOffset.x = e.clientX - this.panel.offsetLeft;
    this.dragOffset.y = e.clientY - this.panel.offsetTop;
    this.panel.style.cursor = 'grabbing';
    e.preventDefault();
  },

  /**
   * Handle drag movement
   */
  onDrag(e) {
    if (!this.isDragging) return;

    let newX = e.clientX - this.dragOffset.x;
    let newY = e.clientY - this.dragOffset.y;

    // Clamp to viewport
    newX = Math.max(20, Math.min(newX, window.innerWidth - this.panel.offsetWidth - 20));
    newY = Math.max(20, Math.min(newY, window.innerHeight - this.panel.offsetHeight - 20));

    this.position.x = newX;
    this.position.y = newY;
    this.panel.style.left = newX + 'px';
    this.panel.style.top = newY + 'px';
  },

  /**
   * End dragging
   */
  endDrag() {
    if (this.isDragging) {
      this.isDragging = false;
      this.panel.style.cursor = '';
    }
  },

  /**
   * Show a toast notification
   */
  showToast(message, type = 'info') {
    if (window.XorcistReporter && window.XorcistReporter.showToast) {
      window.XorcistReporter.showToast(message, type);
    } else {
      // Fallback: create simple toast
      const toast = document.createElement('div');
      toast.className = `xorcist-toast xorcist-toast-${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }
  },

  /**
   * Escape HTML
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Truncate string
   */
  truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => XorcistBatchPanel.init());
} else {
  XorcistBatchPanel.init();
}

// Expose to other scripts
window.XorcistBatchPanel = XorcistBatchPanel;
