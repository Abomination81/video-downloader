import {protectionStatus,protectionSnapshot,setProtectionEnabled,setProtectionSite,migrateProtection} from './protection-companion';
import {adPreferencesSchema} from './adblock-policy';
export class AdBlocking {
  private ready = this.initialize();
  private async initialize() {
    const saved = await chrome.storage.local.get('adBlockPreferences');
    const prefs = adPreferencesSchema.parse(saved.adBlockPreferences ?? {});
    await migrateProtection(prefs.pausedSites);
  }
  constructor() { void this.ready.catch(() => undefined); }
  async status(host?: string) {
    await this.ready;
    const value = await protectionStatus(host);
    if (!value) throw new Error('Ad protection could not start');
    return protectionSnapshot(value);
  }
  async setEnabled(enabled: boolean) { await this.ready; return protectionSnapshot(await setProtectionEnabled(enabled)); }
  async setSite(host: string, paused: boolean) { await this.ready; return protectionSnapshot(await setProtectionSite(host, paused)); }
  async frame(sender: chrome.runtime.MessageSender) {
    // Remove CSS from the retired basic engine on pages kept open during update.
    if (sender.tab?.id !== undefined) await chrome.tabs.sendMessage(sender.tab.id, {type:'ad-policy',css:''}, sender.documentId ? {documentId:sender.documentId} : {frameId:sender.frameId ?? 0});
  }
}
