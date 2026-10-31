# Video Downloader v0.5.1

Silent automatic updates for you and your friends. Built by [Abomination81](https://abomination81.com) · [X](https://x.com/Abomination81).

Signed stable releases update the helper and Chrome extension automatically. Downloads, image cleanups, preferences, destinations and finished files are kept. Chrome reconnects existing pages without refreshing them or losing forms.

Mac installs use a normal per-user launchd agent for update checks and package preparation. It runs on demand or every six hours, then exits. This keeps native Python dependency installation independent of Chrome’s process context and leaves macOS security settings unchanged. The agent is removed by Uninstall; automatic updates can be turned off in Settings. Other platforms check while Chrome is running.

**One final manual update:** unzip this bundle, run the installer, reload Video Downloader at `chrome://extensions`, then refresh existing pages. This applies to 0.4.x and the initial 0.5.0 build. Keep Developer mode enabled. Future signed helper/extension releases need no Terminal or repeated installer.

Settings shows versions, update status, a manual check and an opt-out. Active jobs finish before an update commits; interrupted commits recover the previous version. New Chrome permissions, newer required Chrome versions and shared system tools retain their normal approval/update paths. Windows installation remains unverified on Windows.
