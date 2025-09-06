import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail,
  sendEmailVerification, signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const $ = (id) => document.getElementById(id);
const set = (id, text) => { const el=$(id); if(el) el.textContent=text||''; };

// ---------- Sign in (index.html) ----------
if ($('btnSignIn')) {
  $('btnSignIn').onclick = async () => {
    try {
      const email = $('email').value.trim();
      const pass = $('password').value;
      await signInWithEmailAndPassword(auth, email, pass);
      location.href = '/home.html';
    } catch (e) { set('msg', `Error: ${e.message}`); }
  };
  onAuthStateChanged(auth, (user) => { if (user) location.href='/home.html'; });
}

// ---------- Sign up (signup.html) ----------
if ($('btnCreate')) {
  $('btnCreate').onclick = async () => {
    try {
      const name = $('suName').value.trim();
      const email = $('suEmail').value.trim();
      const pass = $('suPass').value;

      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      if (name) { await updateProfile(cred.user, { displayName: name }); }
      await sendEmailVerification(cred.user);

      set('suMsg', 'Account created. Verification email sent. Check your inbox.');
      await signOut(auth);
      setTimeout(()=>location.href='/', 1200);
    } catch (e) { set('suMsg', `Error: ${e.message}`); }
  };
  onAuthStateChanged(auth, (user) => { if (user) location.href='/home.html'; });
}

// ---------- Forgot (forgot.html) ----------
if ($('btnReset')) {
  $('btnReset').onclick = async () => {
    try {
      await sendPasswordResetEmail(auth, $('fpEmail').value.trim());
      set('fpMsg', 'Reset email sent. Please check your inbox.');
    } catch (e) { set('fpMsg', `Error: ${e.message}`); }
  };
}
