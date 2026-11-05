// Only used with the disposable test browser. Playwright does not expose the
// action popup as a Page, so click its actual CDP target with real mouse input.
export async function clickActionPopup(browser, url, selector) {
  let target;
  for (let i = 0; i < 100; i++) {
    target = (await browser.send('Target.getTargets')).targetInfos.find(t => t.url === url);
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!target) throw new Error('Action popup did not open');
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let next = 1;
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const cleanup = () => { clearTimeout(timer); browser.off('Target.receivedMessageFromTarget', listener); };
    const listener = event => {
      const reply = JSON.parse(event.message);
      if (event.sessionId !== sessionId || reply.id !== id) return;
      cleanup();
      if (reply.error) reject(new Error(reply.error.message)); else resolve(reply.result);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Popup command timed out: ${method}`)); }, 10000);
    browser.on('Target.receivedMessageFromTarget', listener);
    browser.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => { cleanup(); reject(error); });
  });
  let box;
  for (let i = 0; i < 100; i++) {
    const result = await send('Runtime.evaluate', {
      expression: `(() => { const b = document.querySelector(${JSON.stringify(selector)}); return typeof b?.onclick === 'function' && b.getBoundingClientRect().toJSON(); })()`,
      returnByValue: true,
    });
    box = result.result?.value;
    if (box?.width) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!box?.width) throw new Error('Popup capture button did not become ready');
  const pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pointer });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pointer });
}
