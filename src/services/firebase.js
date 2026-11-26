import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore/lite';

/**
 * Resolves public Firebase Web App config from Vite build-time `VITE_FIREBASE_*`
 * environment variables (injected via GitHub Actions Secrets in CI or `.env.local` in dev).
 * Security is enforced server-side via `firestore.rules` and Firebase Auth Authorized Domains.
 */
export function resolveFirebaseConfig(env = import.meta.env) {
  const source = env || {};
  return {
    apiKey: String(source.VITE_FIREBASE_API_KEY || '').trim(),
    authDomain: String(source.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
    projectId: String(source.VITE_FIREBASE_PROJECT_ID || '').trim(),
    storageBucket: String(source.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
    messagingSenderId: String(source.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
    appId: String(source.VITE_FIREBASE_APP_ID || '').trim(),
  };
}

export const FIREBASE_CONFIG = resolveFirebaseConfig();

export function isFirebaseConfigComplete(config = FIREBASE_CONFIG) {
  return Boolean(
    config &&
      config.apiKey &&
      config.authDomain &&
      config.projectId &&
      config.appId,
  );
}

let cachedServices = null;

/**
 * Lazily initializes Firebase Auth + Firestore Lite (`firebase/firestore/lite`).
 * Throws a tagged `firebase/not-configured` error when `VITE_FIREBASE_*` env vars are absent
 * so the app stays cleanly in offline `localStorage` mode on unconfigured local clones.
 */
export function getFirebaseServices() {
  if (cachedServices) {
    return cachedServices;
  }

  if (!isFirebaseConfigComplete(FIREBASE_CONFIG)) {
    const err = new Error(
      'Cloud sync is not configured in this build. Copy .env.example to .env.local with your VITE_FIREBASE_* values.',
    );
    err.code = 'firebase/not-configured';
    throw err;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });
  const db = getFirestore(app);

  cachedServices = {
    app,
    auth,
    db,
    googleProvider,
    onAuthStateChanged: (cb, errCb) => onAuthStateChanged(auth, cb, errCb),
    signInWithGooglePopup: () => signInWithPopup(auth, googleProvider),
    signOutAuth: () => signOut(auth),
    doc: (...segments) => doc(db, ...segments),
    getDoc: (ref) => getDoc(ref),
    writeBatch: () => writeBatch(db),
    serverTimestamp: () => serverTimestamp(),
  };

  return cachedServices;
}
