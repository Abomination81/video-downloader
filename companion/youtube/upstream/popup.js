'use strict';
const button = document.getElementById('toggle');
const status = document.getElementById('status');
let enabled = true;
function render(result) {
  if (!result?.ok) throw new Error('Unavailable');
  enabled = result.enabled;
  status.textContent = enabled ? 'Protection enabled' : 'Protection paused';
  button.textContent = enabled ? 'Pause protection' : 'Enable protection';
  button.disabled = false;
}
function failed() {
  status.textContent = 'Could not update protection';
  document.getElementById('notice').textContent = 'Close and reopen this popup to retry. You can also disable Still in your browser’s extensions settings.';
  button.disabled = true;
}
button.addEventListener('click', async () => {
  button.disabled = true;
  try { render(await chrome.runtime.sendMessage({type: 'set-enabled', enabled: !enabled})); }
  catch { failed(); }
});
chrome.runtime.sendMessage({type: 'status'}).then(render).catch(failed);
