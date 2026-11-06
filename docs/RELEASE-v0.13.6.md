# Abomination81 Toolkit v0.13.6

Updates should arrive quietly and tell you clearly when they are ready.

- Fix an update check counting itself as an active download and delaying activation.
- Check locally every minute for releases already installed by the helper, instead of waiting up to an hour. Remote release checks still run every six hours.
- Show **Running in Chrome** and **Installed** versions separately in Settings, with the reason an update is waiting.
- Add **Close Settings to apply update**. Closing a Toolkit tab now retries activation immediately; real downloads, screenshots and previews stay protected.

Includes the new hover-only video controls from v0.13.5. The slim controls sit along the bottom of videos missing their own controls and disappear immediately when you leave the video.

For existing unified installations, use **Toolkit → Settings → Check for updates**, then close Toolkit tabs. Chrome’s Extensions-page **Update** button does not run the signed helper updater. Keep the installed extension folder; no reinstall is needed. If Chrome still holds the old version, use the reload icon on the Toolkit’s extension card once.

Built by [abomination81](https://abomination81.com) · [@abomination81 on X](https://x.com/Abomination81)
