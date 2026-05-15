// content.js — injected into every page
// Lightweight bridge: lets the popup grab the current selection

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_SELECTION') {
    const text = window.getSelection()?.toString()?.trim() || '';
    sendResponse({ text });
  }
});
