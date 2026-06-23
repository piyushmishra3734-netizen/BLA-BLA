/* ============================================================
   PHASE3-CORE.JS — Shared Quote/Order logic
   Express Goods Carrier — Phase 3 (Upgraded)

   Used by BOTH dashboard.js (customer) and owner-dashboard.js
   (owner). Single source of truth for statuses, labels, IDs.
   ============================================================ */

(function () {
  'use strict';

  window.EGC = window.EGC || {};

  /* ---------------------------------------------------------
     OWNER IDENTITY
  --------------------------------------------------------- */
  var OWNER_EMAIL = 'piyushmishra3734@gmail.com';
  window.EGC.OWNER_EMAIL = OWNER_EMAIL;
  window.EGC.isOwnerEmail = function (email) {
    return !!email && email.toLowerCase() === OWNER_EMAIL.toLowerCase();
  };

  /* ---------------------------------------------------------
     STATUS DEFINITIONS — Full Workflow
     Quote lifecycle:
       pending_review → approved  (owner direct approve)
       pending_review → revised_by_owner → customer_accepted → [order created]
       pending_review → revised_by_owner → customer_rejected → cancelled
       pending_review → rejected
  --------------------------------------------------------- */
  window.EGC.QUOTE_STATUS = {
    PENDING:           'pending_review',
    REVISED:           'revised_by_owner',
    CUSTOMER_ACCEPTED: 'customer_accepted',
    CUSTOMER_REJECTED: 'customer_rejected',
    APPROVED:          'approved',
    REJECTED:          'rejected',
    CANCELLED:         'cancelled'
  };

  window.EGC.ORDER_STATUS = {
    APPROVED:       'approved',
    TRUCK_ASSIGNED: 'truck_assigned',
    LOADING:        'loading',
    IN_TRANSIT:     'in_transit',
    DELIVERED:      'delivered'
  };

  window.EGC.ORDER_STATUS_SEQUENCE = [
    'approved', 'truck_assigned', 'loading', 'in_transit', 'delivered'
  ];

  var QUOTE_LABELS = {
    pending_review:    'Pending Review',
    revised_by_owner:  'Revised by Owner',
    customer_accepted: 'Customer Accepted',
    customer_rejected: 'Customer Rejected',
    approved:          'Approved',
    rejected:          'Rejected',
    cancelled:         'Cancelled'
  };

  var ORDER_LABELS = {
    approved:       'Approved',
    truck_assigned: 'Truck Assigned',
    loading:        'Loading',
    in_transit:     'In Transit',
    delivered:      'Delivered'
  };

  window.EGC.quoteStatusLabel = function (s) { return QUOTE_LABELS[s] || s; };
  window.EGC.orderStatusLabel = function (s) { return ORDER_LABELS[s] || s; };

  window.EGC.quoteStatusClass = function (s) {
    if (s === 'approved' || s === 'customer_accepted') return 'st-ok';
    if (s === 'rejected' || s === 'customer_rejected' || s === 'cancelled') return 'st-bad';
    if (s === 'revised_by_owner') return 'st-revised';
    return 'st-pending';
  };

  window.EGC.orderStatusClass = function (s) {
    if (s === 'delivered') return 'st-ok';
    if (s === 'in_transit' || s === 'loading' || s === 'truck_assigned') return 'st-progress';
    return 'st-pending';
  };

  /* ---------------------------------------------------------
     SEQUENTIAL ID GENERATION
  --------------------------------------------------------- */
  function pad4(n) { return ('0000' + n).slice(-4); }

  function nextSequentialId(counterName, prefix) {
    var year = new Date().getFullYear();
    var ref = fbDB.collection('counters').doc(counterName);
    return fbDB.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var data = snap.exists ? snap.data() : null;
        var seq = 1;
        if (data && data.year === year) {
          seq = (data.lastSeq || 0) + 1;
        }
        tx.set(ref, { year: year, lastSeq: seq }, { merge: true });
        return prefix + '-' + year + '-' + pad4(seq);
      });
    });
  }

  window.EGC.nextQuoteId = function () { return nextSequentialId('quotes', 'Q'); };
  window.EGC.nextOrderId = function () { return nextSequentialId('orders', 'EGC'); };

  /* ---------------------------------------------------------
     FORMATTING HELPERS
  --------------------------------------------------------- */
  window.EGC.fmtDate = function (val) {
    if (!val) return '—';
    var d;
    if (val.toDate) d = val.toDate();
    else if (val instanceof Date) d = val;
    else d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  window.EGC.fmtWhen = function (ts) {
    if (!ts || !ts.toDate) return 'Just now';
    var diff = Date.now() - ts.toDate().getTime();
    var mins = Math.round(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' hr' + (hrs > 1 ? 's' : '') + ' ago';
    var days = Math.round(hrs / 24);
    return days + ' day' + (days > 1 ? 's' : '') + ' ago';
  };

  window.EGC.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

})();
