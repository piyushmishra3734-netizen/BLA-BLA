/* ============================================================
   DASHBOARD.JS — Customer Dashboard (Phase 3 Upgraded)
   NEW: Revised quote banner with Accept / Reject actions.
        Customer sees owner revisions in real-time.
   ============================================================ */

(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------------------------------------------------------
     TABS
  --------------------------------------------------------- */
  function openTab(name) {
    $all('.dash-tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === name); });
    $all('.dash-panel').forEach(function (p) { p.classList.toggle('on', p.id === 'panel-' + name); });
  }
  $all('.dash-tab').forEach(function (t) {
    t.addEventListener('click', function () { openTab(t.dataset.tab); history.replaceState(null, '', '#' + t.dataset.tab); });
  });
  $all('[data-tab-link]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var name = a.dataset.tabLink;
      openTab(name);
      history.replaceState(null, '', '#' + name);
      var panel = $('#panel-' + name);
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  var initialTab = (location.hash || '').replace('#', '');
  if (['shipment', 'quotes', 'history', 'routes', 'profile', 'support'].indexOf(initialTab) !== -1) {
    openTab(initialTab);
  }

  /* ---------------------------------------------------------
     AUTH GUARD
  --------------------------------------------------------- */
  TOS.onReady(function (user, profile) {
    if (!user) {
      window.location.href = 'index.html';
      return;
    }
    var guard = $('#guard');
    var main  = $('#dashMain');
    if (guard) guard.classList.add('fade-out');
    if (main)  { main.style.display = 'block'; requestAnimationFrame(function(){ main.classList.add('visible'); }); }
    setTimeout(function () { if (guard) guard.style.display = 'none'; }, 380);

    var firstNm = (profile && profile.contactPerson) ? profile.contactPerson.split(' ')[0] : (user.displayName || 'there').split(' ')[0];
    $('#dashName').textContent = firstNm;
    var companyLine = $('#dashCompanyLine');
    if (companyLine && profile && profile.companyName) {
      companyLine.textContent = profile.companyName + ' — everything about your shipments, in one simple place.';
    }

    fillProfileForm(user, profile);
    renderCompletion(user, profile);
    loadRoutes(user, profile);
    loadQuotes(user);
    loadOrders(user);
  });

  /* ---------------------------------------------------------
     PROFILE COMPLETION
  --------------------------------------------------------- */
  var ICO_CHECK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  var ICO_CIRCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';

  function renderCompletion(user, profile) {
    var info = TOS.profileCompletion(profile, user);
    var pct  = info.pct;

    var ovRing = $('#ovRing'), ovPct = $('#ovPct'), ovCard = $('#ovProfileCard'), ovLink = $('#ovProfileLink');
    if (ovRing) ovRing.style.setProperty('--pct', pct);
    if (ovPct)  ovPct.textContent = pct + '%';
    if (pct >= 100) {
      if (ovRing) ovRing.classList.add('complete');
      if (ovCard) ovCard.classList.add('complete-card');
      if (ovLink) ovLink.textContent = 'Profile complete ✓';
    }

    var pcRing = $('#pcRing'), pcRingPct = $('#pcRingPct'), pcTitle = $('#pcTitle'), pcItems = $('#pcItems'), pcWrap = $('#pcWrap');
    if (pcRing) pcRing.style.setProperty('--pct', pct);
    if (pcRingPct) pcRingPct.textContent = pct + '%';
    if (pcTitle) pcTitle.textContent = pct >= 100 ? 'Profile Complete' : ('Profile Completion ' + pct + '%');
    if (pct >= 100) {
      if (pcRing) pcRing.classList.add('complete');
      if (pcWrap) pcWrap.classList.add('complete');
      if (pcTitle) pcTitle.classList.add('complete');
    }
    if (pcItems) {
      pcItems.innerHTML = info.items.map(function (item) {
        return '<span class="pc-item' + (item.done ? ' done' : '') + '"><span class="pc-ico">' + (item.done ? ICO_CHECK : ICO_CIRCLE) + '</span>' + item.label + '</span>';
      }).join('');
    }
  }

  /* ---------------------------------------------------------
     PROFILE FORM
  --------------------------------------------------------- */
  function fillProfileForm(user, profile) {
    $('#pEmail').value = user.email || '';
    if (profile) {
      $('#pCompany').value  = profile.companyName   || '';
      $('#pContact').value  = profile.contactPerson || '';
      $('#pMobile').value   = profile.mobile        || '';
      $('#pGst').value      = profile.gstNumber     || '';
    }
  }

  window.DASH = window.DASH || {};
  window.DASH.saveProfile = function (e) {
    e.preventDefault();
    var msg = $('#profileMsg');
    var data = {
      companyName:        $('#pCompany').value.trim(),
      contactPerson:      $('#pContact').value.trim(),
      mobile:             $('#pMobile').value.trim(),
      gstNumber:          $('#pGst').value.trim() || null,
      onboardingComplete: true,
      updatedAt:          firebase.firestore.FieldValue.serverTimestamp()
    };
    fbDB.collection('customerProfiles').doc(TOS.getUser().uid).set(data, { merge: true })
      .then(function () {
        msg.className = 'fst ok'; msg.textContent = '✓ Profile updated.';
        $('#dashName').textContent = data.contactPerson.split(' ')[0];
        renderCompletion(TOS.getUser(), data);
      })
      .catch(function (err) {
        msg.className = 'fst er'; msg.textContent = err.message || 'Could not save. Try again.';
      });
    return false;
  };

  /* ---------------------------------------------------------
     FAVORITE ROUTES
  --------------------------------------------------------- */
  function routesRef() {
    return fbDB.collection('customerProfiles').doc(TOS.getUser().uid).collection('savedRoutes');
  }

  function routeRowHTML(id, pickup, delivery) {
    return (
      '<div class="route-row" data-id="' + id + '">' +
        '<div class="route-info">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>' +
          '<span>' + pickup + ' &rarr; ' + delivery + '</span>' +
        '</div>' +
        '<button class="route-del" type="button" onclick="DASH.deleteRoute(\'' + id + '\')">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>' +
        '</button>' +
      '</div>'
    );
  }

  function loadRoutes() {
    var list = $('#routeList');
    routesRef().orderBy('createdAt', 'desc').get().then(function (snap) {
      if (snap.empty) {
        list.innerHTML = '<div class="empty" style="padding:24px 0;"><p>No saved routes yet — add the ones you book most.</p></div>';
        $('#ovRoutes').textContent = '0';
        pushActivitySource('routes', []);
        return;
      }
      var html = '', routes = [];
      snap.forEach(function (doc) {
        var d = doc.data();
        html += routeRowHTML(doc.id, d.pickup, d.delivery);
        routes.push(d);
      });
      list.innerHTML = html;
      $('#ovRoutes').textContent = String(snap.size);
      pushActivitySource('routes', routes);
    }).catch(function () {
      $('#ovRoutes').textContent = '0';
    });
  }

  window.DASH.addRoute = function () {
    var pickup   = $('#rPickup').value.trim();
    var delivery = $('#rDelivery').value.trim();
    var msg      = $('#routeMsg');
    if (!pickup || !delivery) {
      msg.className = 'fst er'; msg.textContent = 'Enter both pickup and delivery locations.';
      return;
    }
    routesRef().add({
      pickup: pickup, delivery: delivery,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      $('#rPickup').value = ''; $('#rDelivery').value = '';
      msg.className = 'fst ok'; msg.textContent = '✓ Route saved.';
      loadRoutes();
    }).catch(function (err) {
      msg.className = 'fst er'; msg.textContent = err.message || 'Could not save route.';
    });
  };

  window.DASH.deleteRoute = function (id) {
    routesRef().doc(id).delete().then(loadRoutes);
  };

  /* ---------------------------------------------------------
     RECENT ACTIVITY
  --------------------------------------------------------- */
  function relTime(ts) {
    if (!ts || !ts.toDate) return 'Just now';
    var diff = Date.now() - ts.toDate().getTime();
    var mins = Math.round(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' hr' + (hrs > 1 ? 's' : '') + ' ago';
    var days = Math.round(hrs / 24);
    return days + ' day' + (days > 1 ? 's' : '') + ' ago';
  }

  var ICO_ROUTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>';
  var ICO_QUOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var ICO_ORDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="6" width="14" height="10"/><path d="M15 9h4l3 3v4h-7"/><circle cx="5.5" cy="18" r="1.8"/><circle cx="18.5" cy="18" r="1.8"/></svg>';

  var activitySources = { routes: [], quotes: [], orders: [] };

  function pushActivitySource(key, items) {
    activitySources[key] = items;
    renderActivity();
  }

  function renderActivity() {
    var list = $('#activityList');
    if (!list) return;
    var merged = [];
    activitySources.routes.forEach(function (r) {
      merged.push({ ts: r.createdAt, ico: ICO_ROUTE, txt: 'Saved route: ' + r.pickup + ' &rarr; ' + r.delivery });
    });
    activitySources.quotes.forEach(function (q) {
      merged.push({ ts: q.updatedAt || q.createdAt, ico: ICO_QUOTE, txt: 'Quote ' + q.quoteId + ' — ' + EGC.quoteStatusLabel(q.status) });
    });
    activitySources.orders.forEach(function (o) {
      merged.push({ ts: o.updatedAt || o.createdAt, ico: ICO_ORDER, txt: 'Order ' + o.orderId + ' — ' + EGC.orderStatusLabel(o.status) });
    });

    if (!merged.length) {
      list.innerHTML = '<div class="empty" style="padding:24px 0;"><p>No recent activity yet.</p></div>';
      return;
    }

    merged.sort(function (a, b) {
      var at = (a.ts && a.ts.toDate) ? a.ts.toDate().getTime() : 0;
      var bt = (b.ts && b.ts.toDate) ? b.ts.toDate().getTime() : 0;
      return bt - at;
    });

    list.innerHTML = merged.slice(0, 6).map(function (r) {
      return (
        '<div class="activity-row">' +
          '<div class="activity-ico">' + r.ico + '</div>' +
          '<div><div class="activity-txt">' + r.txt + '</div>' +
          '<div class="activity-time">' + relTime(r.ts) + '</div></div>' +
        '</div>'
      );
    }).join('');
  }

  /* ===========================================================
     PHASE 3 — MODULE 1: QUOTE SUBMISSION
  =========================================================== */
  window.DASH.submitQuote = function (e) {
    e.preventDefault();
    var msg  = $('#shipmentMsg');
    var btn  = $('#sSubmitBtn');
    var user = TOS.getUser();
    var profile = TOS.getProfile();

    var pickup     = $('#sPickup').value.trim();
    var delivery   = $('#sDelivery').value.trim();
    var material   = $('#sMaterial').value;
    var weight     = $('#sWeight').value.trim();
    var packages   = $('#sPackages').value.trim();
    var pickupDate = $('#sPickupDate').value;
    var notes      = $('#sNotes').value.trim();

    if (!pickup || !delivery || !material || !weight || !packages || !pickupDate) {
      msg.className = 'fst er';
      msg.textContent = '⚠ Please fill in all required fields.';
      return false;
    }

    btn.disabled = true;
    var btnSpan = btn.querySelector('span');
    var origLabel = btnSpan ? btnSpan.textContent : '';
    if (btnSpan) btnSpan.textContent = 'Submitting…';
    msg.className = ''; msg.textContent = '';

    EGC.nextQuoteId().then(function (quoteId) {
      var data = {
        quoteId:       quoteId,
        customerUid:   user.uid,
        customerName:  (profile && profile.contactPerson) || user.displayName || 'Customer',
        customerEmail: user.email || null,
        customerPhone: (profile && profile.mobile) || null,
        companyName:   (profile && profile.companyName) || null,
        pickup:        pickup,
        delivery:      delivery,
        materialType:  material,
        weight:        weight,
        packages:      packages,
        pickupDate:    pickupDate,
        notes:         notes || null,
        status:        EGC.QUOTE_STATUS.PENDING,   /* 'pending_review' */
        ownerNote:     null,
        revisedPrice:  null,
        ownerComment:  null,
        createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
      };
      return fbDB.collection('quotes').doc(quoteId).set(data).then(function () { return quoteId; });
    }).then(function (quoteId) {
      msg.className = 'fst ok';
      msg.textContent = '✓ Quote request submitted — ' + quoteId + '. We\'ll review it shortly.';
      $('#shipmentForm').reset();
      btn.disabled = false;
      if (btnSpan) btnSpan.textContent = origLabel;
    }).catch(function (err) {
      msg.className = 'fst er';
      msg.textContent = err.message || 'Could not submit quote. Please try again.';
      btn.disabled = false;
      if (btnSpan) btnSpan.textContent = origLabel;
    });

    return false;
  };

  /* ===========================================================
     PHASE 3 — MODULE 2: CUSTOMER QUOTE HISTORY
     Now includes: revised quote banner with Accept / Reject.
  =========================================================== */
  var quotesUnsub = null;
  var quotesCache = {};   /* quoteId -> data, for accept/reject actions */

  function quoteRowHTML(q) {
    quotesCache[q.quoteId] = q;

    var badge    = '<span class="st-badge ' + EGC.quoteStatusClass(q.status) + '"><span class="st-dot"></span>' + EGC.quoteStatusLabel(q.status) + '</span>';
    var noteHTML = (q.status === 'rejected' && q.ownerNote)
      ? '<div class="qrow-note"><strong>Note from our team:</strong> ' + EGC.esc(q.ownerNote) + '</div>'
      : '';

    /* ── REVISED QUOTE BANNER ── */
    var revisedHTML = '';
    if (q.status === 'revised_by_owner') {
      var priceRow = q.revisedPrice
        ? '<div class="rev-detail"><span>Revised Price</span><strong style="color:var(--amber);">₹' + EGC.esc(q.revisedPrice) + '</strong></div>'
        : '';
      revisedHTML = (
        '<div class="revised-banner" id="revbanner-' + q.quoteId + '">' +
          '<div class="revised-banner-header">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
            'Quote Revised by Owner' +
          '</div>' +
          (q.ownerComment ? '<div class="revised-comment">' + EGC.esc(q.ownerComment) + '</div>' : '') +
          '<div class="rev-details-grid">' +
            '<div class="rev-detail"><span>Pickup</span><strong>' + EGC.esc(q.pickup) + '</strong></div>' +
            '<div class="rev-detail"><span>Delivery</span><strong>' + EGC.esc(q.delivery) + '</strong></div>' +
            '<div class="rev-detail"><span>Weight</span><strong>' + EGC.esc(q.weight) + ' kg</strong></div>' +
            '<div class="rev-detail"><span>Packages</span><strong>' + EGC.esc(q.packages) + '</strong></div>' +
            (q.pickupDate ? '<div class="rev-detail"><span>Pickup Date</span><strong>' + EGC.fmtDate(q.pickupDate) + '</strong></div>' : '') +
            priceRow +
          '</div>' +
          '<div class="revised-actions">' +
            '<button class="btn-ok btn-sm" type="button" onclick="DASH.acceptRevision(\'' + q.quoteId + '\')">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Accept Revised Quote' +
            '</button>' +
            '<button class="btn-danger btn-sm" type="button" onclick="DASH.rejectRevision(\'' + q.quoteId + '\')">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Reject Revision' +
            '</button>' +
          '</div>' +
          '<div class="fst" id="revmsg-' + q.quoteId + '"></div>' +
        '</div>'
      );
    }

    var acceptedRow = (q.status === 'customer_accepted')
      ? '<div class="qrow-note" style="background:rgba(61,214,140,.06);border:1px solid rgba(61,214,140,.18);color:var(--green);border-radius:7px;padding:10px 14px;"><strong>✓ You accepted the revised quote.</strong> Owner is reviewing — order will be created shortly.</div>'
      : '';

    var rejectedRow = (q.status === 'customer_rejected')
      ? '<div class="qrow-note">You rejected the revised quote. This quote is now cancelled.</div>'
      : '';

    return (
      '<div class="qrow" style="grid-template-columns:1fr;">' +
        revisedHTML +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">' +
          '<div>' +
            '<div class="qrow-id">' + EGC.esc(q.quoteId) + '</div>' +
            '<div class="qrow-route">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>' +
              '<span>' + EGC.esc(q.pickup) + ' &rarr; ' + EGC.esc(q.delivery) + '</span>' +
            '</div>' +
            '<div class="qrow-meta"><span>' + EGC.esc(q.materialType || '') + '</span><span>' + EGC.fmtDate(q.pickupDate) + '</span></div>' +
          '</div>' +
          '<div class="qrow-right">' + badge + '<div class="qrow-date">' + EGC.fmtWhen(q.createdAt) + '</div></div>' +
        '</div>' +
        noteHTML + acceptedRow + rejectedRow +
      '</div>'
    );
  }

  /* ---------------------------------------------------------
     CUSTOMER: Accept revised quote
  --------------------------------------------------------- */
  window.DASH.acceptRevision = function (qid) {
    var msg = $('#revmsg-' + qid);
    fbDB.collection('quotes').doc(qid).update({
      status:    'customer_accepted',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      if (msg) { msg.className = 'fst ok'; msg.textContent = '✓ Revised quote accepted. Awaiting owner approval.'; }
    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not accept revision.'; }
    });
  };

  /* ---------------------------------------------------------
     CUSTOMER: Reject revised quote → cancelled
  --------------------------------------------------------- */
  window.DASH.rejectRevision = function (qid) {
    var msg = $('#revmsg-' + qid);
    fbDB.collection('quotes').doc(qid).update({
      status:    'customer_rejected',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      if (msg) { msg.className = 'fst ok'; msg.textContent = 'Revision rejected. Quote has been cancelled.'; }
    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not reject revision.'; }
    });
  };

  function loadQuotes(user) {
    var list = $('#quoteList');
    if (quotesUnsub) { quotesUnsub(); quotesUnsub = null; }
    quotesUnsub = fbDB.collection('quotes')
      .where('customerUid', '==', user.uid)
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        var quotes = [];
        var revisedCount = 0;
        snap.forEach(function (doc) {
          var d = doc.data();
          quotes.push(d);
          if (d.status === 'revised_by_owner') revisedCount++;
        });
        pushActivitySource('quotes', quotes);

        /* Show notification dot on Quotes tab if there's a pending revision */
        var quotesTab = document.querySelector('.dash-tab[data-tab="quotes"]');
        if (quotesTab) {
          var badge = quotesTab.querySelector('.tab-count') || document.createElement('span');
          if (revisedCount > 0) {
            badge.className = 'tab-count tab-count-alert';
            badge.textContent = '!';
            quotesTab.appendChild(badge);
          } else {
            badge.remove && badge.remove();
          }
        }

        if (!quotes.length) {
          if (list) list.innerHTML = (
            '<div class="empty">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
              '<p>No quotes submitted yet — create your first shipment request.</p>' +
              '<a href="#shipment" class="btn-ghost" data-tab-link="shipment">Request A Quote</a>' +
            '</div>'
          );
          return;
        }
        if (list) {
          list.innerHTML = quotes.map(quoteRowHTML).join('');
          rewireTabLinks();
        }
      }, function (err) {
        console.error('[DASH] quotes listener:', err.message);
        if (list) list.innerHTML = '<div class="empty"><p>Could not load quote history. Please refresh.</p></div>';
      });
  }

  /* ===========================================================
     PHASE 3 — MODULE 7/8: CUSTOMER ORDER HISTORY
  =========================================================== */
  var ordersUnsub = null;

  function orderRowHTML(o) {
    var badge = '<span class="st-badge ' + EGC.orderStatusClass(o.status) + '"><span class="st-dot"></span>' + EGC.orderStatusLabel(o.status) + '</span>';

    /* Timeline progress */
    var seq     = EGC.ORDER_STATUS_SEQUENCE;
    var curIdx  = seq.indexOf(o.status);
    var timelineHTML = (
      '<div class="order-timeline">' +
        seq.map(function (s, i) {
          var cls = i < curIdx ? 'tl-done' : (i === curIdx ? 'tl-active' : 'tl-future');
          return (
            '<div class="tl-step ' + cls + '">' +
              '<div class="tl-dot"></div>' +
              '<div class="tl-label">' + EGC.orderStatusLabel(s) + '</div>' +
            '</div>'
          );
        }).join('<div class="tl-line"></div>') +
      '</div>'
    );

    var priceRow = o.revisedPrice
      ? '<div class="qrow-meta" style="margin-top:6px;"><span style="color:var(--amber);">Agreed price: ₹' + EGC.esc(o.revisedPrice) + '</span></div>'
      : '';

    return (
      '<div class="qrow order-card" style="grid-template-columns:1fr;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">' +
          '<div>' +
            '<div class="qrow-id">' + EGC.esc(o.orderId) + '</div>' +
            '<div class="qrow-route">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>' +
              '<span>' + EGC.esc(o.pickup) + ' &rarr; ' + EGC.esc(o.delivery) + '</span>' +
            '</div>' +
            '<div class="qrow-meta"><span>' + EGC.esc(o.materialType || '') + '</span><span>' + EGC.fmtDate(o.pickupDate) + '</span></div>' +
            priceRow +
          '</div>' +
          '<div class="qrow-right">' + badge + '<div class="qrow-date">' + EGC.fmtWhen(o.createdAt) + '</div></div>' +
        '</div>' +
        timelineHTML +
      '</div>'
    );
  }

  function loadOrders(user) {
    var list = $('#orderList');
    if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
    ordersUnsub = fbDB.collection('orders')
      .where('customerUid', '==', user.uid)
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        var orders = [];
        snap.forEach(function (doc) { orders.push(doc.data()); });
        pushActivitySource('orders', orders);
        $('#ovShipments').textContent = String(orders.length);

        if (!orders.length) {
          if (list) list.innerHTML = (
            '<div class="empty">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1" y="6" width="14" height="10"/><path d="M15 9h4l3 3v4h-7"/></svg>' +
              '<p>No orders yet — approved quotes will turn into orders automatically.</p>' +
              '<a href="#shipment" class="btn-ghost" data-tab-link="shipment">Request A Quote</a>' +
            '</div>'
          );
          return;
        }
        if (list) {
          list.innerHTML = orders.map(orderRowHTML).join('');
          rewireTabLinks();
        }
      }, function (err) {
        console.error('[DASH] orders listener:', err.message);
        if (list) list.innerHTML = '<div class="empty"><p>Could not load order history. Please refresh.</p></div>';
      });
  }

  function rewireTabLinks() {
    $all('[data-tab-link]').forEach(function (a) {
      if (a._wired) return;
      a._wired = true;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var name = a.dataset.tabLink;
        openTab(name);
        history.replaceState(null, '', '#' + name);
        var panel = $('#panel-' + name);
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }
})();
