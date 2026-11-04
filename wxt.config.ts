import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';

const identity = JSON.parse(readFileSync('extension-identity.json', 'utf8')) as { key: string };
const audio = JSON.parse(readFileSync('companion/audio/identity.json', 'utf8')) as { id: string };

export default defineConfig({
  srcDir: 'extension',
  publicDir: 'extension/public',
  manifest: {
    name: 'Video Downloader by Abomination81',
    description: 'Clean MP4, MP3 and original-image downloads, restored copying and right-click, and clean links. Built by abomination81.',
    homepage_url: 'https://abomination81.com',
    version: '0.7.0',
    externally_connectable: { ids: [audio.id] },
    key: identity.key,
    minimum_chrome_version: '127',
    permissions: ['contextMenus', 'nativeMessaging', 'storage', 'webRequest', 'webNavigation', 'cookies', 'downloads', 'alarms', 'scripting', 'offscreen', 'clipboardWrite'],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: { 16: 'icon-16.png', 48: 'icon-48.png', 128: 'brand/icon-192.png' },
    action: { default_title: 'Download video · Abomination81', default_icon: { 16: 'icon-16.png', 48: 'icon-48.png' } },
    commands: {
      'download-video': {
        suggested_key: { default: 'Alt+Shift+V' },
        description: 'Download the video on this page',
      },
    },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" },
  },
});
