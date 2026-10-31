# Video Downloader v0.4.1

Fixes video seeking and scrubbing on pages such as Reddit. The copy/selection feature could mistake custom player controls for text and intercept their left-button events. Left clicks and drags now always reach the page. Right-click restoration, copying, text selection and download behavior remain enabled.

Real Chrome checks cover custom seek-bar clicks and pointer-captured drags, shadow-root and embedded players, native video controls, ordinary sliders, copy restoration and mouse text selection. The former installed version reproduces the blocked player handlers; the updated build passes.

**Update:** Download `Video-Downloader.zip`, extract it and run the installer again. Reload the extension at `chrome://extensions`, then refresh pages that were already open.

Built by [Abomination81](https://abomination81.com) · [X](https://x.com/Abomination81)
