/* ============================================================
   OWNER-DASHBOARD.JS — Express Goods Carrier — Phase 3
   Modules 3–8: owner-only access, pending quotes panel,
   approve/modify/reject flow, order creation, order status.
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
     MODULE 3 — OWNER-ONLY ACCESS GUARD
     Firestore rules are the real enforcement; this guard just
     decides what to render so non-owners never see the UI or
     fire reads that would be denied anyway.
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
    loadOwnerOrders();
    loadAllQuotes();
  });

  /* ===========================================================
     MODULE 4 & 5 & 6 — PENDING QUOTES, APPROVE / MODIFY / REJECT
  =========================================================== */
  var pendingUnsub = null;
  var pendingCache = {}; // quoteId -> latest data, used by inline modify form

  function pendingCardHTML(q) {
    var when = EGC.fmtWhen(q.createdAt);
    return (
      '<div class="ocard" data-qid="' + q.quoteId + '">' +
        '<div class="ocard-top">' +
          '<div><div class="ocard-id">' + EGC.esc(q.quoteId) + '</div><div class="ocard-when">' + when + '</div></div>' +
          '<span class="st-badge st-pending"><span class="st-dot"></span>Pending Review</span>' +
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
        '<div class="ocard-actions">' +
          '<button class="btn-ok" type="button" onclick="OWN.approve(\'' + q.quoteId + '\')">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Approve' +
          '</button>' +
          '<button class="btn-modify" type="button" onclick="OWN.toggleModify(\'' + q.quoteId + '\')">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Modify' +
          '</button>' +
          '<button class="btn-danger" type="button" onclick="OWN.toggleReject(\'' + q.quoteId + '\')">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Reject' +
          '</button>' +
        '</div>' +
        '<div class="modify-panel" id="modify-' + q.quoteId + '">' +
          '<div class="modify-grid">' +
            '<input type="text" id="mPickup-' + q.quoteId + '" value="' + EGC.esc(q.pickup) + '" placeholder="Pickup location">' +
            '<input type="text" id="mDelivery-' + q.quoteId + '" value="' + EGC.esc(q.delivery) + '" placeholder="Delivery location">' +
            '<input type="text" id="mWeight-' + q.quoteId + '" value="' + EGC.esc(q.weight) + '" placeholder="Weight (kg)">' +
            '<input type="text" id="mPackages-' + q.quoteId + '" value="' + EGC.esc(q.packages) + '" placeholder="Number of packages">' +
            '<textarea id="mNotes-' + q.quoteId + '" placeholder="Notes">' + EGC.esc(q.notes || '') + '</textarea>' +
          '</div>' +
          '<div class="ocard-actions">' +
            '<button class="btn-ok btn-sm" type="button" onclick="OWN.saveModifyAndApprove(\'' + q.quoteId + '\')">Save &amp; Approve</button>' +
            '<button class="btn-ghost btn-sm" type="button" onclick="OWN.saveModifyOnly(\'' + q.quoteId + '\')">Save Changes</button>' +
          '</div>' +
        '</div>' +
        '<div class="modify-panel" id="reject-' + q.quoteId + '">' +
          '<div class="sf-fd"><label style="font-family:\'IBM Plex Mono\';font-size:10px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:6px;">Note to customer (optional)</label>' +
            '<textarea id="rNote-' + q.quoteId + '" placeholder="e.g. Route currently unavailable, please call us to discuss alternatives."></textarea>' +
          '</div>' +
          '<button class="btn-danger btn-sm" type="button" onclick="OWN.confirmReject(\'' + q.quoteId + '\')">Confirm Rejection</button>' +
        '</div>' +
        '<div class="fst" id="qmsg-' + q.quoteId + '"></div>' +
      '</div>'
    );
  }

  function loadPendingQuotes() {
    var list = $('#pendingList');
    if (pendingUnsub) { pendingUnsub(); pendingUnsub = null; }
    pendingUnsub = fbDB.collection('quotes')
      .where('status', '==', EGC.QUOTE_STATUS.PENDING)
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        var quotes = [];
        snap.forEach(function (doc) {
          var d = doc.data();
          pendingCache[d.quoteId] = d;
          quotes.push(d);
        });

        $('#statPending').textContent = String(quotes.length);
        $('#pendingTabCount').textContent = String(quotes.length);

        if (!quotes.length) {
          if (list) list.innerHTML = (
            '<div class="empty">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
              '<p>No quotes submitted yet. New customer requests will appear here.</p>' +
            '</div>'
          );
          return;
        }
        if (list) list.innerHTML = quotes.map(pendingCardHTML).join('');
      }, function (err) {
        console.error('[OWN] pending listener:', err.message);
        if (list) list.innerHTML = '<div class="empty"><p>Could not load pending quotes. Please refresh.</p></div>';
      });
  }

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

  function readModifyFields(qid) {
    return {
      pickup:   $('#mPickup-' + qid).value.trim(),
      delivery: $('#mDelivery-' + qid).value.trim(),
      weight:   $('#mWeight-' + qid).value.trim(),
      packages: $('#mPackages-' + qid).value.trim(),
      notes:    $('#mNotes-' + qid).value.trim() || null
    };
  }

  window.OWN.saveModifyOnly = function (qid) {
    var msg = $('#qmsg-' + qid);
    var updates = readModifyFields(qid);
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    fbDB.collection('quotes').doc(qid).update(updates).then(function () {
      msg.className = 'fst ok'; msg.textContent = '✓ Changes saved.';
      toast(true, qid + ' updated.');
    }).catch(function (err) {
      msg.className = 'fst er'; msg.textContent = err.message || 'Could not save changes.';
    });
  };

  window.OWN.saveModifyAndApprove = function (qid) {
    var updates = readModifyFields(qid);
    fbDB.collection('quotes').doc(qid).update(
      Object.assign({}, updates, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
    ).then(function () {
      return approveQuote(qid, updates);
    }).catch(function (err) {
      var msg = $('#qmsg-' + qid);
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not approve.'; }
    });
  };

  /* ---------------------------------------------------------
     MODULE 5 — APPROVAL → creates Order, updates Quote
  --------------------------------------------------------- */
  window.OWN.approve = function (qid) { approveQuote(qid, null); };

  function approveQuote(qid, overrides) {
    var msg = $('#qmsg-' + qid);
    var q = pendingCache[qid];
    if (!q) { return Promise.resolve(); }
    var merged = Object.assign({}, q, overrides || {});

    return EGC.nextOrderId().then(function (orderId) {
      var orderData = {
        orderId:       orderId,
        quoteId:       q.quoteId,
        customerUid:   q.customerUid,
        customerName:  merged.customerName,
        customerEmail: merged.customerEmail,
        customerPhone: merged.customerPhone,
        companyName:   merged.companyName,
        pickup:        merged.pickup,
        delivery:      merged.delivery,
        materialType:  merged.materialType,
        weight:        merged.weight,
        packages:      merged.packages,
        pickupDate:    merged.pickupDate,
        notes:         merged.notes,
        status:        EGC.ORDER_STATUS.APPROVED,
        createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
      };
      var batch = fbDB.batch();
      batch.set(fbDB.collection('orders').doc(orderId), orderData);
      batch.update(fbDB.collection('quotes').doc(qid), {
        status: EGC.QUOTE_STATUS.APPROVED,
        orderId: orderId,
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
  }

  /* ---------------------------------------------------------
     MODULE 6 — REJECTION (with optional note)
  --------------------------------------------------------- */
  window.OWN.confirmReject = function (qid) {
    var msg = $('#qmsg-' + qid);
    var note = $('#rNote-' + qid).value.trim() || null;
    fbDB.collection('quotes').doc(qid).update({
      status: EGC.QUOTE_STATUS.REJECTED,
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
        var active = orders.length - delivered;
        $('#statApproved').textContent = String(orders.length);
        $('#statOrders').textContent = String(active);
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
      status: sel.value,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      if (msg) { msg.className = 'fst ok'; msg.textContent = '✓ Status updated to ' + EGC.orderStatusLabel(sel.value) + '.'; }
      toast(true, orderId + ' → ' + EGC.orderStatusLabel(sel.value));
    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not update status.'; }
    });
  };

  /* ===========================================================
     ALL QUOTES — full history (pending + approved + rejected)
  =========================================================== */
  var allQuotesUnsub = null;

  function allQuoteRowHTML(q) {
    var badge = '<span class="st-badge ' + EGC.quoteStatusClass(q.status) + '"><span class="st-dot"></span>' + EGC.quoteStatusLabel(q.status) + '</span>';
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
