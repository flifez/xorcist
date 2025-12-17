/**
 * Replacer - Applies rules to replace/remove X branding
 * Scans the page for content matching saved rules
 */

const XorcistReplacer = {
  rules: [],
  enabled: true,
  appliedCount: 0,
  debug: false, // Set to true to enable verbose logging

  /**
   * Initialize with rules from storage
   */
  async init() {
    await this.loadRules();

    // Apply rules after loading
    this.applyAll();

    // Listen for rule updates
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.communityRules || changes.userRules || changes.disabledRuleIds || changes.tags) {
          this.loadRules().then(() => this.applyAll());
        }
        if (changes.enabled !== undefined) {
          this.enabled = changes.enabled.newValue;
          this.applyAll();
        }
      }
    });
  },

  /**
   * Load and merge rules from storage
   */
  async loadRules() {
    const stored = await chrome.storage.local.get([
      'communityRules',
      'userRules',
      'disabledRuleIds',
      'enabled',
      'tags'
    ]);

    const disabled = new Set(stored.disabledRuleIds || []);
    const tags = stored.tags || [];
    const disabledTagIds = new Set(tags.filter(t => !t.enabled).map(t => t.id));
    this.enabled = stored.enabled !== false;

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

    // User rules first (higher priority), then community rules
    const userRules = (stored.userRules || []).filter(isRuleEnabled);
    const communityRules = (stored.communityRules || []).filter(isRuleEnabled);

    this.rules = [...userRules, ...communityRules];
  },

  /**
   * Apply all matching rules to the page
   * Rule-driven: for each rule, find matching content
   */
  applyAll() {
    if (!this.enabled) {
      if (this.debug) console.log('Xorcist: Disabled, skipping');
      return;
    }

    const hostname = window.location.hostname;
    this.appliedCount = 0;

    if (this.debug) {
      console.log(`Xorcist: ${this.rules.length} total rules, hostname: ${hostname}`);
    }

    // Get rules that apply to this hostname
    const applicableRules = this.rules.filter(rule => {
      if (!rule.hostname || rule.hostname === '*') return true;
      return hostname.includes(rule.hostname);
    });

    if (this.debug) {
      console.log(`Xorcist: ${applicableRules.length} rules apply to this hostname`);
      applicableRules.forEach(r => console.log(`  - ${r.action}: "${r.contentPattern}" on ${r.hostname}`));
    }

    if (!applicableRules.length) return;

    // For each rule, find and apply to matching content
    for (const rule of applicableRules) {
      this.applyRuleToPage(rule);
    }

    if (this.appliedCount > 0) {
      console.log(`Xorcist: Applied ${this.appliedCount} replacements`);
    } else if (this.debug) {
      console.log('Xorcist: No content matched any rules');
    }
  },

  /**
   * Apply a single rule to the entire page
   */
  applyRuleToPage(rule) {
    if (!rule.contentPattern && !rule.selector) return;

    // Try selector-based matching first (most specific)
    if (rule.selector) {
      try {
        const elements = document.querySelectorAll(rule.selector);
        for (const el of elements) {
          if (!el.hasAttribute('data-xorcist-processed')) {
            this.applyRuleToElement(el, rule);
          }
        }
      } catch (e) {
        // Invalid selector, fall through to content matching
      }
    }

    // Content-based matching (scans all text)
    if (rule.contentPattern) {
      this.applyRuleByContent(rule);
    }
  },

  /**
   * Find and apply rule by content pattern
   */
  applyRuleByContent(rule) {
    let regex;
    try {
      regex = new RegExp(rule.contentPattern, 'gi');
    } catch (e) {
      if (this.debug) console.log(`Xorcist: Invalid regex pattern: ${rule.contentPattern}`);
      return; // Invalid regex
    }

    // For 'remove' and 'hide' actions, use element-level handling
    // This prevents accidentally removing letters from words (e.g., "x" from "example")
    if (rule.action === 'remove' || rule.action === 'hide') {
      this.applyRuleToMatchingElements(rule, regex);
      return;
    }

    // For 'replace' action, do text-level replacement
    this.replaceMatchingText(rule, regex);
  },

  /**
   * Find and apply rule to elements matching the pattern
   * Used for 'remove' and 'hide' actions to avoid substring issues
   */
  applyRuleToMatchingElements(rule, regex) {
    // Find all elements that could contain matching content
    const allElements = document.body.querySelectorAll('*:not(script):not(style):not(noscript)');
    const patternLen = rule.contentPattern.length;

    for (const el of allElements) {
      if (el.hasAttribute('data-xorcist-processed')) continue;

      const text = el.textContent.trim();
      if (!text) continue;

      regex.lastIndex = 0;
      if (!regex.test(text)) continue;

      // Determine if this element should be removed
      let shouldRemove = false;

      // For very short patterns (like "x"), require near-exact match
      // This prevents removing paragraphs that happen to contain the letter
      if (patternLen <= 3) {
        // Only remove if element text is essentially just the pattern
        // Allow some whitespace and punctuation around it
        const normalized = text.toLowerCase().replace(/[\s\-–—•·|/\\:,;.!?'"()[\]{}]+/g, '');
        if (normalized.length <= patternLen + 2) {
          shouldRemove = true;
        }
      }
      // For medium patterns, be more lenient
      else if (patternLen <= 20) {
        if (text.length <= patternLen * 3) {
          shouldRemove = true;
        }
      }
      // For longer patterns, trust the match
      else {
        shouldRemove = true;
      }

      // Only remove leaf elements or elements with minimal nested content
      if (shouldRemove && (el.children.length === 0 || text.length < 100)) {
        if (this.debug) console.log(`Xorcist: Removing element with text: "${text.substring(0, 50)}"`);
        this.applyRuleToElement(el, rule);
      }
    }
  },

  /**
   * Replace text content matching the pattern
   * Used for 'replace' action
   */
  replaceMatchingText(rule, regex) {
    // Walk all text nodes
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          // Skip script, style, and already processed nodes
          const tag = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'textarea', 'input'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }

          if (parent.closest('[data-xorcist-processed]')) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodesToProcess = [];
    let node;

    while ((node = walker.nextNode())) {
      regex.lastIndex = 0;
      if (regex.test(node.textContent)) {
        nodesToProcess.push(node);
      }
    }

    // Apply rule to matching nodes
    for (const textNode of nodesToProcess) {
      this.applyRuleToTextNode(textNode, rule);
    }
  },

  /**
   * Apply rule to a text node (for replace action)
   */
  applyRuleToTextNode(textNode, rule) {
    const parent = textNode.parentElement;
    if (!parent || parent.hasAttribute('data-xorcist-processed')) return;

    let regex;
    try {
      regex = new RegExp(rule.contentPattern, 'gi');
    } catch (e) {
      return;
    }

    switch (rule.action) {
      case 'remove':
        const newText = textNode.textContent.replace(regex, '');
        if (newText !== textNode.textContent) {
          textNode.textContent = newText;
          parent.setAttribute('data-xorcist-processed', 'true');
          this.appliedCount++;
        }
        break;

      case 'replace':
        const replaced = textNode.textContent.replace(regex, rule.replacement || '');
        if (replaced !== textNode.textContent) {
          textNode.textContent = replaced;
          parent.setAttribute('data-xorcist-processed', 'true');
          this.appliedCount++;
        }
        break;
    }
  },

  /**
   * Apply rule to an element
   */
  applyRuleToElement(element, rule) {
    if (element.hasAttribute('data-xorcist-processed')) return;

    element.setAttribute('data-xorcist-processed', 'true');
    this.appliedCount++;

    switch (rule.action) {
      case 'remove':
        element.remove();
        break;

      case 'replace':
        if (rule.replacement) {
          element.innerHTML = rule.replacement;
        }
        break;

      case 'hide':
        element.style.display = 'none';
        break;
    }
  },

  /**
   * Generate a CSS selector for an element (for reference)
   */
  getSelector(element) {
    if (element.id) return `#${element.id}`;

    const parts = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2);
        for (const cls of classes) {
          if (cls && !cls.startsWith('xorcist-')) {
            selector += `.${cls}`;
          }
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(' > ');
  }
};

// Initialize
XorcistReplacer.init();

// Expose to other content scripts
window.XorcistReplacer = XorcistReplacer;
