# Bundled advertising filters

`easylist.txt` is a pinned snapshot from https://easylist.to/easylist/easylist.txt. Its exact SHA-256 and upstream modification date are recorded in `provenance.json`. Normal builds are offline and reject a changed snapshot.

Original list and modified/compiled filter data: **The EasyList authors (https://easylist.to/)**, [Creative Commons Attribution-ShareAlike 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/), used under the list's dual-licensing option. See https://easylist.to/pages/licence.html. The original snapshot and the compiler are included with installer bundles and published in the repository. Derived filter data remains CC BY-SA 3.0; the application's code retains its existing licenses.

Build-time parsing uses the unmodified `@ghostery/adblocker` 2.20.3 package ([MPL-2.0](https://github.com/ghostery/adblocker/blob/master/LICENSE)). That parser is a development dependency, not a browser runtime or helper dependency.

The independent compiler supports Chrome's native block/allow rules, resource and party constraints, domain exceptions, badfilter removals and standard cosmetic selectors. Unsupported modifiers and extended/scriptlet selectors are skipped rather than broadened. Equivalent domain-only filters share native rules, retaining the complete supported snapshot within Chrome's safe dynamic-rule budget. A 27,000-rule cap retains exceptions first if future snapshots exceed that budget; builds report omissions. Chrome checks regex support before activation, omitting unsupported blocks and refusing activation if an exception cannot be represented. YouTube is left to the separately installed YouTube companion. Loopback helper traffic is excluded.

Filter files are bundled data. No remote filters, telemetry or remotely downloaded executable code are used during browsing. Refreshes are delivered with signed application releases. Per-site pauses and a global off switch remain available for site breakage.

For developers, the `adblock-source/` directory in the installer includes `package-lock.json`, this snapshot, the compiler, its build script and the independent Pluto adapter. Run `npm ci --ignore-scripts` there once to install the pinned build dependencies, then `node scripts/build-adblock.mjs` to regenerate `.output/chrome-mv3/adblock/`. The regeneration step uses only local source; normal users do not need Node or these commands.
