# Security and privacy

Video Downloader is a local Chrome extension and native helper. The helper accepts framed, validated requests only from the stable extension identity registered by setup. It runs known media tools with argument arrays, not page-supplied shell commands. Source cookies are scoped to relevant domains and travel over a private local pipe; they are not written to job history.

Prepared files are verified before the extension asks Chrome to save them. A short-lived loopback server transfers one file using an unguessable capability. It rejects unexpected website origins and hosts. The saved file is checked again, and Chrome-added source-URL attributes are cleared without removing filesystem quarantine/ZoneId security markings.

Chrome's ordinary image downloads are cleaned after completion, so original metadata can briefly exist on disk. Automatic replacement is atomic and checks that the user has not changed the file. Unsupported structures fail explicitly and leave the original untouched. Necessary playback, color, orientation and animation data remain. Metadata cleaning does not remove visible information, watermarks or information encoded in the actual picture or audio.

The extension can read pages, relevant cookies, network headers and local download filenames to perform these commands. Install only builds you trust, protect the unpacked extension folder, and keep the helper and extraction engine updated. No developer-operated upload service, telemetry or account is required.

Automatic updates contact the public GitHub release endpoint without site cookies or media URLs. An embedded Ed25519 public key verifies the update manifest, which binds the version and SHA-256 of the complete archive. The private signing key is held in a repository Actions secret. The helper accepts no page-supplied update URL or command. Downloads and redirects are restricted to HTTPS GitHub release hosts, with time/size limits; archive traversal, symlinks and duplicate paths are rejected. Dependencies are hash-locked. A separate runtime is smoke-tested before the activation pointer changes; a recovery journal rolls back an interrupted commit. Additional Chrome permissions require a manual installation. Both the repository and its signing workflow must remain trusted.

On Mac, a per-user launchd agent performs update preparation independently of Chrome, on demand or every six hours, then exits. The installer registers only this account's agent; Uninstall removes it. It respects the automatic-update preference. This uses the normal macOS background-job mechanism and changes no Gatekeeper, quarantine or system-wide security settings.

## Reporting

Do not put cookies, credentials, signed media URLs, personal media or unredacted browser logs in public issues. Use GitHub's private vulnerability reporting if available. Otherwise contact [@Abomination81 on X](https://x.com/Abomination81) to arrange a private reporting route before sharing sensitive details.

For an ordinary compatibility issue, include the extension/helper version, operating system, public site name, and the displayed error. Share only media you are comfortable making public. Windows installation is not yet certified; tested coverage is recorded in [VALIDATION.md](docs/VALIDATION.md).
