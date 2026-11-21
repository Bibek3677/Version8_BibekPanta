// Small DOM helpers shared by every module.

export const $ = (id) => document.getElementById(id);

// Creates an element. Text is always set with textContent, never innerHTML,
// so task titles typed by the user can't inject markup.
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function showError(node, message) {
  node.textContent = message;
  node.hidden = !message;
}

// Messages use the stacked V8Toast notifications (public/v8/toast.js).
export function toast(message, isError = false) {
  V8Toast.show(message, isError ? { tone: 'error', duration: 8000 } : { duration: 4000 });
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
