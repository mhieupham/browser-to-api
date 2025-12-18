// ==UserScript==
// @name         ChatGPT API By Browser Script
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @grant        GM_webRequest
// @license      MIT
// ==/UserScript==

const log = (...args) => {
  console.log('perplexity-api-by-browser-script', ...args);
}
log('starting');

const WS_URL = `ws://localhost:8765`;

// Selector configurations for Perplexity
const SELECTORS = {
  input: 'textarea[name="prompt-textarea"]',//
  followUpInput: 'textarea[placeholder*="follow"]',
  submitButton: '#composer-submit-button',//
  stopButton: 'button[data-testid="stop-button"]',
  responseContainer: '.prose', // Will use querySelectorAll and get the last element
  newThreadButton: 'aside a[data-testid="create-new-chat-button"]', // Updated selector
  searchMode: 'radio[aria-label="Search"]',
  researchMode: 'radio[aria-label="Research"]',
  labsMode: 'radio[aria-label="Labs"]'
};

function cleanText(inputText) {
  // Remove invisible characters but KEEP newlines (\n = 0x0A), carriage returns (\r = 0x0D), and tabs (\t = 0x09)
  const invisibleCharsRegex =
    /[\u200B\u200C\u200D\uFEFF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  const cleanedText = inputText.replace(invisibleCharsRegex, '');
  return cleanedText;
}

// Extract text from Perplexity response with citations
function extractResponseText() {
  // First try to find the prose container
  log('🔍 [DEBUG] Searching for .prose container...');

  // ✨ IMPORTANT: Get ALL .prose elements, then use the LAST one
  const allProseElements = document.querySelectorAll(SELECTORS.responseContainer);
  log(`🔍 [DEBUG] Found ${allProseElements.length} .prose element(s) in DOM`);

  if (allProseElements.length === 0) {
    log('❌ [DEBUG] No response container found');
    return { text: '', citations: [] };
  }

  // Get the LAST .prose element (most recent response)
  const proseElement = allProseElements[allProseElements.length - 1];

  log('✅ [DEBUG] Found .prose container (LAST):', proseElement);
  log(`✅ [DEBUG] Using .prose element #${allProseElements.length} of ${allProseElements.length}`);

  // Debug: Show which prose we're using
  if (allProseElements.length > 1) {
    log(`⚠️ [DEBUG] Multiple .prose found! Using the LAST one (#${allProseElements.length})`);
  }

  let fullText = '';
  let citations = [];
  const processedElements = new Set(); // Track processed elements to avoid duplicates

  // Helper function to extract code from code blocks
  function extractCodeFromPre(preElement) {
    log('📝 [DEBUG] Found PRE element, attempting to extract code...');

    // Find language indicator
    const langIndicator = preElement.querySelector('[data-testid="code-language-indicator"]');
    let language = langIndicator ? langIndicator.textContent.trim() : '';
    log(`📝 [DEBUG] Language: ${language}`);

    // Find code element
    const codeElement = preElement.querySelector('code');
    if (!codeElement) {
      log('❌ [DEBUG] No code element found in PRE');
      return null;
    }

    // Extract raw text content
    let rawText = '';

    // Method 1: Try to extract from structured spans (Perplexity's format)
    const codeContent = codeElement.querySelector('span[style*="display: flex"]');
    if (codeContent) {
      // Get all span children that contain line content
      const lineSpans = codeContent.querySelectorAll('span[style*="opacity: 1"]');
      if (lineSpans.length > 0) {
        // Extract text from each line span, skipping line number spans
        // Line number spans have "text-align: right"
        const lines = [];
        lineSpans.forEach(span => {
          const style = span.getAttribute('style') || '';
          // Skip line number spans (they have text-align: right)
          if (!style.includes('text-align: right')) {
            // This is actual content
            const text = span.textContent;
            if (text) {
              lines.push(text);
            }
          }
        });
        rawText = lines.join('');
        log(`📝 [DEBUG] Extracted ${lines.length} content spans`);
      } else {
        // Fallback: just get all text and try to clean it
        rawText = codeContent.textContent;
      }
    } else {
      // Method 2: Fallback - get all text from code element
      log('📝 [DEBUG] Using fallback method for code extraction');
      rawText = codeElement.textContent;
    }

    // Clean up the extracted text
    // Remove line numbers pattern (number followed by whitespace at line start)
    const lines = rawText.split('\n').map(line => {
      // Remove leading line numbers (e.g., "1    ", "23   ")
      // Pattern: optional whitespace + digits + whitespace
      return line.replace(/^\s*\d+\s+/, '');
    });

    // Join and trim, but keep empty lines in the middle
    const code = lines.join('\n').trim();

    // Detect if this is a continue.dev tool call
    if (code.includes('TOOL_NAME:') && code.includes('BEGIN_ARG:') && code.includes('END_ARG')) {
      language = 'tool';
      log('📝 [DEBUG] Detected continue.dev tool call format, setting language to "tool"');
    }

    log(`📝 [DEBUG] Extracted ${lines.length} lines of code`);
    log(`📝 [DEBUG] First 200 chars: ${code.substring(0, 200)}`);

    return {
      language: language,
      code: code
    };
  }

  // Helper function to convert inline HTML formatting to Markdown
  function convertInlineFormatting(element) {
    let result = '';

    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        result += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();

        // Skip citation links - they're handled separately
        if (tagName === 'a' && node.classList.contains('citation')) {
          continue;
        }

        // Recursively convert inner content
        const innerText = convertInlineFormatting(node);

        switch(tagName) {
          case 'strong':
          case 'b':
            result += `**${innerText}**`;
            break;
          case 'em':
          case 'i':
            result += `*${innerText}*`;
            break;
          case 'code':
            // Only handle inline code (not in PRE blocks)
            if (!node.closest('pre')) {
              result += `\`${innerText}\``;
            } else {
              result += innerText;
            }
            break;
          case 'a':
            const href = node.getAttribute('href');
            if (href) {
              result += `[${innerText}](${href})`;
            } else {
              result += innerText;
            }
            break;
          case 'br':
            result += '\n';
            break;
          default:
            // For other tags, just include the inner text
            result += innerText;
        }
      }
    }

    return result;
  }

  // Helper function to extract citations from element
  function extractCitations(element) {
    const citationElements = element.querySelectorAll('a.citation');
    citationElements.forEach(citation => {
      const href = citation.getAttribute('href');
      const label = citation.getAttribute('aria-label') || '';
      if (href && !citations.some(c => c.url === href)) {
        citations.push({ url: href, label: label });
      }
    });
  }

  // Mark all descendants as processed to avoid duplicates
  function markDescendantsAsProcessed(element) {
    const allDescendants = element.querySelectorAll('*');
    allDescendants.forEach(desc => processedElements.add(desc));
  }

  // Process direct children of prose element in order
  function processElements(container) {
    // Get all direct children
    const children = Array.from(container.children);
    log(`🔍 [DEBUG] Processing ${children.length} direct children`);

    for (let element of children) {
      // Skip if already processed
      if (processedElements.has(element)) {
        log(`⏭️ [DEBUG] Skipping already processed ${element.tagName}`);
        continue;
      }

      processedElements.add(element);

      // Check for code blocks FIRST (highest priority)
      const preElement = element.tagName === 'PRE' ? element : element.querySelector('pre');
      if (preElement) {
        log('📝 [DEBUG] Found code block!');
        const codeBlock = extractCodeFromPre(preElement);
        if (codeBlock && codeBlock.code.length > 0) {
          fullText += `\n\`\`\`${codeBlock.language}\n${codeBlock.code}\n\`\`\`\n\n`;
          log(`✅ [DEBUG] Added code block (${codeBlock.language}): ${codeBlock.code.length} chars`);
        }
        // Mark all children as processed to avoid duplicates
        markDescendantsAsProcessed(element);
        continue;
      }

      // Process headers
      if (element.tagName.match(/^H[1-6]$/)) {
        extractCitations(element);
        const level = '#'.repeat(parseInt(element.tagName[1]));
        const text = convertInlineFormatting(element).trim();
        if (text) {
          fullText += `${level} ${text}\n\n`;
          log(`📝 [DEBUG] Added header: ${text.substring(0, 50)}`);
        }
        // Mark all children as processed
        markDescendantsAsProcessed(element);
        continue;
      }

      // Process paragraphs
      if (element.tagName === 'P') {
        extractCitations(element);
        const text = convertInlineFormatting(element).trim();
        if (text) {
          fullText += `${text}\n\n`;
          log(`📝 [DEBUG] Added paragraph: ${text.substring(0, 50)}`);
        }
        // Mark all children as processed
        markDescendantsAsProcessed(element);
        continue;
      }

      // Process lists
      if (element.tagName === 'UL' || element.tagName === 'OL') {
        extractCitations(element);
        const isOrdered = element.tagName === 'OL';
        const listItems = element.querySelectorAll('li');
        listItems.forEach((li, index) => {
          const text = convertInlineFormatting(li).trim();
          if (text) {
            const prefix = isOrdered ? `${index + 1}. ` : '- ';
            fullText += `${prefix}${text}\n`;
          }
        });
        fullText += '\n';
        log(`📝 [DEBUG] Added ${isOrdered ? 'ordered' : 'unordered'} list with ${listItems.length} items`);
        // Mark all children as processed
        markDescendantsAsProcessed(element);
        continue;
      }

      // Process blockquotes
      if (element.tagName === 'BLOCKQUOTE') {
        extractCitations(element);
        const text = convertInlineFormatting(element).trim();
        if (text) {
          // Handle multi-line blockquotes
          const lines = text.split('\n');
          const quotedText = lines.map(line => `> ${line}`).join('\n');
          fullText += `${quotedText}\n\n`;
          log(`📝 [DEBUG] Added blockquote`);
        }
        // Mark all children as processed
        markDescendantsAsProcessed(element);
        continue;
      }

      // If element has children, process recursively
      if (element.children.length > 0) {
        log(`🔍 [DEBUG] Processing nested children in ${element.tagName}`);
        processElements(element);
      }
    }
  }

  // Start processing
  processElements(proseElement);

  // Format citations at the end
  if (citations.length > 0) {
    log(`🔍 [DEBUG] Found ${citations.length} citation(s)`);
    fullText += '\n**References:**\n';
    citations.forEach((citation, index) => {
      fullText += `[${index + 1}] ${citation.label || citation.url}\n`;
    });
  } else {
    log('🔍 [DEBUG] No citations found');
  }

  const result = {
    text: cleanText(fullText.trim()),
    citations: citations
  };

  log(`✅ [DEBUG] Extracted text length: ${result.text.length} chars`);
  log(`✅ [DEBUG] First 500 chars: "${result.text.substring(0, 500)}..."`);

  return result;
}

