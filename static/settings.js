// Singleton settings backed by server-side storage.
// Call settings.load() once after login to fetch from server.
// get() returns defaults until load() completes.
const Settings = (() => {
  const Defaults = {
    units: "imperial",
  };

  // In-memory cache, initialized with defaults.
  const cache = { ...Defaults };

  // Load settings from server into cache.
  async function load() {
    if (!isLoggedIn()) return;
    try {
      const serverSettings = await apiGetSettings();
      for (const key of Object.keys(Defaults)) {
        if (key in serverSettings) {
          cache[key] = serverSettings[key];
        }
      }
    } catch (e) {
      console.error('Failed to load settings from server:', e);
    }
  }

  function get(key) {
    if (!(key in Defaults)) {
      throw new Error(`Unknown setting ${key}`);
    }
    return cache[key];
  }

  async function set(key, value) {
    if (!(key in Defaults)) {
      throw new Error(`Unknown setting ${key}`);
    }
    cache[key] = value;
    if (isLoggedIn()) {
      try {
        await apiPutSettings({ ...cache });
      } catch (e) {
        console.error('Failed to save settings to server:', e);
      }
    }
  }

  return { load, get, set };
})();
