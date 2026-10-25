import { BUILD_INFO } from '../build-info.js';
import { createWebPlatform } from './web.js';
import { createWeChatPlatform } from './wechat.js';
export function createPlatform(options = {}) {
  const target = options.target || BUILD_INFO.target || 'web';
  return target === 'wechat' ? createWeChatPlatform(options) : createWebPlatform({ ...options, target });
}
