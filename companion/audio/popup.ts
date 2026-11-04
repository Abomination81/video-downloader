const message = document.querySelector<HTMLElement>('#message')!;
void chrome.storage.local.get('lastError').then(saved => {
  if (typeof saved.lastError === 'string') message.textContent = saved.lastError;
});
document.querySelector<HTMLButtonElement>('#open')!.onclick = async () => {
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'open-downloader' });
    if (reply?.ok) window.close(); else message.textContent = reply?.message ?? 'Open Video Downloader to check setup.';
  } catch { message.textContent = 'Enable Video Downloader and load its installed extension folder.'; }
};
