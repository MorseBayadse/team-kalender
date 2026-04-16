// ============================================================
// PLATFORM INDEX – Zentraler Export aller Platform-Module
// Import: import { getPlatform, sendLocalNotification } from '../platform';
// ============================================================

export {
  detectPlatform,
  getPlatform,
  getPlatformInfo,
  isDesktop,
  isMobile,
  isIOS,
  isAndroid,
  isWeb,
} from './platform.js';

export {
  requestPermission,
  sendLocalNotification,
  scheduleEventReminder,
} from './notifications.js';

export {
  setItem,
  getItem,
  removeItem,
  clear,
} from './storage.js';
