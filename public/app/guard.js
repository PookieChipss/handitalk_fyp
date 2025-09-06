import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signOut, reload, sendEmailVerification
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';

initializeApp(firebaseConfig);
const auth = getAuth();
const $ = (id) => document.getElementById(id);

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = '/'; return; }
  $('who') && ($('who').textContent = user.displayName ? `${user.displayName} • ${user.email}` : user.email);

  try { await reload(user); } catch {}
  if (!user.emailVerified && $('verifyBanner')) {
    $('verifyBanner').style.display='block';
    $('btnResend').onclick = async () => {
      try { await sendEmailVerification(user); $('verifyBanner').innerHTML = 'Verification email sent.'; }
      catch (e) { $('verifyBanner').innerHTML = e.message; }
    };
    $('btnRefresh').onclick = () => location.reload();
  }

  $('btnSignOut') && ($('btnSignOut').onclick = async () => { await signOut(auth); location.href = '/'; });
});
