import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, signOut, updateProfile, sendEmailVerification,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const $ = s => document.querySelector(s);
const SIGNIN_FAIL = 'Email or password is incorrect.';
const MSG = {
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/weak-password': 'Use a password of at least 8 characters.',
  'auth/missing-password': 'Enter your password.',
  'auth/invalid-credential': SIGNIN_FAIL,
  'auth/user-not-found': SIGNIN_FAIL,
  'auth/wrong-password': SIGNIN_FAIL,
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/popup-closed-by-user': 'The Google sign-in window was closed before finishing.',
  'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups and try again.',
  'auth/unauthorized-domain': 'This site is not an authorized domain. Add it under Authentication, Settings, Authorized domains.',
  'auth/operation-not-allowed': 'This sign-in method is disabled. Enable it in the Firebase console.',
  'auth/invalid-api-key': 'The Firebase API key in firebase-config.js is invalid.'
};
const friendly = e => MSG[e.code] || 'Something went wrong. Please try again.';
const say = (el, msg, bad) => { el.textContent = msg; el.className = 'status' + (bad ? ' bad' : ''); };

const configured = Boolean(firebaseConfig.apiKey) && !firebaseConfig.apiKey.startsWith('REPLACE');
if (!configured) {
  say($('#acc-notice'), 'Accounts are not set up yet. Add your Firebase web config to firebase-config.js, then reload.', true);
  document.querySelectorAll('#view-account button, #view-account input').forEach(el => { el.disabled = true; });
}

let auth = null;
try {
  if (configured) auth = getAuth(initializeApp(firebaseConfig));
} catch (e) {
  say($('#acc-notice'), 'Firebase could not start: ' + e.message, true);
}

function render(user) {
  $('#acc-out').hidden = Boolean(user);
  $('#acc-in').hidden = !user;
  if (user) {
    $('#acc-name').textContent = user.displayName || 'Signed in';
    $('#acc-email').textContent = user.email || '';
    $('#acc-verified').textContent = user.emailVerified ? 'Email verified' : 'Email not verified yet. Check your inbox.';
    $('#acc-resend').hidden = Boolean(user.emailVerified);
  }
  $('#side-user').textContent = user ? (user.displayName || user.email) : 'Not signed in';
}

if (auth) onAuthStateChanged(auth, render);

// Sign-in / sign-up mode toggle
document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b === btn));
  const up = btn.dataset.mode === 'signup';
  $('#form-signup').hidden = !up;
  $('#form-signin').hidden = up;
}));

$('#form-signup').addEventListener('submit', async e => {
  e.preventDefault();
  const st = $('#signup-status');
  const name = $('#su-name').value.trim(), email = $('#su-email').value.trim();
  const pw = $('#su-pass').value, pw2 = $('#su-pass2').value;
  if (!name) return say(st, 'Enter your name.', true);
  if (pw.length < 8) return say(st, 'Use a password of at least 8 characters.', true);
  if (pw !== pw2) return say(st, 'The passwords do not match.', true);
  try {
    say(st, 'Creating your account…');
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await updateProfile(cred.user, { displayName: name });
    await sendEmailVerification(cred.user);
    render(auth.currentUser);
    e.target.reset();
    say(st, `Account created. We sent a verification email to ${email}.`);
  } catch (err) { say(st, friendly(err), true); }
});

$('#form-signin').addEventListener('submit', async e => {
  e.preventDefault();
  const st = $('#signin-status');
  try {
    say(st, 'Signing in…');
    await signInWithEmailAndPassword(auth, $('#si-email').value.trim(), $('#si-pass').value);
    e.target.reset();
    say(st, '');
  } catch (err) { say(st, friendly(err), true); }
});

$('#reset').addEventListener('click', async () => {
  const st = $('#signin-status'), email = $('#si-email').value.trim();
  if (!email) return say(st, 'Enter your email address first.', true);
  try {
    await sendPasswordResetEmail(auth, email);
    say(st, 'If an account exists for that email, a reset link is on its way.');
  } catch (err) { say(st, friendly(err), true); }
});

$('#google').addEventListener('click', async () => {
  const st = $('#signin-status');
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) { say(st, friendly(err), true); }
});

$('#signout').addEventListener('click', async () => {
  try { await signOut(auth); } catch (err) { say($('#acc-status'), friendly(err), true); }
});

$('#acc-resend').addEventListener('click', async () => {
  const st = $('#acc-status');
  try {
    await sendEmailVerification(auth.currentUser);
    say(st, 'Verification email sent. Check your inbox and spam folder.');
  } catch (err) { say(st, friendly(err), true); }
});
