import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';

const identity = JSON.parse(readFileSync('extension-identity.json', 'utf8')) as { key: string };

export default defineConfig({
  srcDir: 'extension',
  publicDir: 'extension/public',
  manifest: {
    name: 'Abomination81 Toolkit',
    description: 'Video, MP3, original images, screenshots, ad blocking, metadata removal and browsing tools. Built by abomination81.',
    homepage_url: 'https://abomination81.com',
    version: '0.13.2',
    incognito: 'not_allowed',
    key: identity.key,
    minimum_chrome_version: '127',
    permissions: ['contextMenus', 'nativeMessaging', 'storage', 'webRequest', 'webNavigation', 'cookies', 'downloads', 'alarms', 'scripting', 'offscreen', 'clipboardWrite', 'activeTab', 'declarativeNetRequest', 'unlimitedStorage', 'userScripts'],
    host_permissions: ['*://*/*'],
    icons: { 16: 'icon-16.png', 48: 'icon-48.png', 128: 'brand/icon-192.png' },
    action: { default_title: 'Abomination81 Toolkit', default_icon: { 16: 'icon-16.png', 48: 'icon-48.png' } },
    commands: {
      'download-video': {
        suggested_key: { default: 'Alt+Shift+V' },
        description: 'Download the video on this page',
      },
    },
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'" },
  },
});