// Check if response is complete
function isResponseComplete() {
  // Check if stop button exists (means still generating)
  const stopButton = document.querySelector(SELECTORS.stopButton) ||
                       document.querySelector('button[aria-label*="Stop generating"]');
  if (stopButton && !stopButton.disabled) {
    return false;
  }

  // Check for action buttons in either English or Chinese
  const copyButton = document.querySelector('button[aria-label="Copy"]') ||
                     document.querySelector('button[aria-label="拷贝"]');
  const shareButton = document.querySelector('button[data-testid="share-button"]'); // Use data-testid for reliability
  const rewriteButton = document.querySelector('button[aria-label="Rewrite"]') ||
                        document.querySelector('button[aria-label="重写"]');
  const helpfulButton = document.querySelector('button[aria-label="Helpful"]') ||
                        document.querySelector('button[aria-label="有用"]');
  const notHelpfulButton = document.querySelector('button[aria-label="Not helpful"]') ||
                           document.querySelector('button[aria-label="没有帮助"]');

  return !!(copyButton || shareButton || rewriteButton || helpfulButton || notHelpfulButton);
}

function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

// Main app class
class PerplexityApp {
  constructor() {
    this.socket = null;
    this.observer = null;
    this.stop = false;
    this.dom = null;
    this.lastText = null;
    this.currentMode = 'Search'; // Default mode
  }

