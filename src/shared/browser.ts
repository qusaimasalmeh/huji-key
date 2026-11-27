type BrowserGlobal = typeof chrome;

function getApi(): BrowserGlobal {
  const g = globalThis as unknown as { browser?: BrowserGlobal; chrome?: BrowserGlobal };
  if (g.browser?.storage && g.browser?.runtime) return g.browser;
  if (g.chrome) return g.chrome;
  throw new Error('WebExtension runtime API unavailable');
}

export const ext = {
  get storage() {
    return getApi().storage;
  },
  get runtime() {
    return getApi().runtime;
  },
  get alarms() {
    return getApi().alarms;
  },
  get tabs() {
    return getApi().tabs;
  }
};
