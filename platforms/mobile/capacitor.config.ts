import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.teamkalender.app',
  appName: 'Team Kalender',
  // Web-App Verzeichnis (relativ zum Projekt-Root)
  webDir: '../../src',
  server: {
    // In Entwicklung: Live-Reload vom lokalen Server
    // url: 'http://localhost:3000',
    // cleartext: true,
    androidScheme: 'https',
  },
  plugins: {
    // Push-Benachrichtigungen
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#5B5FEF',
    },
    // Splash Screen
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#5B5FEF',
      showSpinner: false,
    },
    // Status Bar
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#5B5FEF',
    },
    // Keyboard (Soft-Keyboard auf Mobile)
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  // iOS-spezifische Einstellungen
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
    scheme: 'Team Kalender',
  },
  // Android-spezifische Einstellungen
  android: {
    allowMixedContent: false,
    backgroundColor: '#F5F6FA',
  },
};

export default config;
