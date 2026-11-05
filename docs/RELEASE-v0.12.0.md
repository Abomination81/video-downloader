# Fewer interruptions. More control.

Built by [abomination81](https://abomination81.com) · [X @Abomination81](https://x.com/Abomination81)

- **Reject optional cookies:** bundled DuckDuckGo Autoconsent rules dismiss supported dialogs after opting out. Unsupported dialogs remain usable. No automatic Accept all.
- **Quiet the nags:** Ad Protection filters supported newsletter overlays, notification prompts and widgets. Cookie hiding stays separate from actual consent rejection.
- **Catch surprise windows:** a small footer offers **Open once**, **Allow on this site**, or **Dismiss**. Ordinary links and login/payment buttons keep normal popup behavior.
- **Control the video:** hover for ±10 seconds, remembered playback speed and native **Pop out**, including players under overlays. Seeking follows the actual available timeline.
- **Copy text from images:** select an image or open a local screenshot. English OCR runs on your computer with packaged Tesseract data. Text is editable and copyable; no OCR uploads.

Highest-quality compatible MP4, clean MP3, original images and full-page screenshots remain available. No reading mode or offline-page saving was added. Right-click download commands stay flat and native.

No new Chrome permissions. Existing stable-folder installs receive this signed update automatically. Close extension settings/popups to allow activation, then refresh open pages. If Ad Protection has never been loaded, load its `protection-companion` subfolder once for nag filtering. Copies loaded from an extracted ZIP or project/dist folder must be switched to the installed folder once.

Validation covers consent refusal, popup recovery/login behavior, native seeking and picture-in-picture, local and cross-origin OCR, malformed/oversized image rejection, forged messages, unrelated extensions, updater boundaries and existing download workflows. Public-site sampling and exact limitations are recorded in [validation](https://github.com/Abomination81/video-downloader/blob/main/docs/VALIDATION.md). Site support varies; access checks and browser restrictions are not bypassed. No test can guarantee every site works or that software is exploit-free.
