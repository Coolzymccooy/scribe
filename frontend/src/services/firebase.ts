import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean);

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

if (hasFirebaseConfig) {
  firebaseApp = getApps()[0] || initializeApp(firebaseConfig);
  firebaseAuth = getAuth(firebaseApp);
}

const ensureAuth = (): Auth => {
  if (!firebaseAuth) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE_* values to frontend/.env.local.");
  }
  return firebaseAuth;
};

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const prefersRedirectFlow = () => {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
};

export const isFirebaseConfigured = hasFirebaseConfig;

export const subscribeToAuth = (callback: (user: User | null) => void) => {
  if (!firebaseAuth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(firebaseAuth, callback);
};

export const completeRedirectAuth = async () => {
  if (!firebaseAuth) return null;
  return getRedirectResult(firebaseAuth);
};

export const signInWithGoogle = async () => {
  const auth = ensureAuth();
  if (prefersRedirectFlow()) {
    await signInWithRedirect(auth, googleProvider);
    return;
  }
  await signInWithPopup(auth, googleProvider);
};

export const signOutUser = async () => {
  const auth = ensureAuth();
  await signOut(auth);
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const signInWithEmailPassword = async (email: string, password: string) => {
  const auth = ensureAuth();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new Error("Email and password are required.");
  }
  await signInWithEmailAndPassword(auth, normalizedEmail, password);
};

export const signUpWithEmailPassword = async (email: string, password: string) => {
  const auth = ensureAuth();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new Error("Email and password are required.");
  }
  await createUserWithEmailAndPassword(auth, normalizedEmail, password);
};

export const sendResetPasswordEmail = async (email: string) => {
  const auth = ensureAuth();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }
  await sendPasswordResetEmail(auth, normalizedEmail);
};
