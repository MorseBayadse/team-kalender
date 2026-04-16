// ============================================================
// STORAGE.JS – Plattformübergreifender lokaler Speicher
// Web: localStorage
// Desktop: Electron Store (Dateisystem)
// Mobile: Capacitor Preferences
// ============================================================

import { getPlatform, isMobile, isDesktop } from './platform.js';

/**
 * Wert lokal speichern (key-value).
 */
export async function setItem(key, value) {
  const val = typeof value === 'string' ? value : JSON.stringify(value);

  if (isDesktop()) {
    window.electronAPI?.storeSet?.(key, val);
    return;
  }

  if (isMobile()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value: val });
      return;
    } catch (_) {}
  }

  // Web-Fallback
  localStorage.setItem(key, val);
}

/**
 * Wert lokal laden.
 */
export async function getItem(key) {
  if (isDesktop()) {
    return window.electronAPI?.storeGet?.(key) ?? null;
  }

  if (isMobile()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      return value;
    } catch (_) {}
  }

  return localStorage.getItem(key);
}

/**
 * Wert lokal löschen.
 */
export async function removeItem(key) {
  if (isDesktop()) {
    window.electronAPI?.storeRemove?.(key);
    return;
  }

  if (isMobile()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
      return;
    } catch (_) {}
  }

  localStorage.removeItem(key);
}

/**
 * Alle lokalen Daten löschen.
 */
export async function clear() {
  if (isDesktop()) {
    window.electronAPI?.storeClear?.();
    return;
  }

  if (isMobile()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.clear();
      return;
    } catch (_) {}
  }

  localStorage.clear();
}
