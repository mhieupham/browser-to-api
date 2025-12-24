// ==UserScript==
// @name         New Userscript
// @namespace    http://tampermonkey.net/
// @version      2025-12-23
// @description  try to take over the world!
// @author       You
// @match        https://chat.z.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=z.ai
// @grant        none
// ==/UserScript==

const log = (...args) => {
  console.log('perplexity-api-by-browser-script', ...args);
}
log('starting');

const WS_URL = `ws://localhost:8765`;

// Selector configurations for Perplexity
const SELECTORS = {
  input: 'textarea[id="chat-input"]',//
  followUpInput: 'textarea[placeholder*="follow"]',
  submitButton: '#send-message-button',//
  stopButton: 'div[aria-label="Stop"] button',
  responseContainer: '.chat-assistant', // Will use querySelectorAll and get the last element
  newThreadButton: 'button[id="sidebar-new-chat-button"]', // Updated selector
  searchMode: 'radio[aria-label="Search"]',
  researchMode: 'radio[aria-label="Research"]',
  labsMode: 'radio[aria-label="Labs"]',
  thinkingBlock: '.thinking-block' // Thinking block container
};

function cleanText(inputText) {
  // Remove invisible characters but KEEP newlines (\n = 0x0A), carriage returns (\r = 0x0D), and tabs (\t = 0x09)
  const invisibleCharsRegex =
    /[\u200B\u200C\u200D\uFEFF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  const cleanedText = inputText.replace(invisibleCharsRegex, '');
  return cleanedText;
}

// Helper function to extract code from cm-editor blocks (used in both thinking and main content)
function extractCodeFromCmEditor(cmEditor) {
  log('📝 [DEBUG] Extracting from .cm-editor block...');

  // Find the language from the label above the editor
  let language = '';
  const parentDiv = cmEditor.closest('.relative.my-2');
  if (parentDiv) {
    const langLabel = parentDiv.querySelector('.text-xs.font-medium');
    if (langLabel) {
      language = langLabel.textContent.trim();
      log(`📝 [DEBUG] Language label: ${language}`);
    }
  }

  // Extract text from .cm-line elements
  const cmLines = cmEditor.querySelectorAll('.cm-line');
  if (cmLines.length === 0) {
    log('❌ [DEBUG] No .cm-line elements found');
    return null;
  }

  const code = Array.from(cmLines).map(line => line.textContent).join('\n').trim();

  // Check if it's a tool call
  const isToolCall = code.includes('TOOL_NAME:') &&
                     code.includes('BEGIN_ARG:') &&
                     code.includes('END_ARG');

  if (isToolCall) {
    language = 'tool';
    log('📝 [DEBUG] Detected tool call format');
  }

  log(`✅ [DEBUG] Extracted code: ${code.length} chars, language: ${language}`);

  return {
    language: language || 'plaintext',
    code: code
  };
}

// Helper function to extract thinking block content
function extractThinkingBlock(proseElement) {
  log('🧠 [DEBUG] Looking for thinking block...');

  // Find thinking block within the prose element
  const thinkingBlock = proseElement.querySelector(SELECTORS.thinkingBlock);

  if (!thinkingBlock) {
    log('❌ [DEBUG] No thinking block found');
    return null;
  }

  log('✅ [DEBUG] Found thinking block');

  // Find the blockquote containing the thinking content
  const blockquote = thinkingBlock.querySelector('blockquote');

  if (!blockquote) {
    log('❌ [DEBUG] No blockquote found in thinking block');
    return null;
  }

  let thinkingText = '';

  // Process all children of blockquote (paragraphs, code blocks, lists, etc.)
  function processThinkingElement(element) {
    const children = Array.from(element.children);

    for (const child of children) {
      // Check for cm-editor blocks (code blocks in thinking)
      const cmEditor = child.querySelector('.cm-editor');
      if (cmEditor) {
        log('📝 [DEBUG] Found code block in thinking');
        const codeBlock = extractCodeFromCmEditor(cmEditor);
        if (codeBlock && codeBlock.code.length > 0) {
          thinkingText += `\n\`\`\`${codeBlock.language}\n${codeBlock.code}\n\`\`\`\n\n`;
          log(`✅ [DEBUG] Added code block to thinking (${codeBlock.language}): ${codeBlock.code.length} chars`);
        }
        continue;
      }

      // Process paragraphs
      if (child.tagName === 'P') {
        const text = child.textContent.trim();
        if (text) {
          thinkingText += `${text}\n\n`;
          log(`📝 [DEBUG] Added paragraph to thinking: ${text.substring(0, 50)}`);
        }
        continue;
      }

      // Process lists (ol/ul)
      if (child.tagName === 'OL' || child.tagName === 'UL') {
        const isOrdered = child.tagName === 'OL';
        const listItems = child.querySelectorAll('li');
        listItems.forEach((li, index) => {
          const text = li.textContent.trim();
          if (text) {
            const prefix = isOrdered ? `${index + 1}. ` : '- ';
            thinkingText += `${prefix}${text}\n`;
          }
        });
        thinkingText += '\n';
        log(`📝 [DEBUG] Added ${isOrdered ? 'ordered' : 'unordered'} list with ${listItems.length} items to thinking`);
        continue;
      }

      // If element has children, process recursively
      if (child.children.length > 0) {
        processThinkingElement(child);
      }
    }
  }

  processThinkingElement(blockquote);

  log(`✅ [DEBUG] Extracted thinking text: ${thinkingText.length} chars`);
  log(`✅ [DEBUG] Thinking preview: "${thinkingText.substring(0, 200)}..."`);

  // Return both text and the container element so we can mark it as processed
  // Use the thinkingBlock itself to avoid marking main content as processed
  return {
    text: thinkingText.trim(),
    container: thinkingBlock
  };
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
    const isToolCall = code.includes('TOOL_NAME:') && code.includes('BEGIN_ARG:') && code.includes('END_ARG');
    if (isToolCall) {
      language = 'tool';
      log('📝 [DEBUG] Detected continue.dev tool call format, setting language to "tool"');
    } else {
      // If not a tool call and has no language, it's likely tool output - skip it
      if (!language || language.trim() === '') {
        log('📝 [DEBUG] No language and not a tool call - likely tool output, skipping');
        return null;
      }
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
  function processElements(container, depth = 0) {
    // Get all direct children
    const children = Array.from(container.children);
    const indent = '  '.repeat(depth);
    log(`${indent}🔍 [DEBUG] Processing ${children.length} direct children at depth ${depth}`);

    for (let element of children) {
      // Skip if already processed
      if (processedElements.has(element)) {
        const skipClassName = typeof element.className === 'string'
          ? element.className.substring(0, 30)
          : '';
        log(`${indent}⏭️ [DEBUG] Skipping already processed ${element.tagName}.${skipClassName}`);
        continue;
      }

      const className = typeof element.className === 'string'
        ? element.className.substring(0, 50)
        : (element.className.baseVal || '').substring(0, 50);
      log(`${indent}📝 [DEBUG] Processing ${element.tagName}.${className}`);
      processedElements.add(element);

      // Check for CM-EDITOR blocks (z.ai's tool calls and code blocks) FIRST
      // IMPORTANT: Only check for DIRECT cm-editor children, not nested ones
      // Using querySelector would find nested cm-editors in thinking blocks
      const directCmEditor = Array.from(element.children).find(child => {
        return child.classList.contains('cm-editor') ||
               child.querySelector(':scope > .cm-editor');
      });

      if (directCmEditor) {
        const cmEditor = directCmEditor.classList.contains('cm-editor')
          ? directCmEditor
          : directCmEditor.querySelector(':scope > .cm-editor');

        if (cmEditor && !processedElements.has(cmEditor)) {
          log(`${indent}📝 [DEBUG] Found DIRECT .cm-editor block!`);

          const codeBlock = extractCodeFromCmEditor(cmEditor);
          if (codeBlock && codeBlock.code.length > 0) {
            // Add all cm-editor content (both tool calls and regular code)
            fullText += `\n\`\`\`${codeBlock.language}\n${codeBlock.code}\n\`\`\`\n\n`;
            log(`${indent}✅ [DEBUG] Added cm-editor block (${codeBlock.language}): ${codeBlock.code.length} chars`);
          }

          // Mark all children as processed to avoid duplicates
          markDescendantsAsProcessed(element);
          continue;
        }
      }

      // Check for code blocks (PRE tags)
      const preElement = element.tagName === 'PRE' ? element : element.querySelector('pre');
      if (preElement) {
        log('📝 [DEBUG] Found code block!');
        const codeBlock = extractCodeFromPre(preElement);
        if (codeBlock && codeBlock.code.length > 0) {
          fullText += `\n\`\`\`${codeBlock.language}\n${codeBlock.code}\n\`\`\`\n\n`;
          log(`✅ [DEBUG] Added code block (${codeBlock.language}): ${codeBlock.code.length} chars`);
        } else if (codeBlock === null) {
          log('⏭️ [DEBUG] Code block skipped (likely tool output)');
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
        log(`${indent}🔍 [DEBUG] Processing nested children in ${element.tagName}`);
        processElements(element, depth + 1);
      }
    }
  }

  // Extract thinking block if present (do this BEFORE processing main content)
  const thinkingData = extractThinkingBlock(proseElement);

  // Mark thinking block container as processed to avoid duplication
  if (thinkingData) {
    log('🚫 [DEBUG] Marking thinking block container as processed');
    processedElements.add(thinkingData.container);
    // Mark all descendants as processed
    const allDescendants = thinkingData.container.querySelectorAll('*');
    allDescendants.forEach(desc => processedElements.add(desc));

    // Also mark the wrapper div (parent of thinking block) if it has overflow-hidden class
    const wrapperDiv = thinkingData.container.parentElement;
    if (wrapperDiv && wrapperDiv.classList.contains('overflow-hidden')) {
      log('🚫 [DEBUG] Marking thinking wrapper div as processed');
      processedElements.add(wrapperDiv);
    }

    // Also mark the thinking-chain-container (the button header)
    const thinkingChainContainer = proseElement.querySelector('.thinking-chain-container');
    if (thinkingChainContainer) {
      log('🚫 [DEBUG] Marking thinking-chain-container as processed');
      processedElements.add(thinkingChainContainer);
      const chainDescendants = thinkingChainContainer.querySelectorAll('*');
      chainDescendants.forEach(desc => processedElements.add(desc));
    }
  }

  // Mark tool OUTPUT blocks as processed (but NOT tool calls with TOOL_NAME)
  // Tool outputs should not be extracted - they are part of AI's internal process
  // But tool calls (with TOOL_NAME pattern) SHOULD be extracted
  log('🚫 [DEBUG] Checking .cm-editor blocks - skip outputs, keep tool calls and code');

  const cmEditorBlocks = proseElement.querySelectorAll('.cm-editor');
  cmEditorBlocks.forEach(editor => {
    // Skip if already processed (e.g., in thinking block)
    if (processedElements.has(editor)) {
      log(`⏭️ [DEBUG] cm-editor already processed, skipping`);
      return;
    }

    const codeBlock = extractCodeFromCmEditor(editor);

    if (!codeBlock || codeBlock.code.length === 0) {
      // Empty or invalid - skip it
      log(`🚫 [DEBUG] Empty cm-editor block - skipping`);
      // Only mark the editor itself and its descendants, NOT the container
      // because the container might contain other valid code blocks
      processedElements.add(editor);
      const allDescendants = editor.querySelectorAll('*');
      allDescendants.forEach(desc => processedElements.add(desc));
    } else if (codeBlock.language === 'tool') {
      // This is a tool call - let it be extracted
      log(`✅ [DEBUG] Found tool call in .cm-editor - will extract it`);
    } else if (codeBlock.language && codeBlock.language !== 'plaintext') {
      // This is code with a language - let it be extracted
      log(`✅ [DEBUG] Found code block (${codeBlock.language}) in .cm-editor - will extract it (${codeBlock.code.length} chars)`);
    } else {
      // This is likely tool output (no language, not a tool call) - skip it
      log(`🚫 [DEBUG] Found tool output in .cm-editor - skipping`);
      // Only mark the editor itself and its descendants, NOT the container
      processedElements.add(editor);
      const allDescendants = editor.querySelectorAll('*');
      allDescendants.forEach(desc => processedElements.add(desc));
    }
  });

  // Start processing main content
  processElements(proseElement);

  let finalText = '';

  // If thinking block exists, add it at the beginning with proper formatting
  // Only include thinking text, NOT tool calls
  if (thinkingData && thinkingData.text) {
    log('🧠 [DEBUG] Adding thinking block to response (text only, no tool calls)');
    finalText += '<thinking>\n';
    finalText += thinkingData.text + '\n';
    finalText += '</thinking>\n\n';
  }

  // Add the main response content
  finalText += fullText;

  // Format citations at the end
  if (citations.length > 0) {
    log(`🔍 [DEBUG] Found ${citations.length} citation(s)`);
    finalText += '\n**References:**\n';
    citations.forEach((citation, index) => {
      finalText += `[${index + 1}] ${citation.label || citation.url}\n`;
    });
  } else {
    log('🔍 [DEBUG] No citations found');
  }

  const result = {
    text: cleanText(finalText.trim()),
    citations: citations
  };

  log(`✅ [DEBUG] Extracted text length: ${result.text.length} chars`);
  log(`✅ [DEBUG] First 800 chars: "${result.text.substring(0, 800)}..."`);

  return result;
}

// Check if response is complete
function isResponseComplete() {
  // Check if stop button exists (means still generating)
  const stopButton = document.querySelector(SELECTORS.stopButton) ||
                       document.querySelector('button[aria-label*="Stop generating"]');

  // If stop button doesn't exist, response is complete
  if (!stopButton) {
    return true;
  }

  // If stop button exists, check for action buttons that appear when complete
  const copyButton = document.querySelector('button[aria-label*="Copy"]');
  const shareButton = document.querySelector('button[aria-label*="Share"]');
  const rewriteButton = document.querySelector('button[aria-label*="Rewrite"]');
  const helpfulButton = document.querySelector('button[aria-label*="Helpful"]');
  const notHelpfulButton = document.querySelector('button[aria-label*="Not helpful"]');

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
    // Inject CSS for cm-content zoom
    const style = document.createElement('style');
    style.textContent = `
      .cm-content {
        zoom: 0.001 !important;
      }
    `;
    document.head.appendChild(style);
    log('✅ [DEBUG] Injected CSS: .cm-content { zoom: 0.001 }');

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
  // Test thinking block extraction
  getThinkingBlock: () => {
    const allProseElements = document.querySelectorAll('.chat-assistant');
    const proseElement = allProseElements[allProseElements.length - 1];

    if (!proseElement) {
      console.log('❌ No prose element found');
      return null;
    }

    const thinkingData = extractThinkingBlock(proseElement);
    if (thinkingData) {
      console.log('Thinking text:', thinkingData.text);
      console.log('Thinking container:', thinkingData.container);
      return thinkingData.text;
    }
    return null;
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