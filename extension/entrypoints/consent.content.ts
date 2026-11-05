import AutoConsent, { type RuleBundle } from '@duckduckgo/autoconsent';
import rules from '@duckduckgo/autoconsent/rules/rules.json';
import { browsingPolicySchema } from '../lib/browsing-policy';
import { request } from '../lib/ui';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], allFrames: true, matchOriginAsFallback: true,
  runAt: 'document_idle',
  main(ctx) {
    let engine: AutoConsent | undefined;
    let active = false;
    function stop() {
      active = false;
      if (engine) { engine.config.autoAction = null; engine.config.enablePrehide = false; engine.undoPrehide(); }
      document.querySelector('style#autoconsent-css-rules')?.remove();
    }
    function start() {
      if (active) return;
      active = true;
      const instance = new AutoConsent(async message => {
        if (message.type !== 'eval') return; // No telemetry, URLs, reports or cookies leave this frame.
        let result: unknown = false;
        if (active && engine === instance && message.snippetId) try { result = await request({ type: 'browsing-consent-eval', snippetId: message.snippetId }); } catch { /* Leave an unsupported banner usable. */ }
        await instance.receiveMessageCallback({ type: 'evalResp', id: message.id, result });
      });
      engine = instance;
      // Initialize after construction: pre-hiding requires DomActions to exist.
      const configuration = {
        enabled: true, autoAction: 'optOut', enableCosmeticRules: false,
        enableGeneratedRules: true, enablePrehide: true, prehideTimeout: 2500,
        heuristicMode: 'reject', enableHeuristicDetection: false, enableHeuristicHitTest: true,
        enablePopupMutationObserver: true, detectRetries: 10,
        logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: false, messages: false, waits: false },
      } as const;
      // Do not let work from a paused/replaced instance click later.
      const clickElement = instance.domActions.clickElement.bind(instance.domActions);
      instance.domActions.click = async (selector, all = false) => {
        const elements = instance.domActions.elementSelector(selector);
        if (!elements.length) return false;
        for (const element of all ? elements : elements.slice(0, 1)) {
          if (!active || engine !== instance) return false;
          await clickElement(element);
          if (all) await new Promise(resolve => setTimeout(resolve, 0));
        }
        return true;
      };
      instance.domActions.clickElement = (...args) => active && engine === instance ? clickElement(...args) : Promise.resolve(false);
      // Some upstream opt-out rules end with a cosmetic-only hide fallback.
      // Refuse that fallback: a hidden banner is not evidence of rejection.
      instance.domActions.hide = () => false;
      const optOut = instance.doOptOut.bind(instance);
      instance.doOptOut = async () => {
        try { return active && engine === instance ? await optOut() : false; }
        finally { document.querySelector('style#autoconsent-css-rules')?.remove(); }
      };
      const hide = instance.prehideElements.bind(instance);
      instance.prehideElements = () => active && engine === instance ? hide() : false;
      instance.doOptIn = () => Promise.resolve(false);
      instance.initialize(configuration, rules as RuleBundle);
    }
    function update(raw: unknown) {
      const value = browsingPolicySchema.safeParse(raw);
      if (!value.success) return;
      if (value.data.enabled && value.data.rejectCookies) start(); else stop();
    }
    void request({ type: 'browsing-policy' }).then(update).catch(() => {});
    const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message, sender) => {
      if (sender.id === chrome.runtime.id && !sender.tab && message?.type === 'browsing-policy') update(message.value);
    };
    chrome.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => { stop(); chrome.runtime.onMessage.removeListener(listener); });
  },
});
