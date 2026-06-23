/* ============================================================
   DASHBOARD.JS — Customer Dashboard Foundation (Phase 2)
   Guards the page, wires tabs, and handles the functional
   sections (Profile, Favorite Routes, Overview, Activity).
   New Shipment / Order History / Support are placeholders
   for future phases.
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
  // Overview-card shortcuts (e.g. "Complete profile →", "Manage routes →")
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
  // deep-link support: dashboard.html#routes, #profile etc.
  var initialTab = (location.hash || '').replace('#', '');
  if (['shipment', 'history', 'routes', 'profile', 'support'].indexOf(initialTab) !== -1) {
    openTab(initialTab);
  }

  /* ---------------------------------------------------------
     AUTH GUARD — wait for TOS to resolve auth state
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

    /* Independent sections load in parallel — nothing blocks anything else */
    fillProfileForm(user, profile);
    renderCompletion(user, profile);
    loadRoutes(user, profile);
  });

  /* ---------------------------------------------------------
     PROFILE COMPLETION (overview ring + in-tab checklist)
  --------------------------------------------------------- */
  var ICO_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  var ICO_CIRCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';

  function renderCompletion(user, profile) {
    var info = TOS.profileCompletion(profile, user);
    var pct  = info.pct;

    /* Overview card ring */
    var ovRing = $('#ovRing'), ovPct = $('#ovPct'), ovCard = $('#ovProfileCard'), ovLink = $('#ovProfileLink');
    if (ovRing) ovRing.style.setProperty('--pct', pct);
    if (ovPct)  ovPct.textContent = pct + '%';
    if (pct >= 100) {
      if (ovRing) ovRing.classList.add('complete');
      if (ovCard) ovCard.classList.add('complete-card');
      if (ovLink) ovLink.textContent = 'Profile complete ✓';
    }

    /* In-tab checklist */
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
      $('#pCompany').value = profile.companyName || '';
      $('#pContact').value = profile.contactPerson || '';
      $('#pMobile').value = profile.mobile || '';
      $('#pGst').value = profile.gstNumber || '';
    }
  }

  window.DASH = window.DASH || {};
  window.DASH.saveProfile = function (e) {
    e.preventDefault();
    var msg = $('#profileMsg');
    var data = {
      companyName: $('#pCompany').value.trim(),
      contactPerson: $('#pContact').value.trim(),
      mobile: $('#pMobile').value.trim(),
      gstNumber: $('#pGst').value.trim() || null,
      onboardingComplete: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
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
     Stored at customerProfiles/{uid}/savedRoutes/{routeId}
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
        renderActivity([]);
        return;
      }
      var html = '';
      var routes = [];
      snap.forEach(function (doc) {
        var d = doc.data();
        html += routeRowHTML(doc.id, d.pickup, d.delivery);
        routes.push(d);
      });
      list.innerHTML = html;
      $('#ovRoutes').textContent = String(snap.size);
      renderActivity(routes);
    }).catch(function () {
      $('#ovRoutes').textContent = '0';
    });
  }

  window.DASH.addRoute = function () {
    var pickup = $('#rPickup').value.trim();
    var delivery = $('#rDelivery').value.trim();
    var msg = $('#routeMsg');
    if (!pickup || !delivery) {
      msg.className = 'fst er'; msg.textContent = 'Enter both pickup and delivery locations.';
      return;
    }
    routesRef().add({
      pickup: pickup,
      delivery: delivery,
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
     RECENT ACTIVITY — derived from saved routes for now;
     shipment events will feed this in a future phase.
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

  function renderActivity(routes) {
    var list = $('#activityList');
    if (!list) return;
    if (!routes.length) {
      list.innerHTML = '<div class="empty" style="padding:24px 0;"><p>No recent activity yet — saved routes and shipment updates will show up here.</p></div>';
      return;
    }
    list.innerHTML = routes.slice(0, 5).map(function (r) {
      return (
        '<div class="activity-row">' +
          '<div class="activity-ico">' + ICO_ROUTE + '</div>' +
          '<div><div class="activity-txt">Saved route: ' + r.pickup + ' &rarr; ' + r.delivery + '</div>' +
          '<div class="activity-time">' + relTime(r.createdAt) + '</div></div>' +
        '</div>'
      );
    }).join('');
  }
})();
