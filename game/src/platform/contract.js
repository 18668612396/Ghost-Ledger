export const PLATFORM_IDS = Object.freeze(['web', 'windows', 'android', 'wechat']);
export const platformFailure = (code, message) => ({ ok: false, error: { code, message } });
export function assertPlatform(platform) {
  if (!platform || !PLATFORM_IDS.includes(platform.id)) throw new TypeError('未知运行平台。');
  for (const [service, methods] of Object.entries({ storage: ['read', 'write', 'remove'], files: ['download', 'pickText'], audio: ['tone', 'setEnabled', 'pause', 'resume'], lifecycle: ['subscribe'], clock: ['now', 'monotonic'] })) {
    for (const method of methods) if (typeof platform[service]?.[method] !== 'function') throw new TypeError(`平台缺少 ${service}.${method}。`);
  }
  return platform;
}
