/* ============================================================
   AUTH.JS — Express Goods Carrier / TOS Phase 2
   Rewritten for Phase 2 completion:
   - Fixed Firestore save (was getting stuck on "Saving...")
   - Smooth premium animations throughout
   - Optimized: single DOM renders, minimal re-paints
   - Proper redirect flow: Google → Onboarding → Dashboard
   - Success feedback before redirect
   ============================================================ */

(function () {
  'use strict';

  var currentUser    = null;
  var currentProfile = null;
  var pendingAction  = null;
  var authReady      = false;
  var onReadyQueue   = [];
  var modalsBuilt    = false;

  /* ---------------------------------------------------------
     SVG ICONS
  --------------------------------------------------------- */
  var ICO = {
    user:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    dash:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
    route:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>',
    logout:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    check:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
    close:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    google:  '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.9 0-12.5-5.6-12.5-12.5S17.1 11 24 11c3.2 0 6.1 1.2 8.3 3.2l5.7-5.7C34.8 5.1 29.7 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 18.9 13 24 13c3.2 0 6.1 1.2 8.3 3.2l5.7-5.7C34.8 7.1 29.7 5 24 5c-7.7 0-14.4 4.3-17.7 9.7z"/><path fill="#4CAF50" d="M24 43c5.6 0 10.6-1.9 14.5-5.1l-6.7-5.5C29.7 33.7 27 35 24 35c-5.2 0-9.6-3.3-11.3-8H6v5.1C9.2 38.9 16 43 24 43z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.7 5.5C41.8 35.9 45 30.4 45 24c0-1.2-.1-2.4-.4-3.5z"/></svg>',
    shipment:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="6" width="14" height="10"/><path d="M15 9h4l3 3v4h-7"/><circle cx="5.5" cy="18" r="1.8"/><circle cx="18.5" cy="18" r="1.8"/></svg>'
  };

  /* ---------------------------------------------------------
     HELPERS
  --------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function firstName(n) { return (n || '').trim().split(' ')[0] || 'Account'; }
  function initials(n) {
    var p = (n || '').trim().split(' ').filter(Boolean);
    if (!p.length) return 'U';
    return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ---------------------------------------------------------
     NAV RENDERING — single innerHTML write per call
  --------------------------------------------------------- */
  function navSignedOutHTML() {
    return '<button class="signin-btn" type="button" onclick="TOS.openSignIn()">' +
      ICO.user + '<span>Sign In</span>' +
    '</button>';
  }

  function navSignedInHTML() {
    var name   = (currentProfile && currentProfile.contactPerson) ? currentProfile.contactPerson : firstName(currentUser.displayName);
    var photo  = currentUser.photoURL;
    var avatar = photo
      ? '<img src="' + esc(photo) + '" alt="">'
      : '<span class="av-txt">' + esc(initials(name)) + '</span>';
    return (
      '<div class="acct-wrap">' +
        '<button class="acct-btn" type="button" onclick="TOS._toggleAcctMenu()">' +
          '<span class="acct-avatar">' + avatar + '</span>' +
          '<span class="acct-name">' + esc(firstName(name)) + '</span>' +
          '<svg class="acct-caret" width="10" height="10" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<div class="acct-menu" id="acctMenu" role="menu">' +
          '<a href="dashboard.html">' + ICO.dash + ' Dashboard</a>' +
          '<a href="dashboard.html#shipment">' + ICO.shipment + ' New Shipment</a>' +
          '<a href="dashboard.html#profile">' + ICO.user + ' Profile</a>' +
          '<a href="dashboard.html#routes">' + ICO.route + ' Saved Routes</a>' +
          '<hr>' +
          '<a href="#" class="lo" onclick="TOS.logout();return false;">' + ICO.logout + ' Logout</a>' +
        '</div>' +
      '</div>'
    );
  }

  function renderNav() {
    var desktop = $('#authNav');
    var mobile  = $('#authNavMobile');
    var html    = currentUser ? navSignedInHTML() : navSignedOutHTML();
    if (desktop) desktop.innerHTML = html;
    if (mobile)  mobile.innerHTML  = currentUser ? navSignedInHTML() : navSignedOutHTML();
    // re-apply current language to freshly injected nodes
    if (window.T && window.curLang && typeof applyLang === 'function') {
      try { applyLang(window.curLang); } catch(e) {}
    }
  }

  /* Account menu toggle — click outside to close */
  window.TOS = window.TOS || {};
  window.TOS._toggleAcctMenu = function () {
    var m = $('#acctMenu');
    if (m) m.classList.toggle('open');
  };
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.acct-wrap')) {
      $all('.acct-menu').forEach(function (m) { m.classList.remove('open'); });
    }
  });

  /* ---------------------------------------------------------
     MODAL SHELL — built once
  --------------------------------------------------------- */
  function buildModals() {
    if (modalsBuilt) return;
    modalsBuilt = true;

    var authOv = document.createElement('div');
    authOv.className = 'au-overlay';
    authOv.id = 'auOverlay';
    authOv.innerHTML =
      '<div class="au-modal" id="auModal" role="dialog" aria-modal="true">' +
        '<button class="au-close" onclick="TOS._closeAuth()" aria-label="Close">' + ICO.close + '</button>' +
        '<div id="auBody"></div>' +
      '</div>';
    document.body.appendChild(authOv);

    var obOv = document.createElement('div');
    obOv.className = 'au-overlay';
    obOv.id = 'obOverlay';
    obOv.innerHTML =
      '<div class="au-modal" id="obModal" role="dialog" aria-modal="true">' +
        '<div id="obBody"></div>' +
      '</div>';
    document.body.appendChild(obOv);

    // close on backdrop click
    authOv.addEventListener('click', function (e) {
      if (e.target === authOv) TOS._closeAuth();
    });
  }

  window.TOS._closeAuth = function () {
    var o = $('#auOverlay');
    if (!o) return;
    o.classList.remove('open');
  };

  /* ---------------------------------------------------------
     AUTH MODAL VIEWS
  --------------------------------------------------------- */
  function authHeader(heading, sub) {
    return (
      '<div class="au-eyebrow">Express Goods Carrier</div>' +
      '<h2 class="au-h2">' + heading + '</h2>' +
      '<p class="au-sub">' + sub + '</p>' +
      '<ul class="au-perks">' +
        '<li>' + ICO.check + ' Save shipment history</li>' +
        '<li>' + ICO.check + ' Track future shipments</li>' +
        '<li>' + ICO.check + ' Access invoices &amp; faster bookings</li>' +
      '</ul>'
    );
  }

  function renderSignIn() {
    $('#auBody').innerHTML = (
      authHeader('Welcome back', 'Sign in to manage your shipments and bookings.') +
      '<button class="au-google" type="button" onclick="TOS._googleSignIn()">' + ICO.google + ' Continue with Google</button>' +
      '<div class="au-divider">or</div>' +
      '<div class="au-form" id="auForm">' +
        '<div class="au-field"><label>Email</label><input type="email" id="auEmail" placeholder="you@company.com" autocomplete="email"></div>' +
        '<div class="au-field"><label>Password</label><input type="password" id="auPass" placeholder="••••••••" autocomplete="current-password"></div>' +
        '<button class="au-submit" type="button" onclick="TOS._emailSignIn()">Continue with Email</button>' +
      '</div>' +
      '<div class="au-msg" id="auMsg"></div>' +
      '<div class="au-switch">New here? <a onclick="TOS._view(\'signup\')">Create an account</a></div>' +
      '<div class="au-switch" style="margin-top:6px;"><a class="au-link" onclick="TOS._view(\'forgot\')">Forgot password?</a></div>'
    );
    setTimeout(function () { var f = $('#auEmail'); if (f) f.focus(); }, 60);
  }

  function renderSignUp() {
    $('#auBody').innerHTML = (
      authHeader('Create your account', 'Save shipment history and skip re-typing your details every time.') +
      '<button class="au-google" type="button" onclick="TOS._googleSignIn()">' + ICO.google + ' Continue with Google</button>' +
      '<div class="au-divider">or</div>' +
      '<div class="au-form" id="auForm">' +
        '<div class="au-field"><label>Email</label><input type="email" id="auEmail" placeholder="you@company.com" autocomplete="email"></div>' +
        '<div class="au-field"><label>Password</label><input type="password" id="auPass" placeholder="At least 6 characters" autocomplete="new-password" minlength="6"></div>' +
        '<button class="au-submit" type="button" onclick="TOS._emailSignUp()">Create Account</button>' +
      '</div>' +
      '<div class="au-msg" id="auMsg"></div>' +
      '<div class="au-switch">Already have an account? <a onclick="TOS._view(\'signin\')">Sign in</a></div>'
    );
    setTimeout(function () { var f = $('#auEmail'); if (f) f.focus(); }, 60);
  }

  function renderForgot() {
    $('#auBody').innerHTML = (
      '<div class="au-eyebrow">Reset Password</div>' +
      '<h2 class="au-h2">Forgot your password?</h2>' +
      '<p class="au-sub">Enter your email and we\'ll send a reset link.</p>' +
      '<div class="au-form" id="auForm">' +
        '<div class="au-field"><label>Email</label><input type="email" id="auEmail" placeholder="you@company.com" autocomplete="email"></div>' +
        '<button class="au-submit" type="button" onclick="TOS._sendReset()">Send Reset Link</button>' +
      '</div>' +
      '<div class="au-msg" id="auMsg"></div>' +
      '<div class="au-switch"><a onclick="TOS._view(\'signin\')">&larr; Back to sign in</a></div>'
    );
    setTimeout(function () { var f = $('#auEmail'); if (f) f.focus(); }, 60);
  }

  window.TOS._view = function (name) {
    if (name === 'signin')  renderSignIn();
    else if (name === 'signup') renderSignUp();
    else if (name === 'forgot') renderForgot();
  };

  function openAuth(view) {
    buildModals();
    TOS._view(view || 'signin');
    requestAnimationFrame(function () {
      $('#auOverlay').classList.add('open');
    });
  }
  window.TOS.openSignIn = function () { openAuth('signin'); };

  function showMsg(ok, text) {
    var m = $('#auMsg');
    if (!m) return;
    m.className = 'au-msg ' + (ok ? 'ok' : 'er');
    m.textContent = text;
  }

  function setSubmitState(btnSel, loading, label) {
    var btn = $(btnSel || '.au-submit');
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = label;
    btn.classList.toggle('loading', loading);
  }

  /* ---------------------------------------------------------
     GOOGLE SIGN-IN
  --------------------------------------------------------- */
  window.TOS._googleSignIn = function () {
    var provider = new firebase.auth.GoogleAuthProvider();
    fbAuth.signInWithPopup(provider)
      .then(function () { TOS._closeAuth(); })
      .catch(function (err) { showMsg(false, humanizeAuthError(err)); });
  };

  /* ---------------------------------------------------------
     EMAIL SIGN-IN / SIGN-UP / RESET
  --------------------------------------------------------- */
  window.TOS._emailSignIn = function () {
    var email = $('#auEmail'); var pass = $('#auPass');
    if (!email || !pass) return;
    setSubmitState('.au-submit', true, 'Signing in…');
    fbAuth.signInWithEmailAndPassword(email.value.trim(), pass.value)
      .then(function () { TOS._closeAuth(); })
      .catch(function (err) {
        setSubmitState('.au-submit', false, 'Continue with Email');
        showMsg(false, humanizeAuthError(err));
      });
  };

  window.TOS._emailSignUp = function () {
    var email = $('#auEmail'); var pass = $('#auPass');
    if (!email || !pass) return;
    setSubmitState('.au-submit', true, 'Creating account…');
    fbAuth.createUserWithEmailAndPassword(email.value.trim(), pass.value)
      .then(function () { TOS._closeAuth(); })
      .catch(function (err) {
        setSubmitState('.au-submit', false, 'Create Account');
        showMsg(false, humanizeAuthError(err));
      });
  };

  window.TOS._sendReset = function () {
    var email = $('#auEmail');
    if (!email) return;
    setSubmitState('.au-submit', true, 'Sending…');
    fbAuth.sendPasswordResetEmail(email.value.trim())
      .then(function () {
        setSubmitState('.au-submit', false, 'Send Reset Link');
        showMsg(true, 'Reset link sent — check your inbox.');
      })
      .catch(function (err) {
        setSubmitState('.au-submit', false, 'Send Reset Link');
        showMsg(false, humanizeAuthError(err));
      });
  };

  window.TOS.logout = function () {
    fbAuth.signOut();
    $all('.acct-menu').forEach(function (m) { m.classList.remove('open'); });
  };

  function humanizeAuthError(err) {
    var map = {
      'auth/wrong-password':        'Incorrect password. Try again.',
      'auth/invalid-credential':    'Incorrect email or password.',
      'auth/user-not-found':        'No account found with this email.',
      'auth/email-already-in-use':  'An account already exists with this email.',
      'auth/invalid-email':         'Please enter a valid email address.',
      'auth/weak-password':         'Password should be at least 6 characters.',
      'auth/popup-closed-by-user':  'Sign-in was cancelled.',
      'auth/popup-blocked':         'Popup was blocked — please allow popups for this site.',
      'auth/network-request-failed':'Network error. Check your connection and try again.',
      'auth/too-many-requests':     'Too many attempts. Please wait a moment and try again.'
    };
    return map[err.code] || err.message || 'Something went wrong. Please try again.';
  }

  /* ---------------------------------------------------------
     ONBOARDING MODAL
     Issue 1 fix: Firestore write was failing silently due to
     Firestore security rules blocking the write while the
     auth state hadn't fully propagated. We now:
     1. Use fbAuth.currentUser directly (most current token)
     2. Add explicit error logging
     3. Show proper success feedback before closing
     4. Redirect to dashboard after save
  --------------------------------------------------------- */
  function renderOnboarding(user) {
    var name  = esc(user.displayName || '');
    var email = esc(user.email || '');
    var phone = esc(user.phoneNumber || '');
    var hasPhoto = !!user.photoURL;

    $('#obBody').innerHTML = (
      '<div class="au-eyebrow">Almost there</div>' +
      '<h2 class="au-h2">Set up your account</h2>' +
      '<p class="au-sub">Just a few details — we\'ll reuse these for every future booking.</p>' +
      (name || email
        ? '<div class="ob-prefill">' +
            (hasPhoto ? '<img src="' + esc(user.photoURL) + '" alt="">' : '') +
            '<div><strong>' + (name || 'Welcome') + '</strong><span>' + email + '</span></div>' +
          '</div>'
        : '') +
      '<div class="au-form" id="obForm">' +
        '<div class="au-field"><label>Company Name *</label><input type="text" id="obCompany" placeholder="Your company name" required></div>' +
        '<div class="ob-row">' +
          '<div class="au-field"><label>Contact Person *</label><input type="text" id="obContact" placeholder="Full name" value="' + name + '" required></div>' +
          '<div class="au-field"><label>Mobile Number *</label><input type="tel" id="obMobile" placeholder="+91 XXXXX XXXXX" value="' + phone + '" required></div>' +
        '</div>' +
        '<div class="au-field"><label>GST Number <span style="font-weight:400;opacity:.6;">(Optional)</span></label><input type="text" id="obGst" placeholder="22AAAAA0000A1Z5"></div>' +
        '<button class="au-submit" id="obSaveBtn" type="button" onclick="TOS._saveOnboarding()">Save &amp; Continue</button>' +
      '</div>' +
      '<div class="au-msg" id="obMsg"></div>'
    );
    setTimeout(function () { var f = $('#obCompany'); if (f) f.focus(); }, 60);
  }

  window.TOS._saveOnboarding = function () {
    /* --- Validate --- */
    var companyEl = $('#obCompany');
    var contactEl = $('#obContact');
    var mobileEl  = $('#obMobile');
    var gstEl     = $('#obGst');
    var btn       = $('#obSaveBtn');
    var msgEl     = $('#obMsg');

    if (!companyEl || !contactEl || !mobileEl) return;

    var company = companyEl.value.trim();
    var contact = contactEl.value.trim();
    var mobile  = mobileEl.value.trim();
    var gst     = gstEl ? gstEl.value.trim() : '';

    if (!company) { showObMsg(false, 'Please enter your company name.'); companyEl.focus(); return; }
    if (!contact) { showObMsg(false, 'Please enter a contact person name.'); contactEl.focus(); return; }
    if (!mobile)  { showObMsg(false, 'Please enter a mobile number.'); mobileEl.focus(); return; }

    /* --- Use the live auth user (ensures token is fresh) --- */
    var user = fbAuth.currentUser;
    if (!user) {
      showObMsg(false, 'Session expired. Please sign in again.');
      return;
    }

    /* --- Loading state --- */
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Saving…';

    var data = {
      companyName:        company,
      contactPerson:      contact,
      mobile:             mobile,
      gstNumber:          gst || null,
      email:              user.email || null,
      uid:                user.uid,
      onboardingComplete: true,
      updatedAt:          firebase.firestore.FieldValue.serverTimestamp(),
      createdAt:          firebase.firestore.FieldValue.serverTimestamp()
    };

    /* --- Write to Firestore --- */
    fbDB.collection('customerProfiles').doc(user.uid)
      .set(data, { merge: true })
      .then(function () {
        currentProfile = data;
        currentUser    = user;

        /* Success state */
        btn.innerHTML = ICO.check + ' Saved!';
        btn.classList.add('success');

        if (msgEl) {
          msgEl.className = 'au-msg ok';
          msgEl.textContent = '✓ Welcome to Express Goods Carrier!';
        }

        renderNav();

        /* Redirect to dashboard after short success moment */
        setTimeout(function () {
          var ob = $('#obOverlay');
          if (ob) ob.classList.remove('open');

          /* If a pending action exists (e.g. quote form), run it.
             Otherwise redirect to dashboard. */
          if (pendingAction) {
            runPendingAction();
          } else {
            /* Smooth redirect */
            document.body.style.transition = 'opacity .35s ease';
            document.body.style.opacity = '0';
            setTimeout(function () {
              window.location.href = 'dashboard.html';
            }, 350);
          }
        }, 1200);

        /* Notify any onReady listeners */
        onReadyQueue.splice(0).forEach(function (fn) { fn(currentUser, currentProfile); });
      })
      .catch(function (err) {
        console.error('[TOS] Firestore save error:', err.code, err.message);
        btn.disabled  = false;
        btn.innerHTML = 'Save &amp; Continue';
        showObMsg(false, err.message || 'Could not save. Please try again.');
      });
  };

  function showObMsg(ok, text) {
    var m = $('#obMsg');
    if (!m) return;
    m.className = 'au-msg ' + (ok ? 'ok' : 'er');
    m.textContent = text;
  }

  function openOnboarding(user) {
    buildModals();
    renderOnboarding(user);
    requestAnimationFrame(function () {
      $('#obOverlay').classList.add('open');
    });
  }

  /* ---------------------------------------------------------
     AUTH GATE — used by booking CTAs
  --------------------------------------------------------- */
  window.TOS.requireAuth = function (actionFn) {
    if (currentUser && currentProfile && currentProfile.onboardingComplete) {
      actionFn();
      return true;
    }
    pendingAction = actionFn;
    if (currentUser && (!currentProfile || !currentProfile.onboardingComplete)) {
      openOnboarding(currentUser);
    } else {
      openAuth('signup');
    }
    return false;
  };

  function runPendingAction() {
    if (pendingAction) {
      var fn   = pendingAction;
      pendingAction = null;
      fn();
    }
  }

  /* ---------------------------------------------------------
     QUOTE FORM PRE-FILL
  --------------------------------------------------------- */
  function prefillQuoteForm() {
    if (!currentProfile) return;
    var qn = $('#qn'), qp = $('#qp');
    if (qn && !qn.value) qn.value = currentProfile.contactPerson || '';
    if (qp && !qp.value) qp.value = currentProfile.mobile || '';
  }

  /* ---------------------------------------------------------
     PUBLIC API
  --------------------------------------------------------- */
  window.TOS.getProfile = function () { return currentProfile; };
  window.TOS.getUser    = function () { return currentUser; };
  window.TOS.onReady    = function (fn) {
    if (authReady) fn(currentUser, currentProfile);
    else onReadyQueue.push(fn);
  };

  /* ---------------------------------------------------------
     AUTH STATE LISTENER
     Optimized: users/{uid} write is fire-and-forget;
     we don't await it before checking customerProfiles.
  --------------------------------------------------------- */
  fbAuth.onAuthStateChanged(function (user) {
    currentUser = user;

    if (!user) {
      currentProfile = null;
      renderNav();
      authReady = true;
      onReadyQueue.splice(0).forEach(function (fn) { fn(null, null); });
      return;
    }

    /* Fire-and-forget: keep user record fresh */
    fbDB.collection('users').doc(user.uid).set({
      uid:          user.uid,
      name:         user.displayName || null,
      email:        user.email       || null,
      phone:        user.phoneNumber || null,
      authProvider: (user.providerData[0] && user.providerData[0].providerId) || 'password',
      lastLoginAt:  firebase.firestore.FieldValue.serverTimestamp(),
      createdAt:    firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(function (e) { console.warn('[TOS] users write:', e.message); });

    /* Check for existing customer profile */
    fbDB.collection('customerProfiles').doc(user.uid).get()
      .then(function (doc) {
        if (doc.exists && doc.data().onboardingComplete) {
          currentProfile = doc.data();
          renderNav();
          prefillQuoteForm();
          runPendingAction();
        } else {
          currentProfile = null;
          renderNav();
          openOnboarding(user);
        }
        authReady = true;
        onReadyQueue.splice(0).forEach(function (fn) { fn(currentUser, currentProfile); });
      })
      .catch(function (err) {
        console.error('[TOS] customerProfiles read:', err.message);
        /* If Firestore fails, still unblock the page */
        renderNav();
        authReady = true;
        onReadyQueue.splice(0).forEach(function (fn) { fn(currentUser, null); });
      });
  });

  /* ---------------------------------------------------------
     INIT
  --------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    buildModals();
    renderNav();
  });

})();
