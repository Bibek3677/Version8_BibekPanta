// API client. Every call sends the API key in the x-api-key header; the key
// is kept in this browser's localStorage after it has been entered once.
import { $ } from './dom.js';

let apiKey = '';
try { apiKey = localStorage.getItem('apiKey') || ''; } catch { /* storage blocked */ }
let keyPrompt = null;

export const getApiKey = () => apiKey;

export function forgetApiKey() {
  try { localStorage.removeItem('apiKey'); } catch { /* ignore */ }
  apiKey = '';
}

// Shows the key dialog. Several requests can fail with 401 at once, so they
// all share one prompt instead of opening the dialog several times.
function askForKey(message) {
  if (keyPrompt) return keyPrompt;
  const dialog = $('key-dialog');
  $('key-error').textContent = message || '';
  $('key-error').hidden = !message;
  $('key-input').value = '';
  dialog.showModal();
  keyPrompt = new Promise((resolve) => {
    $('key-form').onsubmit = (event) => {
      event.preventDefault();
      apiKey = $('key-input').value.trim();
      try { localStorage.setItem('apiKey', apiKey); } catch { /* ignore */ }
      dialog.close();
      keyPrompt = null;
      resolve();
    };
  });
  return keyPrompt;
}

// keepalive lets a request finish after the page is closed (used by the
// undoable delete when you leave during the undo window).
export async function api(path, options = {}, retried = false) {
  const { method = 'GET', body, keepalive = false } = options;
  if (!apiKey) await askForKey();
  let res;
  try {
    const headers = { 'x-api-key': apiKey };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive,
    });
  } catch {
    throw new Error('Cannot reach the server. Is it still running in your terminal?');
  }
  if (res.status === 401 && !retried) {
    await askForKey('That API key was not accepted. Check the API_KEY value in your .env file.');
    return api(path, options, true); // v8 dropped keepalive here; pass every option through
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
  return data;
}
