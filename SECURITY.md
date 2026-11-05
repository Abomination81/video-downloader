# Security and privacy

## Browsing tools and image text

Cookie rejection runs bundled Autoconsent 18.0.0 rules, with opt-in and cosmetic-only cookie hiding disabled. Only named, compiled snippet functions may run in the originating frame; page-supplied code is never evaluated. Requests have per-document budgets and time bounds. Reporting is disabled. Failed/unknown consent flows leave the dialog usable.

Popup notices accept bounded HTTP(S) destinations without embedded credentials. Their actions require trusted browser input; page messages and synthetic clicks cannot launch a tab or save an exception. Explicit links and ordinary buttons retain normal WindowProxy behavior. A hostile page can imitate page UI or replace its own window.open; this supplemental heuristic is not an isolation boundary or a guarantee against all popunders. The full ad engine and Chrome retain their separate protections.

OCR accepts only extension-page requests tied to a recent selected image and exact source document. Selection tokens are one-use, expire after five minutes, and retain at most four temporary URL references in session memory. Existing pixels are preferred; cross-origin fetches omit cookies and referrers, have a 15-second deadline and a 12 MB streaming cap. File signatures and dimensions are checked before decoding; images over 40 megapixels or 32,768 pixels on a side are rejected. Recognition is reduced to six megapixels and bounded to 60 seconds. Local worker, WebAssembly and English language data are packaged with the release. No recognized text or pixels enter extension storage or an OCR service. Closing the page releases its worker and image URL.

The extension CSP permits packaged WebAssembly, not JavaScript string evaluation. Downloader UI, screenshot previews and OCR assets are not web-accessible. Only the ad engine’s explicit SDK replacements and guarded filtering UI are exposed. Strict sender and schema checks prevent content scripts and other extensions from invoking privileged helper/UI/OCR commands. The nuisance-list API runs inside the single background worker and accepts only fixed list choices, preserving user-selected lists.

These checks cover the documented threat model, not arbitrary software running with your OS account, a compromised browser or a compromised signed publisher. The unpacked installation and native helper run as your user; protecting that account and the release signing key remains necessary. Validation is extensive but cannot prove that no exploit or site incompatibility exists.

## Downloader and updates

Video Downloader is a local Chrome extension and native helper. The helper accepts framed, validated requests only from the stable extension identity registered by setup. It runs known media tools with argument arrays, not page-supplied shell commands. Source cookies are scoped to relevant domains and travel over a private local pipe; they are not written to job history.

Prepared files are verified before the extension asks Chrome to save them. A short-lived loopback server transfers one file using an unguessable capability. It rejects unexpected website origins and hosts. The saved file is checked again, and Chrome-added source-URL attributes are cleared without removing filesystem quarantine/ZoneId security markings.

Chrome's ordinary image downloads are cleaned after completion, so original metadata can briefly exist on disk. Automatic replacement is atomic and checks that the user has not changed the file. Unsupported structures fail explicitly and leave the original untouched. Necessary playback, color, orientation and animation data remain. Metadata cleaning does not remove visible information, watermarks or information encoded in the actual picture or audio.

The extension can read pages, relevant cookies, network headers and local download filenames to perform these commands. Install only builds you trust, protect the unpacked extension folder, and keep the helper and extraction engine updated. No developer-operated upload service, telemetry or account is required.

Automatic updates contact the public GitHub release endpoint without site cookies or media URLs. An embedded Ed25519 public key verifies the update manifest, which binds the version and SHA-256 of the complete archive. The private signing key is held in a repository Actions secret. The helper accepts no page-supplied update URL or command. Downloads and redirects are restricted to HTTPS GitHub release hosts, with time/size limits; archive traversal, symlinks and duplicate paths are rejected. Dependencies are hash-locked. A separate runtime is smoke-tested before the activation pointer changes; a recovery journal rolls back an interrupted commit. Additional Chrome permissions require a manual installation. Both the repository and its signing workflow must remain trusted.

On Mac, a per-user launchd agent performs update preparation independently of Chrome, on demand or every six hours, then exits. The installer registers only this account's agent; Uninstall removes it. It respects the automatic-update preference. This uses the normal macOS background-job mechanism and changes no Gatekeeper, quarantine or system-wide security settings.

## Reporting

Do not put cookies, credentials, signed media URLs, personal media or unredacted browser logs in public issues. Use GitHub's private vulnerability reporting if available. Otherwise contact [@Abomination81 on X](https://x.com/Abomination81) to arrange a private reporting route before sharing sensitive details.

For an ordinary compatibility issue, include the extension/helper version, operating system, public site name, and the displayed error. Share only media you are comfortable making public. Windows installation is not yet certified; tested coverage is recorded in [VALIDATION.md](docs/VALIDATION.md).

## Unified extension boundary

Version 0.13 integrates uBlock Origin Lite, Still screenshots, downloads and browsing tools under one stable Chrome identity. There are no companion manifests or external control listeners. All extension pages share Chrome's extension-level permissions; separate permission isolation is no longer claimed. The main helper/UI message router accepts only exact popup/options URLs. OCR restricts callers to its own tool and the main UI. The ad engine owns its `what` message namespace; other tool messages cannot race its responses. Compiler messages require the exact offscreen document sender.

The downloader owns all menus and the toolbar. Old basic-filter rules are retired once, before the full engine starts. Cookie-hiding lists stay off by default so hiding a banner is never represented as consent rejection. Advanced user-selected filter lists may contact their chosen sources.

Screenshots retain exact source document, focus and URL checks, bounded allocations, restoration leases and authenticated preview ports. Navigation cancels capture. Previews add a restrictive CSP that blocks outbound connections; pixels stay in extension memory until the user saves. Captures and open previews defer automatic reload. Screenshot and clipboard/filter compilation tasks share a worker-only offscreen lease, so one cannot close another's document.

The signed updater pins the unified manifest permissions, host scope, worker entry, private-page resource boundary and absence of child manifests. It still rejects any permission expansion relative to the installed manifest. Moving from the older multi-extension bundle requires one manual installer run and one Load unpacked step. The installer does not edit Chrome profiles or enable extensions automatically.
