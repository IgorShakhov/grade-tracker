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
 * Public Firebase web configuration for Grade Tracker.
 * Security is enforced server-side via Firestore Security Rules (`firestore.rules`)
 * and Firebase Authentication Authorized Domains.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDAHUYYcqXnMxHdfK20u8yk_X-SeWQM9Rg',
  authDomain: 'grade-tracker-sync.firebaseapp.com',
  projectId: 'grade-tracker-sync',
  storageBucket: 'grade-tracker-sync.firebasestorage.app',
  messagingSenderId: '273653231170',
  appId: '1:273653231170:web:773ca39e4b584d61e187db',
};

let cachedServices = null;

/**
 * Lazily initializes Firebase Auth + Firestore Lite (`firebase/firestore/lite`).
 * Firestore Lite is stateless (zero IndexedDB persistence on disk — `E3`) and
 * dramatically smaller than the full WebChannel bundle for fast mobile loads.
 */
export function getFirebaseServices() {
  if (cachedServices) {
    return cachedServices;
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
