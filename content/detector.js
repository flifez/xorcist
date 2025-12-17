/**
 * Detector - Scans the DOM for X-related branding occurrences
 */

const XorcistDetector = {
  // Patterns to detect X branding (case variations)
  patterns: {
    text: [
      /\bX\b(?!\.\w)/g,  // Standalone "X" (not file extensions)
      /\bX\.com\b/gi,
      /\bTwitter\s*X\b/gi,
      /\bX\s*\(formerly\s*Twitter\)/gi,
    ],
    // Selectors for X branding elements
    selectors: [
      '[aria-label*="X"]',
      '[alt*="X logo"]',
      'a[href*="x.com"]',
    ]
  },

  /**
   * Find all text nodes containing potential X branding
   * @param {Element} root - Root element to search
   * @returns {Array<{node: Text, matches: Array}>}
   */
  findTextOccurrences(root = document.body) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // Skip script, style, and already processed nodes
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

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

    const occurrences = [];
    let node;

    while ((node = walker.nextNode())) {
      const text = node.textContent;
      for (const pattern of this.patterns.text) {
        pattern.lastIndex = 0;
        const matches = [...text.matchAll(pattern)];
        if (matches.length > 0) {
          occurrences.push({ node, matches, text });
        }
      }
    }

    return occurrences;
  },

  /**
   * Find elements with X branding in attributes
   * @param {Element} root - Root element to search
   * @returns {Array<Element>}
   */
  findElementOccurrences(root = document.body) {
    const elements = [];

    for (const selector of this.patterns.selectors) {
      try {
        const found = root.querySelectorAll(selector);
        elements.push(...found);
      } catch (e) {
        console.warn('Xorcist: Invalid selector', selector, e);
      }
    }

    return [...new Set(elements)]; // Dedupe
  },

  /**
   * Run full detection scan
   * @returns {{textOccurrences: Array, elementOccurrences: Array}}
   */
  scan() {
    return {
      textOccurrences: this.findTextOccurrences(),
      elementOccurrences: this.findElementOccurrences()
    };
  }
};

// Expose to other content scripts
window.XorcistDetector = XorcistDetector;
