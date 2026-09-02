// firebase-config.js
// Shared Firebase setup — imported by viewer.html, user.html and admin.html
// Auth: Email/Password + Google. Data: Firestore only (no Storage — avatars
// are stored as small Base64 strings directly on the user document).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  getDocs,
  serverTimestamp,
  increment,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAYWD958YR_neOOpv00aIvQ97-Cezx0zxg",
  authDomain: "knowbit-cc9be.firebaseapp.com",
  projectId: "knowbit-cc9be",
  storageBucket: "knowbit-cc9be.firebasestorage.app",
  messagingSenderId: "829734498236",
  appId: "1:829734498236:web:c85b2757f053c9d5a685b9"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Re-export the Firestore/Auth helpers so page scripts only need
// one import line: `import { auth, db, doc, ... } from "./firebase-config.js"`
export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  getDocs,
  serverTimestamp,
  increment,
  writeBatch
};
