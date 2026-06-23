/* ============================================================
   OWNER-DASHBOARD.JS — Express Goods Carrier — Phase 3 (Upgraded)

   FIX: Pending quotes now correctly query status='pending_review'
        AND status='revised_by_owner' (awaiting customer response).
   NEW: Full Approve / Reject / Modify Quote workflow.
        Modify sends revised quote to customer for acceptance.
        Owner sees customer's response in real-time.
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
  var initialTab = (location.hash || '').replace('#', '');
  if (['pending', 'orders', 'allquotes'].indexOf(initialTab) !== -1) openTab(initialTab);

  /* ---------------------------------------------------------
     TOAST
  --------------------------------------------------------- */
  function toast(ok, text) {
    var host = $('#toastHost');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (ok ? 'ok' : 'bad');
    el.textContent = text;
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 320);
    }, 3200);
  }

  /* ---------------------------------------------------------
     MODULE 3 — OWNER ACCESS GUARD
  --------------------------------------------------------- */
  TOS.onReady(function (user) {
    var guard  = $('#guard');
    var denied = $('#denied');
    var main   = $('#dashMain');

    function showDenied() {
      if (guard)  guard.style.display = 'none';
      if (denied) denied.style.display = 'flex';
    }

    if (!user || !EGC.isOwnerEmail(user.email)) {
      showDenied();
      return;
    }

    if (guard) guard.classList.add('fade-out');
    if (main)  { main.style.display = 'block'; requestAnimationFrame(function () { main.classList.add('visible'); }); }
    setTimeout(function () { if (guard) guard.style.display = 'none'; }, 380);

    loadPendingQuotes();
    loadRevisedQuotes();
    loadOwnerOrders();
    loadAllQuotes();
  });

  /* ===========================================================
     MODULE 4 — PENDING QUOTES
     FIX: Query uses exact string 'pending_review' (EGC.QUOTE_STATUS.PENDING).
     This matches what customer dashboard writes on submitQuote().
     The composite index (status ASC, createdAt DESC) is in firestore.indexes.json.
  =========================================================== */
  var pendingUnsub = null;
  var revisedUnsub = null;
  var pendingCache = {};

  function pendingCardHTML(q) {
    var when = EGC.fmtWhen(q.createdAt);
    var customerAcceptedBadge = '';
    if (q.status === EGC.QUOTE_STATUS.CUSTOMER_ACCEPTED) {
      customerAcceptedBadge = '<div class="revision-banner revision-accepted"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg> Customer accepted the revised quote — approve to create order</div>';
    }

    var statusBadge = q.status === EGC.QUOTE_STATUS.PENDING
      ? '<span class="st-badge st-pending"><span class="st-dot"></span>Pending Review</span>'
      : '<span class="st-badge st-revised"><span class="st-dot"></span>Awaiting Customer</span>';

    return (
      '<div class="ocard" data-qid="' + q.quoteId + '">' +
        customerAcceptedBadge +
        '<div class="ocard-top">' +
          '<div><div class="ocard-id">' + EGC.esc(q.quoteId) + '</div><div class="ocard-when">' + when + '</div></div>' +
          statusBadge +
        '</div>' +
        '<div class="ocard-route">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>' +
          '<span>' + EGC.esc(q.pickup) + ' &rarr; ' + EGC.esc(q.delivery) + '</span>' +
        '</div>' +
        '<div class="ocard-grid">' +
          '<div class="ocard-field"><span>Customer</span><strong>' + EGC.esc(q.customerName) + '</strong></div>' +
          '<div class="ocard-field"><span>Company</span><strong>' + EGC.esc(q.companyName || '—') + '</strong></div>' +
          '<div class="ocard-field"><span>Weight</span><strong>' + EGC.esc(q.weight) + ' kg</strong></div>' +
          '<div class="ocard-field"><span>Packages</span><strong>' + EGC.esc(q.packages) + '</strong></div>' +
          '<div class="ocard-field"><span>Material</span><strong>' + EGC.esc(q.materialType) + '</strong></div>' +
          '<div class="ocard-field"><span>Pickup Date</span><strong>' + EGC.fmtDate(q.pickupDate) + '</strong></div>' +
          '<div class="ocard-field"><span>Phone</span><strong>' + EGC.esc(q.customerPhone || '—') + '</strong></div>' +
          '<div class="ocard-field"><span>Email</span><strong>' + EGC.esc(q.customerEmail || '—') + '</strong></div>' +
        '</div>' +
        (q.notes ? '<div class="ocard-notes"><strong>Notes:</strong> ' + EGC.esc(q.notes) + '</div>' : '') +
        (q.ownerComment ? '<div class="ocard-notes revision-comment"><strong>Your revision note:</strong> ' + EGC.esc(q.ownerComment) + '</div>' : '') +
        '<div class="ocard-actions">' +
          '<button class="btn-ok" type="button" onclick="OWN.approve(\'' + q.quoteId + '\')">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Approve' +
          '</button>' +
          (q.status === EGC.QUOTE_STATUS.PENDING ?
            '<button class="btn-modify" type="button" onclick="OWN.toggleModify(\'' + q.quoteId + '\')">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Send Revised Quote' +
            '</button>' : '') +
          '<button class="btn-danger" type="button" onclick="OWN.toggleReject(\'' + q.quoteId + '\')">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Reject' +
          '</button>' +
        '</div>' +

        /* MODIFY PANEL — sends revised quote to customer */
        '<div class="modify-panel" id="modify-' + q.quoteId + '">' +
          '<div class="modify-panel-header">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
            'Send Revised Quote to Customer' +
          '</div>' +
          '<div class="modify-grid">' +
            '<input type="text" id="mPickup-' + q.quoteId + '" value="' + EGC.esc(q.pickup) + '" placeholder="Pickup location">' +
            '<input type="text" id="mDelivery-' + q.quoteId + '" value="' + EGC.esc(q.delivery) + '" placeholder="Delivery location">' +
            '<input type="text" id="mWeight-' + q.quoteId + '" value="' + EGC.esc(q.weight) + '" placeholder="Weight (kg)">' +
            '<input type="text" id="mPackages-' + q.quoteId + '" value="' + EGC.esc(q.packages) + '" placeholder="Number of packages">' +
            '<input type="text" id="mPickupDate-' + q.quoteId + '" value="' + EGC.esc(q.pickupDate || '') + '" placeholder="Pickup date">' +
            '<input type="text" id="mPrice-' + q.quoteId + '" value="' + EGC.esc(q.revisedPrice || '') + '" placeholder="Revised price (₹) — optional">' +
          '</div>' +
          '<div class="sf-fd" style="margin-top:12px;">' +
            '<label style="font-family:\'IBM Plex Mono\';font-size:10px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:6px;">Note / explanation to customer</label>' +
            '<textarea id="mComment-' + q.quoteId + '" placeholder="e.g. Route adjusted for weight limit. Revised price reflects fuel surcharge.">' + EGC.esc(q.ownerComment || '') + '</textarea>' +
          '</div>' +
          '<div class="modify-notes"><textarea id="mNotes-' + q.quoteId + '" placeholder="Shipment notes (optional)">' + EGC.esc(q.notes || '') + '</textarea></div>' +
          '<div class="ocard-actions">' +
            '<button class="btn-ok btn-sm" type="button" onclick="OWN.sendRevision(\'' + q.quoteId + '\')">Send to Customer</button>' +
            '<button class="btn-ghost btn-sm" type="button" onclick="OWN.toggleModify(\'' + q.quoteId + '\')">Cancel</button>' +
          '</div>' +
        '</div>' +

        /* REJECT PANEL */
        '<div class="modify-panel" id="reject-' + q.quoteId + '">' +
          '<div class="modify-panel-header" style="color:#ff7070;">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            'Reject Quote' +
          '</div>' +
          '<div class="sf-fd"><label style="font-family:\'IBM Plex Mono\';font-size:10px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:6px;">Note to customer (optional)</label>' +
            '<textarea id="rNote-' + q.quoteId + '" placeholder="e.g. Route currently unavailable, please call us to discuss alternatives."></textarea>' +
          '</div>' +
          '<div class="ocard-actions">' +
            '<button class="btn-danger btn-sm" type="button" onclick="OWN.confirmReject(\'' + q.quoteId + '\')">Confirm Rejection</button>' +
            '<button class="btn-ghost btn-sm" type="button" onclick="OWN.toggleReject(\'' + q.quoteId + '\')">Cancel</button>' +
          '</div>' +
        '</div>' +

        '<div class="fst" id="qmsg-' + q.quoteId + '"></div>' +
      '</div>'
    );
  }

  /* ---------------------------------------------------------
     THE FIX: Use TWO real-time listeners:
     1. status == 'pending_review'  (new quotes)
     2. status == 'customer_accepted' (revised quotes customer accepted)
     These two together constitute "action required by owner".
     The "Awaiting Customer" bucket shows 'revised_by_owner' quotes.
  --------------------------------------------------------- */
  var pendingQuotesData = [];
  var revisedQuotesData = [];

  function mergePendingAndRevised() {
    var all = pendingQuotesData.concat(revisedQuotesData);
    // sort by createdAt desc
    all.sort(function (a, b) {
      var at = (a.createdAt && a.createdAt.toDate) ? a.createdAt.toDate().getTime() : 0;
      var bt = (b.createdAt && b.createdAt.toDate) ? b.createdAt.toDate().getTime() : 0;
      return bt - at;
    });

    var actionRequired = all.filter(function (q) {
      return q.status === EGC.QUOTE_STATUS.PENDING || q.status === EGC.QUOTE_STATUS.CUSTOMER_ACCEPTED;
    });
    var awaitingCustomer = all.filter(function (q) {
      return q.status === EGC.QUOTE_STATUS.REVISED;
    });

    var pendingCount = actionRequired.length;
    var revisedCount = awaitingCustomer.length;
    var totalCount   = pendingCount + revisedCount;

    var pendingEl = $('#statPending');
    var tabCountEl = $('#pendingTabCount');
    if (pendingEl) pendingEl.textContent = String(pendingCount);
    if (tabCountEl) tabCountEl.textContent = String(totalCount);

    renderPendingSection(actionRequired, 'actionList', pendingCount);
    renderPendingSection(awaitingCustomer, 'awaitingList', revisedCount);

    var awaitingHeader = $('#awaitingCustomerSection');
    if (awaitingHeader) awaitingHeader.style.display = revisedCount ? 'block' : 'none';
  }

  function renderPendingSection(quotes, listId, count) {
    var list = $('#' + listId);
    if (!list) return;
    if (!count) {
      if (listId === 'actionList') {
        list.innerHTML = (
          '<div class="empty">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
            '<p>No pending quotes. New customer requests will appear here instantly.</p>' +
          '</div>'
        );
      } else {
        list.innerHTML = '';
      }
      return;
    }
    list.innerHTML = quotes.map(pendingCardHTML).join('');
  }

  function loadPendingQuotes() {
    if (pendingUnsub) { pendingUnsub(); pendingUnsub = null; }

    /* LISTENER 1: fresh pending quotes from customers */
    pendingUnsub = fbDB.collection('quotes')
      .where('status', '==', 'pending_review')
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        pendingQuotesData = [];
        snap.forEach(function (doc) {
          var d = doc.data();
          pendingCache[d.quoteId] = d;
          pendingQuotesData.push(d);
        });
        mergePendingAndRevised();
      }, function (err) {
        console.error('[OWN] pending listener error:', err.code, err.message);
        var list = $('#actionList');
        if (list) list.innerHTML = (
          '<div class="empty"><p style="color:#ff7070;">⚠ Could not load pending quotes.<br><small style="font-family:\'IBM Plex Mono\';font-size:11px;">' + err.message + '</small></p>' +
          '<p style="margin-top:12px;font-size:13px;">Check Firestore indexes — ensure composite index on (status ASC, createdAt DESC) exists for the quotes collection.</p></div>'
        );
      });
  }

  function loadRevisedQuotes() {
    if (revisedUnsub) { revisedUnsub(); revisedUnsub = null; }

    /* LISTENER 2: revised quotes (awaiting customer OR customer accepted) */
    revisedUnsub = fbDB.collection('quotes')
      .where('status', 'in', ['revised_by_owner', 'customer_accepted'])
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        revisedQuotesData = [];
        snap.forEach(function (doc) {
          var d = doc.data();
          pendingCache[d.quoteId] = d;
          revisedQuotesData.push(d);
        });
        mergePendingAndRevised();
      }, function (err) {
        console.error('[OWN] revised listener error:', err.code, err.message);
      });
  }

  /* ---------------------------------------------------------
     TOGGLE PANELS
  --------------------------------------------------------- */
  window.OWN = window.OWN || {};

  window.OWN.toggleModify = function (qid) {
    var panel = $('#modify-' + qid);
    var rejectPanel = $('#reject-' + qid);
    if (rejectPanel) rejectPanel.classList.remove('open');
    if (panel) panel.classList.toggle('open');
  };

  window.OWN.toggleReject = function (qid) {
    var panel = $('#reject-' + qid);
    var modifyPanel = $('#modify-' + qid);
    if (modifyPanel) modifyPanel.classList.remove('open');
    if (panel) panel.classList.toggle('open');
  };

  /* ---------------------------------------------------------
     MODULE 5 — APPROVE (direct approve or after customer accepted)
  --------------------------------------------------------- */
  window.OWN.approve = function (qid) {
    var msg = $('#qmsg-' + qid);
    var q = pendingCache[qid];
    if (!q) { return; }

    EGC.nextOrderId().then(function (orderId) {
      var orderData = {
        orderId:       orderId,
        quoteId:       q.quoteId,
        customerUid:   q.customerUid,
        customerName:  q.customerName,
        customerEmail: q.customerEmail,
        customerPhone: q.customerPhone,
        companyName:   q.companyName,
        pickup:        q.pickup,
        delivery:      q.delivery,
        materialType:  q.materialType,
        weight:        q.weight,
        packages:      q.packages,
        pickupDate:    q.pickupDate,
        notes:         q.notes,
        revisedPrice:  q.revisedPrice || null,
        status:        EGC.ORDER_STATUS.APPROVED,
        createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
      };
      var batch = fbDB.batch();
      batch.set(fbDB.collection('orders').doc(orderId), orderData);
      batch.update(fbDB.collection('quotes').doc(qid), {
        status:    EGC.QUOTE_STATUS.APPROVED,
        orderId:   orderId,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return batch.commit().then(function () { return orderId; });
    }).then(function (orderId) {
      if (msg) { msg.className = 'fst ok'; msg.textContent = '✓ Approved — Order ' + orderId + ' created.'; }
      toast(true, q.quoteId + ' approved → ' + orderId);
    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not approve quote.'; }
      toast(false, 'Approval failed for ' + qid);
    });
  };

  /* ---------------------------------------------------------
     MODULE 6A — SEND REVISED QUOTE (new modify flow)
     Writes revised fields + ownerComment + status='revised_by_owner'
     Customer sees this in their dashboard and can accept/reject.
  --------------------------------------------------------- */
  window.OWN.sendRevision = function (qid) {
    var msg = $('#qmsg-' + qid);
    var pickup     = $('#mPickup-' + qid)   ? $('#mPickup-' + qid).value.trim()   : '';
    var delivery   = $('#mDelivery-' + qid) ? $('#mDelivery-' + qid).value.trim() : '';
    var weight     = $('#mWeight-' + qid)   ? $('#mWeight-' + qid).value.trim()   : '';
    var packages   = $('#mPackages-' + qid) ? $('#mPackages-' + qid).value.trim() : '';
    var pickupDate = $('#mPickupDate-' + qid)? $('#mPickupDate-' + qid).value.trim(): '';
    var price      = $('#mPrice-' + qid)    ? $('#mPrice-' + qid).value.trim()    : '';
    var comment    = $('#mComment-' + qid)  ? $('#mComment-' + qid).value.trim()  : '';
    var notes      = $('#mNotes-' + qid)    ? $('#mNotes-' + qid).value.trim()    : '';

    if (!pickup || !delivery) {
      if (msg) { msg.className = 'fst er'; msg.textContent = 'Pickup and delivery locations are required.'; }
      return;
    }

    var updates = {
      status:       'revised_by_owner',
      pickup:       pickup,
      delivery:     delivery,
      weight:       weight,
      packages:     packages,
      pickupDate:   pickupDate || null,
      revisedPrice: price || null,
      ownerComment: comment || null,
      notes:        notes || null,
      revisedAt:    firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
    };

    fbDB.collection('quotes').doc(qid).update(updates)
      .then(function () {
        var panel = $('#modify-' + qid);
        if (panel) panel.classList.remove('open');
        if (msg) { msg.className = 'fst ok'; msg.textContent = '✓ Revised quote sent to customer. Waiting for their response.'; }
        toast(true, qid + ' — revision sent to customer');
      })
      .catch(function (err) {
        if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not send revision.'; }
      });
  };

  /* ---------------------------------------------------------
     MODULE 6B — REJECTION
  --------------------------------------------------------- */
  window.OWN.confirmReject = function (qid) {
    var msg  = $('#qmsg-' + qid);
    var note = $('#rNote-' + qid) ? $('#rNote-' + qid).value.trim() || null : null;
    fbDB.collection('quotes').doc(qid).update({
      status:    EGC.QUOTE_STATUS.REJECTED,
      ownerNote: note,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      if (msg) { msg.className = 'fst ok'; msg.textContent = '✓ Quote rejected.'; }
      toast(true, qid + ' rejected.');
    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not reject quote.'; }
    });
  };

  /* ===========================================================
     MODULE 7 & 8 — ORDERS PANEL + STATUS UPDATES
  =========================================================== */
  var ordersUnsub = null;
  var ownerOrdersCache = [];
  var orderFilter = 'all';

  function statusOptionsHTML(current) {
    return EGC.ORDER_STATUS_SEQUENCE.map(function (s) {
      return '<option value="' + s + '"' + (s === current ? ' selected' : '') + '>' + EGC.orderStatusLabel(s) + '</option>';
    }).join('');
  }

  function ownerOrderCardHTML(o) {
    var badge = '<span class="st-badge ' + EGC.orderStatusClass(o.status) + '"><span class="st-dot"></span>' + EGC.orderStatusLabel(o.status) + '</span>';
    var priceRow = o.revisedPrice
      ? '<div class="ocard-field"><span>Revised Price</span><strong style="color:var(--amber);">₹' + EGC.esc(o.revisedPrice) + '</strong></div>'
      : '';
    return (
      '<div class="ocard">' +
        '<div class="ocard-top">' +
          '<div><div class="ocard-id">' + EGC.esc(o.orderId) + '</div><div class="ocard-when">' + EGC.fmtWhen(o.createdAt) + ' &middot; from ' + EGC.esc(o.quoteId || '') + '</div></div>' +
          badge +
        '</div>' +
        '<div class="ocard-route">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>' +
          '<span>' + EGC.esc(o.pickup) + ' &rarr; ' + EGC.esc(o.delivery) + '</span>' +
        '</div>' +
        '<div class="ocard-grid">' +
          '<div class="ocard-field"><span>Customer</span><strong>' + EGC.esc(o.customerName) + '</strong></div>' +
          '<div class="ocard-field"><span>Company</span><strong>' + EGC.esc(o.companyName || '—') + '</strong></div>' +
          '<div class="ocard-field"><span>Weight</span><strong>' + EGC.esc(o.weight) + ' kg</strong></div>' +
          '<div class="ocard-field"><span>Packages</span><strong>' + EGC.esc(o.packages) + '</strong></div>' +
          priceRow +
        '</div>' +
        '<div class="ocard-actions" style="align-items:center;">' +
          '<select class="ostatus-select" id="ostat-' + o.orderId + '" onchange="OWN.updateOrderStatus(\'' + o.orderId + '\')">' +
            statusOptionsHTML(o.status) +
          '</select>' +
        '</div>' +
        '<div class="fst" id="omsg-' + o.orderId + '"></div>' +
      '</div>'
    );
  }

  function renderOwnerOrders() {
    var list = $('#ownerOrderList');
    if (!list) return;
    var filtered = orderFilter === 'all'
      ? ownerOrdersCache
      : ownerOrdersCache.filter(function (o) { return o.status === orderFilter; });

    if (!filtered.length) {
      list.innerHTML = (
        '<div class="empty">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1" y="6" width="14" height="10"/><path d="M15 9h4l3 3v4h-7"/></svg>' +
          '<p>No orders ' + (orderFilter === 'all' ? 'yet' : 'with this status') + '.</p>' +
        '</div>'
      );
      return;
    }
    list.innerHTML = filtered.map(ownerOrderCardHTML).join('');
  }

  $all('#orderFilterChips .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $all('#orderFilterChips .chip').forEach(function (c) { c.classList.remove('on'); });
      chip.classList.add('on');
      orderFilter = chip.dataset.filter;
      renderOwnerOrders();
    });
  });

  function loadOwnerOrders() {
    if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
    ordersUnsub = fbDB.collection('orders')
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        var orders = [];
        snap.forEach(function (doc) { orders.push(doc.data()); });
        ownerOrdersCache = orders;

        var delivered = orders.filter(function (o) { return o.status === 'delivered'; }).length;
        var active    = orders.length - delivered;
        $('#statApproved').textContent  = String(orders.length);
        $('#statOrders').textContent    = String(active);
        $('#statDelivered').textContent = String(delivered);

        renderOwnerOrders();
      }, function (err) {
        console.error('[OWN] orders listener:', err.message);
      });
  }

  window.OWN.updateOrderStatus = function (orderId) {
    var sel = $('#ostat-' + orderId);
    var msg = $('#omsg-' + orderId);
    if (!sel) return;
    fbDB.collection('orders').doc(orderId).update({
      status:    sel.value,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      if (msg) { msg.className = 'fst ok'; msg.textContent = '✓ Status updated to ' + EGC.orderStatusLabel(sel.value) + '.'; }
      toast(true, orderId + ' → ' + EGC.orderStatusLabel(sel.value));
    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not update status.'; }
    });
  };

  /* ===========================================================
     ALL QUOTES — full history
  =========================================================== */
  var allQuotesUnsub = null;

  function allQuoteRowHTML(q) {
    var badge = '<span class="st-badge ' + EGC.quoteStatusClass(q.status) + '"><span class="st-dot"></span>' + EGC.quoteStatusLabel(q.status) + '</span>';
    var revisionRow = q.revisedPrice
      ? '<div class="qrow-meta" style="margin-top:4px;"><span style="color:var(--amber);">₹' + EGC.esc(q.revisedPrice) + ' revised</span></div>'
      : '';
    return (
      '<div class="qrow" style="grid-template-columns:1fr;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">' +
          '<div>' +
            '<div class="qrow-id">' + EGC.esc(q.quoteId) + '</div>' +
            '<div class="qrow-route">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>' +
              '<span>' + EGC.esc(q.pickup) + ' &rarr; ' + EGC.esc(q.delivery) + '</span>' +
            '</div>' +
            '<div class="qrow-meta"><span>' + EGC.esc(q.customerName) + '</span><span>' + EGC.esc(q.companyName || '') + '</span></div>' +
            revisionRow +
          '</div>' +
          '<div class="qrow-right">' + badge + '<div class="qrow-date">' + EGC.fmtWhen(q.createdAt) + '</div></div>' +
        '</div>' +
      '</div>'
    );
  }

  function loadAllQuotes() {
    var list = $('#allQuotesList');
    if (allQuotesUnsub) { allQuotesUnsub(); allQuotesUnsub = null; }
    allQuotesUnsub = fbDB.collection('quotes')
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        var quotes = [];
        snap.forEach(function (doc) { quotes.push(doc.data()); });
        if (!quotes.length) {
          if (list) list.innerHTML = '<div class="empty"><p>No quotes submitted yet.</p></div>';
          return;
        }
        if (list) list.innerHTML = quotes.map(allQuoteRowHTML).join('');
      }, function (err) {
        console.error('[OWN] all-quotes listener:', err.message);
      });
  }

})();
