// ============================================================================
// Firebase Auth — Google + Phone OTP + Email/Password
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

// ---------------------------------------------------------------------------
// Your existing Firebase configuration
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyCDipnewdxDqyi0ikKiCUxbC6RXECN0jYM",
  authDomain: "good-dac5b.firebaseapp.com",
  projectId: "good-dac5b",
  storageBucket: "good-dac5b.firebasestorage.app",
  messagingSenderId: "400026161831",
  appId: "1:400026161831:web:8b03d4e226144c1d568182",
  measurementId: "G-54JVC18E9N"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Persistent session: user stays signed in across page reloads / browser restarts.
// This also enables "auto login if already authenticated" via onAuthStateChanged below.
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Failed to set persistence:", err);
});

// ============================================================================
// Screen / navigation helpers
// ============================================================================
const screens = {};
document.querySelectorAll(".screen").forEach((el) => (screens[el.id] = el));

function showScreen(id) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[id].classList.add("active");
}

document.querySelectorAll("[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.back));
});

// ============================================================================
// Status / error helpers
// ============================================================================
function setStatus(elId, msg, type = "") {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.remove("error", "success");
  if (type) el.classList.add(type);
}

function clearStatus(elId) {
  setStatus(elId, "");
}

// Maps common Firebase error codes to friendly messages.
function friendlyError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "That email address looks invalid.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/missing-password": "Please enter a password.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "auth/invalid-phone-number": "That phone number looks invalid. Include the country code.",
    "auth/invalid-verification-code": "That code is incorrect. Please check and try again.",
    "auth/code-expired": "That code has expired. Please request a new one.",
    "auth/popup-closed-by-user": "Sign-in popup was closed before completing.",
    "auth/network-request-failed": "Network error. Check your connection and try again."
  };
  return map[code] || err?.message || "Something went wrong. Please try again.";
}

// Toggles a button between idle and loading state (spinner + disabled).
function setButtonLoading(btn, isLoading) {
  btn.disabled = isLoading;
  btn.querySelector(".btn-label")?.classList.toggle("hidden", isLoading);
  btn.querySelector(".btn-spinner")?.classList.toggle("hidden", !isLoading);
}

// ============================================================================
// 1. GOOGLE LOGIN
// ============================================================================
const googleBtn = document.getElementById("googleBtn");

googleBtn.addEventListener("click", async () => {
  googleBtn.disabled = true;
  clearStatus("status-method");
  try {
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged below handles showing the profile screen.
  } catch (err) {
    console.error(err);
    setStatus("status-method", friendlyError(err), "error");
  } finally {
    googleBtn.disabled = false;
  }
});

// ============================================================================
// 2. PHONE OTP LOGIN  (fixes "reCAPTCHA has already been rendered")
// ============================================================================
//
// Root cause of the original bug: a new `RecaptchaVerifier` was created every
// time the user clicked "Send OTP" (e.g. after an error), but the container
// div already had a rendered widget in it — Firebase throws because you
// cannot render two widgets into the same element.
//
// Fix: create the verifier ONCE (module-level singleton), render it ONCE,
// and reuse the resulting widgetId for the lifetime of the page. If sending
// the OTP fails, we RESET the existing widget instead of constructing a new
// RecaptchaVerifier.
// ----------------------------------------------------------------------------

let recaptchaVerifier = null;
let recaptchaWidgetId = null;
let recaptchaReadyPromise = null;

function getRecaptchaVerifier() {
  if (recaptchaReadyPromise) return recaptchaReadyPromise;

  recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
    size: "invisible"
  });

  recaptchaReadyPromise = recaptchaVerifier.render().then((widgetId) => {
    recaptchaWidgetId = widgetId;
    return recaptchaVerifier;
  });

  return recaptchaReadyPromise;
}

function resetRecaptcha() {
  if (window.grecaptcha && recaptchaWidgetId !== null) {
    window.grecaptcha.reset(recaptchaWidgetId);
  }
}

document.getElementById("showPhoneBtn").addEventListener("click", () => {
  clearStatus("status-method");
  showScreen("screen-phone-entry");
  // Mount reCAPTCHA as soon as the phone screen is shown, once, ever.
  getRecaptchaVerifier().catch((err) => {
    console.error("reCAPTCHA failed to render:", err);
    setStatus("status-phone-entry", "Could not load verification widget. Refresh and try again.", "error");
  });
});

