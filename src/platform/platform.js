// ============================================================
// PLATFORM.JS – Plattform-Erkennung & Abstraktionsschicht
// Zentrale Stelle für plattformspezifische Logik.
// Alle Plattformen (Web, Desktop, Mobile) nutzen dieses Modul.
// ============================================================

/**
 * Erkannte Plattformen:
 *  - 'web'       → Browser (PWA)
 *  - 'desktop'   → Electron (Windows, macOS, Linux)
 *  - 'ios'       → Capacitor auf iPhone/iPad
 *  - 'android'   → Capacitor auf Android
 */

let _platform = null;

export function detectPlatform() {
  if (_platform) return _platform;

  // Electron-Erkennung
  if (typeof window !== 'undefined' && window.electronAPI) {
    _platform = 'desktop';
  }
  // Capacitor-Erkennung
  else if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform()) {
    const info = window.Capacitor.getPlatform();
    _platform = info === 'ios' ? 'ios' : 'android';
  }
  // Fallback: Web/Browser
  else {
    _platform = 'web';
  }

  console.log(`[Platform] Erkannt: ${_platform}`);
  return _platform;
}

export function getPlatform() {
  return _platform ?? detectPlatform();
}

export function isDesktop()  { return getPlatform() === 'desktop'; }
export function isMobile()   { return getPlatform() === 'ios' || getPlatform() === 'android'; }
export function isIOS()      { return getPlatform() === 'ios'; }
export function isAndroid()  { return getPlatform() === 'android'; }
export function isWeb()      { return getPlatform() === 'web'; }

/**
 * Plattform-Info-Objekt (nützlich für Debugging & Analytics)
 */
export function getPlatformInfo() {
  return {
    platform:    getPlatform(),
    isDesktop:   isDesktop(),
    isMobile:    isMobile(),
    isWeb:       isWeb(),
    userAgent:   navigator.userAgent,
    standalone:  window.matchMedia?.('(display-mode: standalone)')?.matches ?? false,
    online:      navigator.onLine,
  };
}
