# Video Downloader v0.5.0

Silent automatic updates for you and your friends. Built by [Abomination81](https://abomination81.com) · [X](https://x.com/Abomination81).

After this installation, signed stable releases update the local helper and Chrome extension in the background. Active downloads and image cleanups finish first. Settings, history, download locations and finished files are kept. Chrome activates the update while the extension UI is closed and reconnects existing pages without refreshing them.

**One final manual update:** unzip the new bundle, run the installer, reload Video Downloader at `chrome://extensions`, then refresh existing pages. Older copies do not contain the updater. Future extension/helper updates need no Terminal or reinstalling.

Settings now shows versions and update status, with **Check for updates** and a switch for automatic updates. Normal checks run at most once every six hours while Chrome is running. Failed updates keep the working version and retry later.

Signed releases, bounded downloads, hash-locked dependencies, a separately tested runtime and recovery journal protect the update path. New Chrome permissions or a newer required Chrome version need user action. Shared system tools retain their normal installation/update path. Windows installation remains unverified on Windows.
