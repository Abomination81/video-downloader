# Third-party notices

Still is distributed under GPL-3.0-or-later, with complete readable source.

## uBlock Origin

Copyright (C) 2019-present Raymond Hill. GPL-3.0-or-later.
Repository: https://github.com/gorhill/uBlock
Inspected commit: ead588aa5c2847f20f3ada234709251cb2403896
Files: src/js/resources/object-prune.js and src/js/resources/json-prune.js.
Still main.js adapts their own-property pruning / native-call wrapper approach.
Changes: fixed YouTube fields, no rule language, no stack matching, logging,
configuration, recursion, generic scripting, response cloning, or remote data.
Adds strict endpoint checks, descriptor-only reads, bounded envelopes and
original Response identity preservation. Full GPL license is included.

## uAssets

https://github.com/uBlockOrigin/uAssets
Inspected commit: 73c48dab3b0a9d9d2de459c7331f670eb00830de
GPL-3.0. YouTube entries in filters/filters.txt informed the three ad field names
and the explicit Shorts ad marker. No full filter list is bundled.

## YoutubeAdblock

https://github.com/SysAdminDoc/YoutubeAdblock
Inspected commit: 9e53f042c24f2687e5ee1dd122f181feae843cd2
The seven packaged network rules adapt a small subset of extension/rules/network-blocks.json.
Changes: initiator restrictions on every rule, narrower supported hosts,
no googlevideo media-tier blocking, no general telemetry rules, no remote lists.
SABR-only stream limitations and bounded playback fallback informed the design.

MIT License

Copyright (c) 2025 Matthew Parker

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
