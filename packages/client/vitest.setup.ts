import '@testing-library/jest-dom/vitest';

/*
 * jsdom does not implement matchMedia. We report `prefers-reduced-motion:
 * reduce` as MATCHING so that animated values resolve synchronously in tests:
 * this both exercises the reduced-motion path required by spec section 46 and
 * keeps assertions deterministic (no rAF, no act() races).
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: /prefers-reduced-motion/.test(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
