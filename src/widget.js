// -----------------------------------------------------------------------------
// Dashboard widget (Gladys >= 5.1): one card per UPS.
//
// The content is built from a fresh NUT read: state, alarms and runtime come
// from that read, while the gauge, the tiles and the chart are bound to the
// device features so they follow the published states live. The core caches
// the content for `ttl_seconds` and the poll nudges it when the status
// changes (see index.js), so a power cut shows up without waiting.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { formatRuntime, readUpsStatus } from './devices/status.js';
import { publishUpsReadings, readUps, upsDisplayName, upsIds, upsReadings } from './devices/ups.js';

export const UPS_WIDGET = 'ups';
export const REFRESH_ACTION = 'refresh';
const WIDGET_TTL_SECONDS = 60;

function truncate(text, length) {
  const characters = [...text];
  return characters.length <= length ? text : `${characters.slice(0, length - 1).join('')}…`;
}

const refreshButton = {
  type: 'button',
  label: { en: 'Refresh', fr: 'Actualiser' },
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: REFRESH_ACTION },
};

/**
 * The content shown when the widget cannot display a UPS.
 * @param {object} message - A `{ en, fr }` explanation.
 * @returns {object} The widget content.
 */
export function buildMessageContent(message) {
  return {
    ttl_seconds: WIDGET_TTL_SECONDS,
    components: [{ type: 'text', variant: 'body', text: message }, refreshButton],
  };
}

/**
 * The content of the UPS widget, within the core budget: at most 8
 * components, 6 tiles, 1 focal component, 1 status list and 4 buttons.
 * @param {object} gladys - The SDK instance.
 * @param {object} item - The `{ server, snapshot }` pair of the UPS.
 * @returns {object} The widget content.
 */
export function buildUpsWidgetContent(gladys, item) {
  const ids = upsIds(gladys, item);
  const readings = upsReadings(item);
  const status = readUpsStatus(item.snapshot.variables);
  const components = [
    { type: 'text', variant: 'heading', text: truncate(upsDisplayName(item), 40) },
  ];

  if (readings.has('battery-charge')) {
    components.push({
      type: 'gauge',
      label: { en: 'Battery', fr: 'Batterie' },
      device_feature: ids.feature('battery-charge'),
      color: status.lowBattery ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    });
  }
  if (readings.has('battery-runtime')) {
    // Computed rather than bound: the feature holds seconds, a text such as
    // "1 h 25" reads better and the nudge on status change keeps it fresh.
    components.push({
      type: 'value',
      label: { en: 'Runtime', fr: 'Autonomie' },
      value: formatRuntime(readings.get('battery-runtime')),
      icon: 'clock',
      color: status.onBattery ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (readings.has('load')) {
    components.push({
      type: 'value',
      label: { en: 'Load', fr: 'Charge' },
      device_feature: ids.feature('load'),
      icon: 'activity',
      color: status.overload ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (readings.has('input-voltage')) {
    components.push({
      type: 'value',
      label: { en: 'Input voltage', fr: 'Tension d’entrée' },
      device_feature: ids.feature('input-voltage'),
      icon: 'zap',
    });
  }

  const chartFeatures = ['battery-charge', 'load'].filter((key) => readings.has(key));
  if (chartFeatures.length > 0) {
    components.push({
      type: 'chart',
      chart_type: 'line',
      title: { en: 'Last 24 hours', fr: 'Dernières 24 heures' },
      unit: '%',
      device_features: chartFeatures.map((key) => ids.feature(key)),
      interval: 'last-day',
    });
  }

  components.push({ type: 'status', items: statusItems(item, status, readings) });
  components.push(refreshButton);

  return { ttl_seconds: WIDGET_TTL_SECONDS, components };
}

function statusItems(item, status, readings) {
  const items = [
    {
      label: { en: 'State', fr: 'État' },
      value: status.label,
      color: status.color,
      icon: status.onBattery ? 'battery' : 'power',
    },
  ];
  if (status.replaceBattery) {
    items.push({
      label: { en: 'Battery', fr: 'Batterie' },
      value: { en: 'Replace it', fr: 'À remplacer' },
      color: WIDGET_COLORS.DANGER,
    });
  }
  if (status.overload) {
    items.push({
      label: { en: 'Load', fr: 'Charge' },
      value: { en: 'Overload', fr: 'Surcharge' },
      color: WIDGET_COLORS.DANGER,
    });
  }
  const alarm = String(item.snapshot.variables.get('ups.alarm') ?? '').trim();
  if (alarm) {
    items.push({
      label: { en: 'Alarm', fr: 'Alarme' },
      value: truncate(alarm, 40),
      color: WIDGET_COLORS.WARNING,
    });
  }
  const power = readings.has('real-power')
    ? `${readings.get('real-power')} W`
    : readings.has('apparent-power')
      ? `${readings.get('apparent-power')} VA`
      : null;
  if (power) {
    items.push({ label: { en: 'Power', fr: 'Puissance' }, value: power });
  }
  items.push({
    label: { en: 'NUT server', fr: 'Serveur NUT' },
    value: truncate(`${item.snapshot.name}@${item.server.host}`, 40),
    color: WIDGET_COLORS.NEUTRAL,
  });
  return items;
}

/**
 * Register the widget handlers on the SDK instance.
 * @param {object} gladys - The SDK instance.
 * @param {() => object} getConfig - Returns the current normalized configuration.
 * @returns {void}
 */
export function registerWidget(gladys, getConfig) {
  gladys.onWidgetGet(UPS_WIDGET, async ({ settings }) => {
    const config = getConfig();
    if (!config) {
      return buildMessageContent({
        en: 'The integration is not configured yet.',
        fr: 'L’intégration n’est pas encore configurée.',
      });
    }
    if (!settings?.ups) {
      return buildMessageContent({
        en: 'Choose a UPS in the settings of this widget.',
        fr: 'Choisissez un onduleur dans les réglages de ce widget.',
      });
    }
    try {
      return buildUpsWidgetContent(gladys, await readUps(gladys, config, settings.ups));
    } catch (error) {
      return buildMessageContent({
        en: truncate(`Cannot read the UPS: ${error.message}`, 300),
        fr: truncate(`Lecture de l’onduleur impossible : ${error.message}`, 300),
      });
    }
  });

  // The only action is a read: it never sends a command to the UPS.
  gladys.onWidgetAction(UPS_WIDGET, async (actionKey, _params, { settings }) => {
    if (actionKey !== REFRESH_ACTION) {
      throw new Error(`Unknown widget action: ${actionKey}`);
    }
    const config = getConfig();
    if (!config || !settings?.ups) {
      return { en: 'Nothing to refresh.', fr: 'Rien à actualiser.' };
    }
    const item = await readUps(gladys, config, settings.ups);
    await publishUpsReadings(gladys, config, item);
    return { en: 'UPS refreshed', fr: 'Onduleur actualisé' };
  });
}
