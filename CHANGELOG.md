# Changelog

## 0.12.0 — Browsing tools, 2026-11-05

- Reject optional cookies with pinned, local Autoconsent rules; restore unsupported or failed dialogs instead of hiding unhandled consent.
- Enable supported overlay, notification and widget nuisance lists through Full Ad Protection, preserving user-selected lists and leaving cosmetic cookie lists off.
- Add surprise-window recovery notices with Open once and per-site allowance; retain explicit links and ordinary login/payment popups.
- Add hover-video seeking, per-site playback speed and native picture-in-picture without intercepting ordinary seek-bar input.
- Add local English image/screenshot OCR with packaged workers, one-use selections, cookieless cross-origin fallback, bounded decoding and recognition. No OCR uploads or new Chrome permissions.
- Add hostile-message, sender-isolation, consent, popup, video, OCR and live-site compatibility checks. Keep native download menus and existing output defaults.

## 0.11.0 — Full video and website ad protection

- Add a separately loaded Ad Protection component powered by the full uBlock Origin Lite 2026.1103.1743 engine in Complete mode: scriptlets, player ad-SDK replacements, popup filtering, extended cosmetic filters, regional lists and upstream troubleshooting tools.
- Main-menu global/site controls delegate to the full engine; existing site pauses transfer once. The old EasyList/Pluto and Still YouTube engines stand down automatically to avoid overlapping player changes.
- Include fixed component identity, narrow background-only controls, signed update activation, permission validation, GPL notices and offline source packaging.
- Load `protection-companion` once from the stable installed extension folder, then reload open pages. Existing users keep the earlier basic protection until then. Future updates remain automatic. Coverage varies by site; ads embedded in content can remain.


## 0.10.0 — website ad blocking, 2026-11-04

- Add opt-in website filtering to the main extension, with bundled EasyList data, native Chrome network rules and cosmetic selectors. Pack equivalent domain filters without dropping supported entries from this snapshot.
- Add a global switch, per-site pause and explicit page reload controls. Filtering permission is requested only from the user's Enable button; existing required permissions and the four-extension setup are unchanged.
- Add a narrow Pluto on-demand adapter for known session metadata and DASH ad periods, plus pause-ad hiding. Live, unknown and stitched HLS ads can remain. YouTube retains its separate protection engine.
- Keep filter refreshes inside signed releases, include source/attribution, and validate Chrome regex support before activation. Player failure does not disable downloads.

## 0.9.2 — local design update, 2026-11-04

- Replace the ghoul/eye artwork with an original green download mark across the tool, toolbar and companion icons.
- Retain the main downloader menu with system typography, cleaner green/black styling, a complete feature overview, companion availability and prominent @abomination81 links.
- Use short native right-click labels, including Save full-page screenshot. Chrome retains control of native menu appearance and extension identification.
- Match the audio, YouTube and screenshot screens to the same branding; include shared artwork in offline companion source builds.
- Avoid repeated activation attempts when Chrome is loaded from an old unpacked folder; explain the one-time installed-folder setup in Settings.

## 0.9.1 — local fix, 2026-11-04

- Restore Chrome's native right-click menu after reconnecting to pages whose earlier handlers cancel it, including YouTube's custom player menu.
- Apply restoration to tabs already open during initial installation as well as updates, without refreshing their pages.
- Preserve the restoration toggle, ordinary event cancellation, video seeking and scrubbing; give the menu priority before collecting media details.

## 0.9.0 — local integration, 2026-11-04

- Bundle Full Page Screenshot by Abomination81 as a separate companion, retaining Still's one-click right-click PNG/ZIP download and optional toolbar preview.
- Add installation/status in Settings, a stable companion identity, version-only local coordination, and capture-aware update deferral.
- Validate companion identity, CSP and minimal permissions during signed updates; include pinned source and offline build instructions.
- Preserve the audio and YouTube companions and the main downloader permission list.

## 0.8.0

- Bundle YouTube Protection by Abomination81 as an optional, separately installed YouTube-only companion powered by Still 0.1.2.
- Show its local status and install folder in Settings. Its own toolbar popup controls pause; downloader privileges are unchanged.
- Coordinate version activation through the signed bundle updater, preserve pause state, and reject companion identity, permission, network-policy and rule-scope changes.
- Include GPL source, build instructions and notices in installer bundles. Disable standalone Still before enabling the companion.
- Existing YouTube tabs need a reload after changes. Controlled live mid-roll verification remains pending; deterministic mid-roll fixtures are covered.

## 0.7.0 — 2026-11-04

- Replace the branded context-menu tree with direct commands. Video targets show **Download video** and **Download audio**; audio targets show **Download audio**; image targets show **Download photo**.
- Add a small audio companion extension to keep the audio command separate under Chrome's menu rules. Load its installed folder once; it shares the existing helper, settings and history, and updates with the main extension.
- Keep **Choose format** and **Copy clean link** in the toolbar popup. Clean-link copying uses the most recently right-clicked link for 15 seconds, then the current page.
- Preserve selected sources across immediate tab closure while the companion forwards a request. Validate the companion sender, source fields, and request identifiers; repeated requests reuse the same job.
- Validate the companion's identity, version and limited permissions during future signed updates.