const countryCodeInput = document.getElementById("countryCode");
const phoneNumberInput = document.getElementById("phoneNumber");
const sendOtpBtn = document.getElementById("sendOtpBtn");
const otpCodeInput = document.getElementById("otpCode");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const sentToNumberEl = document.getElementById("sentToNumber");

let confirmationResult = null;

sendOtpBtn.addEventListener("click", async () => {
  clearStatus("status-phone-entry");

  const code = countryCodeInput.value.trim();
  const number = phoneNumberInput.value.trim();

  if (!code.startsWith("+") || code.length < 2) {
    setStatus("status-phone-entry", "Country code must start with + (e.g. +91)", "error");
    return;
  }
  if (!/^\d{6,15}$/.test(number)) {
    setStatus("status-phone-entry", "Enter a valid phone number (digits only).", "error");
    return;
  }

  const fullPhoneNumber = `${code}${number}`;

  setButtonLoading(sendOtpBtn, true);
  try {
    const verifier = await getRecaptchaVerifier();
    confirmationResult = await signInWithPhoneNumber(auth, fullPhoneNumber, verifier);
    sentToNumberEl.textContent = fullPhoneNumber;
    otpCodeInput.value = "";
    clearStatus("status-phone-otp");
    showScreen("screen-phone-otp");
  } catch (err) {
    console.error(err);
    setStatus("status-phone-entry", friendlyError(err), "error");
    resetRecaptcha(); // reuse the same widget instead of recreating it
  } finally {
    setButtonLoading(sendOtpBtn, false);
  }
});

verifyOtpBtn.addEventListener("click", async () => {
  clearStatus("status-phone-otp");

  const otp = otpCodeInput.value.trim();
  if (!/^\d{6}$/.test(otp)) {
    setStatus("status-phone-otp", "Enter the 6-digit code.", "error");
    return;
  }
  if (!confirmationResult) {
    setStatus("status-phone-otp", "Session expired — please request a new code.", "error");
    return;
  }

  setButtonLoading(verifyOtpBtn, true);
  try {
    await confirmationResult.confirm(otp);
    otpCodeInput.value = "";
    // onAuthStateChanged below handles showing the profile screen.
  } catch (err) {
    console.error(err);
    setStatus("status-phone-otp", friendlyError(err), "error");
  } finally {
    setButtonLoading(verifyOtpBtn, false);
  }
});

// ============================================================================
// 3. EMAIL / PASSWORD AUTH (Sign Up, Sign In, Verification, Reset)
// ============================================================================
const showEmailBtn = document.getElementById("showEmailBtn");
const tabSignIn = document.getElementById("tabSignIn");
const tabSignUp = document.getElementById("tabSignUp");
const emailForm = document.getElementById("emailForm");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const confirmPasswordRow = document.getElementById("confirmPasswordRow");
const confirmPasswordInput = document.getElementById("confirmPasswordInput");
const emailSubmitBtn = document.getElementById("emailSubmitBtn");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");

let emailMode = "signin"; // or "signup"

showEmailBtn.addEventListener("click", () => {
  clearStatus("status-method");
  emailForm.reset();
  clearStatus("status-email");
  setEmailMode("signin");
  showScreen("screen-email");
});

function setEmailMode(mode) {
  emailMode = mode;
  const isSignUp = mode === "signup";
  tabSignIn.classList.toggle("active", !isSignUp);
  tabSignUp.classList.toggle("active", isSignUp);
  confirmPasswordRow.classList.toggle("hidden", !isSignUp);
  forgotPasswordLink.classList.toggle("hidden", isSignUp);
  emailSubmitBtn.querySelector(".btn-label").textContent = isSignUp ? "Sign Up" : "Sign In";
  passwordInput.autocomplete = isSignUp ? "new-password" : "current-password";
}

tabSignIn.addEventListener("click", () => setEmailMode("signin"));
tabSignUp.addEventListener("click", () => setEmailMode("signup"));

emailForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus("status-email");

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    setStatus("status-email", "Please fill in both fields.", "error");
    return;
  }
  if (password.length < 6) {
    setStatus("status-email", "Password should be at least 6 characters.", "error");
    return;
  }
  if (emailMode === "signup") {
    const confirmPassword = confirmPasswordInput.value;
    if (password !== confirmPassword) {
      setStatus("status-email", "Passwords do not match.", "error");
      return;
    }
  }

  setButtonLoading(emailSubmitBtn, true);
  try {
    if (emailMode === "signup") {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(cred.user);
      setStatus("status-email", "Account created! A verification email has been sent.", "success");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    // onAuthStateChanged below handles showing the profile screen.
  } catch (err) {
    console.error(err);
    setStatus("status-email", friendlyError(err), "error");
  } finally {
    setButtonLoading(emailSubmitBtn, false);
  }
});

// ----- Forgot password -----
const sendResetBtn = document.getElementById("sendResetBtn");
const resetEmailInput = document.getElementById("resetEmailInput");

forgotPasswordLink.addEventListener("click", () => {
  resetEmailInput.value = emailInput.value.trim();
  clearStatus("status-forgot");
  showScreen("screen-forgot");
});

sendResetBtn.addEventListener("click", async () => {
  clearStatus("status-forgot");
  const email = resetEmailInput.value.trim();
  if (!email) {
    setStatus("status-forgot", "Enter your email address.", "error");
    return;
  }

  setButtonLoading(sendResetBtn, true);
  try {
    await sendPasswordResetEmail(auth, email);
    setStatus("status-forgot", "Reset link sent. Check your inbox.", "success");
  } catch (err) {
    console.error(err);
    setStatus("status-forgot", friendlyError(err), "error");
  } finally {
    setButtonLoading(sendResetBtn, false);
  }
});

// ============================================================================
// PROFILE SCREEN + LOGOUT
// ============================================================================
const avatarEl = document.getElementById("avatar");
const avatarFallbackEl = document.getElementById("avatarFallback");
const profileNameEl = document.getElementById("profileName");
const profileEmailEl = document.getElementById("profileEmail");
const verifyBannerEl = document.getElementById("verifyBanner");
const resendVerificationBtn = document.getElementById("resendVerificationBtn");
const logoutBtn = document.getElementById("logoutBtn");

function renderProfile(user) {
  const displayName = user.displayName || (user.phoneNumber ? "Phone user" : user.email?.split("@")[0]) || "User";
  const identifier = user.email || user.phoneNumber || "";

  profileNameEl.textContent = displayName;
  profileEmailEl.textContent = identifier;

  if (user.photoURL) {
    avatarEl.src = user.photoURL;
    avatarEl.classList.remove("hidden");
    avatarFallbackEl.classList.add("hidden");
  } else {
    avatarEl.classList.add("hidden");
    avatarFallbackEl.textContent = displayName.charAt(0).toUpperCase();
    avatarFallbackEl.classList.remove("hidden");
  }

  // Show "verify your email" banner only for email/password accounts.
  const isEmailAccount = user.providerData.some((p) => p.providerId === "password");
  verifyBannerEl.classList.toggle("hidden", !(isEmailAccount && !user.emailVerified));

  clearStatus("status-profile");
  showScreen("screen-profile");
}

resendVerificationBtn.addEventListener("click", async () => {
  if (!auth.currentUser) return;
  resendVerificationBtn.disabled = true;
  try {
    await sendEmailVerification(auth.currentUser);
    setStatus("status-profile", "Verification email sent.", "success");
  } catch (err) {
    console.error(err);
    setStatus("status-profile", friendlyError(err), "error");
  } finally {
    resendVerificationBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await signOut(auth);
    // onAuthStateChanged below handles returning to the method screen.
  } catch (err) {
    console.error(err);
    setStatus("status-profile", friendlyError(err), "error");
  } finally {
    logoutBtn.disabled = false;
  }
});

// ============================================================================
// AUTH STATE — drives auto-login and logout-redirect for ALL methods above
// ============================================================================
onAuthStateChanged(auth, (user) => {
  if (user) {
    renderProfile(user);
  } else {
    // Reset transient form state so a fresh screen greets the next sign-in.
    confirmationResult = null;
    showScreen("screen-method");
  }
});