  async start({ text, mode, newChat = true }) {
    this.stop = false;
    log('═══════════════════════════════════════════════════════');
    log('🚀 [DEBUG] START method called');
    log(`🚀 [DEBUG] Text length: ${text.length}`);
    log(`🚀 [DEBUG] Mode: ${mode || 'default'}`);
    log(`🚀 [DEBUG] New Chat: ${newChat}`);
    log('═══════════════════════════════════════════════════════');

    // Set the mode if specified (Search, Research, or Labs)
    if (mode) {
      log(`🔧 [DEBUG] Setting mode to: ${mode}`);
      await this.setMode(mode);
    }

    // Only click new thread button if newChat is true
    // This allows continuing the conversation when newChat is false
    if (newChat) {
      log('🔍 [DEBUG] Looking for New Thread button...');
      const newThreadButton = document.querySelector(SELECTORS.newThreadButton);
      if (newThreadButton) {
        log('✅ [DEBUG] Found New Thread button, clicking...');

        // Check how many .prose elements BEFORE clicking
        const proseBefore = document.querySelectorAll('.prose').length;
        log(`📊 [DEBUG] .prose count BEFORE new thread: ${proseBefore}`);

        newThreadButton.click();
        await sleep(1500); // Give it a bit more time to load

        // Check how many .prose elements AFTER clicking
        const proseAfter = document.querySelectorAll('.prose').length;
        log(`📊 [DEBUG] .prose count AFTER new thread: ${proseAfter}`);
      } else {
        log('⚠️ [DEBUG] Warning: New thread button not found, continuing anyway');
      }
    } else {
      log('ℹ️ [DEBUG] newChat is false, continuing existing conversation');
    }

    // Find the input field (could be main input or follow-up input)
    log('🔍 [DEBUG] Looking for input field...');
    let inputField = document.querySelector(SELECTORS.followUpInput) ||
                     document.querySelector(SELECTORS.input);

    if (!inputField) {
      log('❌ [DEBUG] Error: No input field found');
      return;
    }

    log('✅ [DEBUG] Found input field:', inputField);
    log('🔧 [DEBUG] Setting text using execCommand...');

    // Split the text in half to check for duplication issues
    const halfLength = Math.floor(text.length / 2);
    const firstHalf = text.substring(0, halfLength);
    const secondHalf = text.substring(halfLength);

    log('Original text length:', text.length);
    log('First half:', firstHalf);
    log('Second half:', secondHalf);

    // Use only the first half to avoid duplication
    const textToInsert = text;

    // Clear and focus (works for contenteditable DIVs)
    inputField.focus();
    inputField.innerHTML = '';

    // Select all and delete to ensure clean state
    // Note: execCommand is deprecated but still works and is the most reliable method for contenteditable
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    // Insert text using execCommand (works with contenteditable)
    document.execCommand('insertText', false, textToInsert);

    log('Text inserted:', inputField.textContent);

    // Trigger input event for React
    inputField.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    }));

    // Wait for text to be processed
    await sleep(500);

    // Submit the query by pressing Enter
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      bubbles: true
    });

    log('📤 [DEBUG] Submitting query via Enter keypress...');
    inputField.dispatchEvent(enterEvent);

    // If submit button exists, click it as backup
    const submitButton = document.querySelector(SELECTORS.submitButton);
    if (submitButton && !submitButton.disabled) {
      log('📤 [DEBUG] Backup: Clicking submit button');
      submitButton.click();
    } else {
      log('⚠️ [DEBUG] Submit button not found or disabled');
    }

    // Check .prose count before starting observer
    const proseBeforeObserve = document.querySelectorAll('.prose').length;
    log(`📊 [DEBUG] .prose count BEFORE starting observer: ${proseBeforeObserve}`);

    // Start observing mutations
    log('🔭 [DEBUG] Starting observer...');
    this.observeMutations();
    log('═══════════════════════════════════════════════════════');
  }

  async setMode(mode) {
    // mode can be 'Search', 'Research', or 'Labs'
    const modeSelectors = {
      'Search': SELECTORS.searchMode,
      'Research': SELECTORS.researchMode,
      'Labs': SELECTORS.labsMode
    };

    const selector = modeSelectors[mode];
    if (selector) {
      const modeButton = document.querySelector(selector);
      if (modeButton && !modeButton.checked) {
        log(`Switching to ${mode} mode`);
        modeButton.click();
        await sleep(500);
      }
    }
  }

  async observeMutations() {
    let checkAttempts = 0;
    let lastResponseLength = 0;

    log('🚀 [DEBUG] Starting MutationObserver...');

    this.observer = new MutationObserver(async () => {
      checkAttempts++;

      if (checkAttempts % 5 === 0) {
        log(`🔄 [DEBUG] Observer check #${checkAttempts}`);
      }

      // Check if response is being generated
      const isComplete = isResponseComplete();
      
      setTimeout(() => {
      const responseData = extractResponseText();

      log(`🔍 [DEBUG] Check #${checkAttempts}: textLength=${responseData?.text?.length || 0}, isComplete=${isComplete}`);

      if (!responseData || !responseData.text) {
        if (checkAttempts % 10 === 0) {
          log('⏳ [DEBUG] Waiting for response...');
        }
        return;
      }

      // Check if text has changed
      if (responseData.text.length > lastResponseLength) {
        lastResponseLength = responseData.text.length;

        // DISABLED: Partial updates to prevent duplicates
        // Uncomment below if you want streaming updates
        /*
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          log(`📤 [DEBUG] Sending partial response: ${responseData.text.length} chars`);
          this.socket.send(
            JSON.stringify({
              type: 'answer',
              text: responseData.text,
              citations: responseData.citations,
              complete: false
            })
          );
        }
        */
        log(`📝 [DEBUG] Text updated: ${responseData.text.length} chars (partial update disabled)`);
      }

      // Check if response is complete
      if (isComplete && responseData.text && responseData.text !== this.lastText) {
        this.lastText = responseData.text;

        log('🎉 [DEBUG] Response is COMPLETE!');
        log(`🎉 [DEBUG] Final text length: ${responseData.text.length}`);
        log(`🎉 [DEBUG] Citations count: ${responseData.citations.length}`);

        // Disconnect observer
        log('🛑 [DEBUG] Disconnecting observer...');
        this.observer.disconnect();

        // Send final response
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          log('📤 [DEBUG] Sending FINAL response with', responseData.citations.length, 'citations');
          this.socket.send(
            JSON.stringify({
              type: 'answer',
              text: responseData.text,
              citations: responseData.citations,
              complete: true
            })
          );

          // Send stop signal
          if (!this.stop) {
            this.stop = true;
            log('📤 [DEBUG] Sending STOP signal');
            this.socket.send(
              JSON.stringify({
                type: 'stop'
              })
            );
          }
        } else {
          log('⚠️ [DEBUG] WebSocket not open, cannot send final response');
        }
      }
      }, 500);
    });

    const observerConfig = {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'disabled']
    };

    // Observe the main content area
    const targetNode = document.querySelector('main') || document.body;
    this.observer.observe(targetNode, observerConfig);
  }

  sendHeartbeat() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      log('Sending heartbeat');
      this.socket.send(JSON.stringify({ type: 'heartbeat' }));
    }
  }

  connect() {
    this.socket = new WebSocket(WS_URL);

    this.socket.onopen = () => {
      log('Server connected, can process requests now.');
      this.updateStatus('API Connected!', 'green');
    };

    this.socket.onclose = () => {
      log('Error: The server connection has been disconnected, the request cannot be processed.');
      this.updateStatus('API Disconnected!', 'red');

      setTimeout(() => {
        log('Attempting to reconnect...');
        this.connect();
      }, 2000);
    };

    this.socket.onerror = (error) => {
      log('Error: Server connection error, please check the server.', error);
      this.updateStatus('API Error!', 'red');
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        log('📥 [DEBUG] ═══════════════════════════════════════');
        log('📥 [DEBUG] Received message from server:', data);
        log('📥 [DEBUG] ═══════════════════════════════════════');
        this.start(data);
      } catch (error) {
        log('❌ [DEBUG] Error: Failed to parse server message', error);
      }
    };
  }

  updateStatus(message, color) {
    if (this.dom) {
      this.dom.innerHTML = `<div style="color: ${color};">${message}</div>`;
    }
  }

  init() {
    // Wait for page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupUI());
    } else {
      this.setupUI();
    }
  }

  setupUI() {
    // Create status indicator
    this.dom = document.createElement('div');
    this.dom.style = 'position: fixed; top: 10px; right: 10px; z-index: 9999; ' +
                     'background: rgba(0,0,0,0.8); padding: 8px 12px; ' +
                     'border-radius: 8px; font-family: monospace; font-size: 12px;';
    document.body.appendChild(this.dom);

    // Connect to WebSocket server
    this.connect();

    // Setup heartbeat
    setInterval(() => this.sendHeartbeat(), 30000);
  }
}