## 0.6.0 — 2026-10-31

- Add **Choose video format…** in the right-click menu and toolbar popup. Inspect actual source resolutions, frame rates, codecs and source size estimates, with compatible MP4, original-codec MP4 and MP3 output choices.
- Add right-click **Download audio as MP3**. Prefer audio-only sources, default to up to 320 kbps, and preserve existing MP3 audio without re-encoding when possible. Optional lower bitrates apply to one download.
- Remove MP3 tags, chapters and artwork. Check frame structure, independent metadata readers, full decoding and duration; compare decoded-audio hashes when copying MP3. Retain necessary playback headers.
- Keep highest-quality compatible H.264/AAC MP4 as the one-click default, along with normal Chrome download entries, each person's download folder, tab-independent jobs and signed updates.
- Reduce local-transfer cold-start overhead and allow a slower Mac more time to start its transfer server.
- Run format inspection in a separate bounded background pool. Resume the picker after closing it, expire selections after 15 minutes, and fail explicitly if a selected format changes or disappears. Cookies and source URLs are absent from the private format cache.

## 0.5.2 — 2026-10-31

- Defer update activation while a foreground action is selecting a video, collecting session details, starting a download, saving an image or copying a link.
- Recheck foreground activity after the helper idle query, so a newly started request cannot race the extension reload.
- Retain the signed updates, Mac background agent, metadata cleanup and highest-source compatible MP4 behavior from 0.5.1.

## 0.5.1 — 2026-10-31

- Run Mac updates through a standard per-user launchd agent, on demand or every six hours. A live rollout check found that installing native Python libraries from Chrome’s process context could be rejected by macOS; agent-based preparation succeeds without changing security settings.
- Keep the silent signed update path, idle-job checks, separate runtime, recovery journal and automatic Chrome activation. The updater agent exits after its check and respects the automatic-update preference.
- Install/remove the agent with the normal per-user installer/uninstaller. Existing 0.4.x and initial 0.5.0 copies need this installer once to enable the complete update path.

## 0.5.0 — 2026-10-31

- Add silent signed updates for the helper and personal unpacked Chrome extension. Existing users need one final installer run and extension reload to enable them.
- Preserve download destinations, settings and history; wait for active jobs, prepare a separate runtime, and recover the previous installation after a failed commit.
- Activate updated content scripts on existing pages without refreshing pages or losing unsent forms. Keep old event listeners from interfering after future updates.
- Add update status, installed versions, a manual check and an automatic-update preference in Settings.
- Publish signed versioned releases automatically after main-branch checks pass. Keep download-engine dependencies hash-locked and retain the stable extension identity.

## 0.4.1 — 2026-10-31

- Fix copy/selection restoration swallowing left clicks and drags on custom video seek bars, including players with plain div controls.
- Preserve selection behavior for native media, sliders and other marked interactive controls.
- Add real Chrome regression checks for seek-bar clicking and pointer-captured scrubbing on ordinary, shadow-root and embedded players, plus native video controls, copying and text selection.

## 0.4.0 — 2026-10-30

- Compatible H.264/AAC MP4 is now the default, fixing source-codec mismatches such as YouTube AV1/Opus downloads rejected by X.
- Prefer original H.264/AAC tracks at the best available resolution/frame rate; convert incompatible tracks when needed. Compatible tracks are copied without re-encoding.
- Keep resolution, frame rate and audio/video alignment; verify conversion before removing metadata. Show conversion progress state and actual audio/video codecs.
- Add an Original source option for codec-preserving downloads, including HDR. HDR requiring tone mapping fails safely in compatible mode.
- Preserve existing browsing/image settings while upgrading old installations to the new video default.

## 0.3.0 — 2026-10-30

First public release. Built by [Abomination81](https://abomination81.com).

- Right-click video downloads with the highest available source quality, copied into MP4 without re-encoding.
- Identifying metadata removal with independent output checks; necessary playback, HDR and orientation data retained.
- Native Chrome download entries, each person's Downloads folder, and background jobs that continue after the source tab closes.
- Source detection across overlays, embedded frames, shadow roots, HLS/DASH and MediaSource players where a downloadable source exists.
- Default right-click, copying and text-selection restoration, plus a conservative **Copy clean link** command.
- **Save original image** and automatic cleanup of newly completed ordinary Chrome image downloads. Original picture quality, rotation and animation are verified.
- Black/neon-green interface, original ghoul artwork, local Anton font and creator links.
- Per-user Mac installer and supplied Windows installer, update and uninstall scripts.

Validated on macOS arm64: 60 Python tests, 20 TypeScript tests and real Chrome integration checks. Windows installation is not yet certified. DRM, recording and sources the site does not expose are outside this release's coverage. Unsupported or unverified metadata structures fail explicitly.
