// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the device modules rely on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishState / publishStates   -> record calls so tests can assert them
//   - publishChangedStates / forgetPublishedStates -> the SDK 0.15
//     deduplication, reproduced in memory (calls recorded in changedStatesCalls)
//   - publishCameraImage             -> record calls so tests can assert them
//   - publishTransports              -> record calls so tests can assert them
//   - setConnectionStatus            -> record calls so tests can assert them
//   - publishSceneEvent              -> record calls so tests can assert them
//   - requestWidgetRefresh           -> record calls so tests can assert them
//   - onWidgetGet / onWidgetAction / onSceneAction -> keep the handlers so
//     tests can call them as the SDK would
// This lets us test the pure "wiring" logic (discovery payloads, dispatch)
// without a running Gladys server or a real WebSocket.
// -----------------------------------------------------------------------------

export function createFakeGladys() {
  const published = [];
  const cameraImages = [];
  const transports = [];
  const connectionStatuses = [];
  const sceneEvents = [];
  const widgetRefreshes = [];
  const handlers = {};
  // Last value Gladys accepted per feature, as the SDK remembers it.
  const publishedStates = new Map();
  const changedStatesCalls = [];

  return {
    published,
    cameraImages,
    transports,
    connectionStatuses,
    sceneEvents,
    widgetRefreshes,
    handlers,
    publishedStates,
    changedStatesCalls,

    externalIds(type, platformId) {
      const device = `${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({ featureExternalId: s.device_feature_external_id, state: s.state });
      }
    },

    // Same rules as the SDK method: an entry equal (same state, same text) to
    // the last value ACCEPTED for its feature is skipped, within the call too;
    // `heartbeat` re-sends an unchanged value that old; a value is remembered
    // only if publishStates (overridable by a test) accepted it.
    async publishChangedStates(states, { heartbeat } = {}) {
      changedStatesCalls.push({ states, heartbeat });
      const now = Date.now();
      const previous = new Map();
      const changed = states.filter(({ device_feature_external_id: id, state, text }) => {
        const last = previous.has(id) ? previous.get(id) : publishedStates.get(id);
        previous.set(id, { state, text, at: now });
        return (
          last === undefined ||
          last.state !== state ||
          last.text !== text ||
          (heartbeat !== undefined && now - last.at >= heartbeat)
        );
      });
      for (let start = 0; start < changed.length; start += 100) {
        const batch = changed.slice(start, start + 100);
        batch.forEach(({ device_feature_external_id: id, state, text }) =>
          publishedStates.set(id, { state, text, at: now }),
        );
        try {
          await this.publishStates(batch);
        } catch (err) {
          batch.forEach(({ device_feature_external_id: id }) => publishedStates.delete(id));
          throw err;
        }
      }
      return { success: true, count: changed.length };
    },

    // The SDK also calls it itself when Gladys creates, updates or deletes a
    // device; a test plays that part by calling it.
    forgetPublishedStates(externalId) {
      if (externalId === undefined) {
        publishedStates.clear();
        return;
      }
      for (const id of [...publishedStates.keys()]) {
        if (id === externalId || id.startsWith(`${externalId}:`)) {
          publishedStates.delete(id);
        }
      }
    },

    async publishCameraImage(deviceExternalId, image) {
      cameraImages.push({ deviceExternalId, image });
    },

    async publishTransports(entries) {
      transports.push(...entries);
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data) {
      sceneEvents.push({ key, data });
    },

    requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },

    onWidgetGet(key, callback) {
      handlers[`widget:${key}`] = callback;
    },

    onWidgetAction(key, callback) {
      handlers[`widgetAction:${key}`] = callback;
    },

    onSceneAction(key, callback) {
      handlers[`sceneAction:${key}`] = callback;
    },
  };
}
