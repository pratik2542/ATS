import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore as getFirestoreSdk, type Firestore } from 'firebase/firestore';

export const isFirebaseEnabled = (): boolean => {
  const enabled = (process.env.FIREBASE_SYNC_ENABLED || 'true').toLowerCase();
  if (enabled === '0' || enabled === 'false' || enabled === 'no') return false;

  return Boolean(
    process.env.FIREBASE_API_KEY &&
      process.env.FIREBASE_AUTH_DOMAIN &&
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_APP_ID
  );
};

export const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || '',
};

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedFirestore: Firestore | null = null;
let initError: string | null = null;

const initFirebaseIfEnabled = (): void => {
  if (cachedApp || initError) return;
  if (!isFirebaseEnabled()) return;

  try {
    cachedApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    cachedAuth = getAuth(cachedApp);
    cachedFirestore = getFirestoreSdk(cachedApp);
  } catch (e: any) {
    initError = String(e?.message || e);
    cachedApp = null;
    cachedAuth = null;
    cachedFirestore = null;
  }
};

export const getFirebaseInitError = (): string | null => {
  initFirebaseIfEnabled();
  return initError;
};

export const getFirebaseApp = (): FirebaseApp | null => {
  initFirebaseIfEnabled();
  return cachedApp;
};

export const getFirebaseAuth = (): Auth | null => {
  initFirebaseIfEnabled();
  return cachedAuth;
};

export const getFirestore = (): Firestore | null => {
  initFirebaseIfEnabled();
  return cachedFirestore;
};
