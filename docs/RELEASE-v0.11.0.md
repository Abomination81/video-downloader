# Full video and website ad protection

Built by [abomination81](https://abomination81.com) · [X @Abomination81](https://x.com/Abomination81)

Ad Protection now includes the full uBlock Origin Lite 2026.1103.1743 engine in Complete mode: network rules, player scriptlets, ad-SDK replacements, popup filtering and extended cosmetic rules. The main menu controls global on/off and per-site pause. Existing site exceptions transfer; the older bundled blockers stand down automatically.

**Existing users:** after this signed update, load the new `protection-companion` subfolder once from the stable installed extension folder, then reload open pages. Settings shows its exact location. Chrome requires this step for the new component. Future signed updates activate automatically after its settings/popup close. You do not need to load the old YouTube companion on a fresh install.

**New users:** download **Video-Downloader.zip**, unzip, run the Mac or Windows installer and follow the one-time Load unpacked steps. No terminal commands needed. The main, audio, protection and screenshot components remain separate so native menu entries and permissions stay appropriate.

Playback/seek, SDK replacement, per-site/global controls, restart persistence, companion activation and update boundaries are covered by browser and helper tests. Site coverage varies; stitched or unrecognized ads can remain. The reported five-second preroll was not served in isolated live tests, so it is not claimed as a verified site fix. See [validation](https://github.com/Abomination81/video-downloader/blob/main/docs/VALIDATION.md).

The independent downloader remains MIT licensed. Ad Protection is GPL-3.0-or-later with upstream attribution and corresponding source included in the ZIP. Filtering runs locally; optional custom-list subscriptions contact your selected sources.