// Debug utilities
window.PERPLEXITY_API_DEBUG = {
  getSelectors: () => SELECTORS,
  extractText: () => extractResponseText(),
  isComplete: () => isResponseComplete(),
  findElements: () => {
    const results = {};
    for (const [key, selector] of Object.entries(SELECTORS)) {
      const element = document.querySelector(selector);
      results[key] = !!element;
    }
    return results;
  },
  testQuery: async (text) => {
    const app = window.perplexityApp;
    if (app) {
      await app.start({ text, mode: 'Search' });
    }
  },
  // New helper to test response extraction
  getFullResponse: () => {
    const data = extractResponseText();
    console.log('Text:', data.text);
    console.log('Citations:', data.citations);
    return data;
  },
  // Debug HTML structure
  inspectProseStructure: () => {
    const allProseElements = document.querySelectorAll('.prose');
    const lastProse = allProseElements[allProseElements.length - 1];

    if (!lastProse) {
      console.log('❌ No .prose element found');
      return;
    }

    console.log('📊 Prose Structure Analysis:');
    console.log('Total .prose elements:', allProseElements.length);
    console.log('\n🔍 Last .prose element structure:');

    const children = Array.from(lastProse.children);
    console.log(`Direct children: ${children.length}`);

    children.forEach((child, index) => {
      console.log(`\n[${index}] ${child.tagName}:`);
      console.log('  - Classes:', child.className);
      console.log('  - Text preview:', child.textContent.substring(0, 100));

      // Check for nested PRE/CODE
      const hasPre = child.querySelector('pre');
      const hasCode = child.querySelector('code');
      const hasCodeLang = child.querySelector('[data-testid="code-language-indicator"]');

      if (hasPre) console.log('  ✅ Contains <pre>');
      if (hasCode) console.log('  ✅ Contains <code>');
      if (hasCodeLang) console.log('  ✅ Has language indicator:', hasCodeLang.textContent);

      if (child.tagName === 'PRE' || hasPre) {
        console.log('  📝 This is a CODE BLOCK!');
        const pre = child.tagName === 'PRE' ? child : hasPre;
        console.log('  📝 Code preview:', pre.textContent.substring(0, 200));
      }
    });

    return lastProse;
  }
};

// Initialize app
(function () {
  'use strict';
  const app = new PerplexityApp();
  app.init();
  window.perplexityApp = app; // Expose for debugging
  log('Debug utilities available at window.PERPLEXITY_API_DEBUG');
})();