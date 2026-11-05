// Executed in the page's MAIN world, without extension APIs or page messages.
// A site may have registered its window capture handler before a reconnected
// content script. Preventing cancellation restores Chrome's default menu even
// when stopping propagation can no longer beat that earlier handler.
export function setNativeMenuPolicy(enabled: boolean) {
  const key = Symbol.for('abomination81.native-menu-policy.v1');
  const prototype = Event.prototype as Event & { [key: symbol]: { enabled: boolean } | undefined };
  const previous = prototype[key];
  if (previous) { previous.enabled = enabled; return; }
  if (!enabled) return;
  const state = { enabled };
  const preventDefault = Object.getOwnPropertyDescriptor(Event.prototype, 'preventDefault')!;
  const returnValue = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue');
  // Keep one wrapper per document, preserving native behavior for every event
  // except contextmenu while the user's restoration setting is enabled.
  Object.defineProperty(prototype, 'preventDefault', {
    ...preventDefault,
    value: function (this: Event) {
      if (state.enabled && this.type === 'contextmenu') return;
      return Reflect.apply(preventDefault.value, this, []);
    },
  });
  if (returnValue?.set) Object.defineProperty(prototype, 'returnValue', {
    ...returnValue,
    set: function (this: Event, value: boolean) {
      if (state.enabled && this.type === 'contextmenu' && value === false) return;
      Reflect.apply(returnValue.set!, this, [value]);
    },
  });
  Object.defineProperty(prototype, key, { value: state });
}
