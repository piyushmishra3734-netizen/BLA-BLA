# Phase 3 — Setup & Deployment Guide
Express Goods Carrier — Quote Management & Order Creation

This phase adds real Firestore-backed quotes and orders on top of the
Phase 2 authentication system. Before it works, two things must be
deployed to your Firebase project (one-time setup):

---

## 1. Deploy Firestore Security Rules

1. Go to the [Firebase Console](https://console.firebase.google.com/) → your project (`good-dac5b`)
2. **Firestore Database** → **Rules** tab
3. Open `firestore.rules` from this delivery, copy the entire contents
4. Paste it into the console, replacing what's there
5. Click **Publish**

These rules are what actually enforce:
- Customers can only read their own quotes/orders
- Only `piyushmishra3734@gmail.com` can approve, reject, modify quotes, or create/update orders
- The owner dashboard is useless to anyone else even if they guess the URL — every read/write is blocked server-side, not just hidden in the UI

## 2. Deploy Firestore Indexes

The customer dashboard and owner dashboard both run combined
`where(...) + orderBy(...)` queries (e.g. "my quotes, newest first").
Firestore requires a composite index for these.

**Easiest method:** just use the app normally. The first time each
query runs, Firestore will throw an error in the browser console
containing a direct link like:
`https://console.firebase.google.com/project/.../firestore/indexes?create_composite=...`
Click it, click **Create Index**, wait 1–2 minutes, done.

**Or, upfront:** if you use the Firebase CLI, run:
```
firebase deploy --only firestore:indexes
```
using the `firestore.indexes.json` file included in this delivery.
Without the CLI, you can also recreate them manually in
**Firestore Database → Indexes → Composite** using the field
combinations listed in that file.

## 3. Files added/changed in Phase 3

| File | Status | Purpose |
|---|---|---|
| `phase3-core.js` | **new** | Shared logic: owner email check, status labels, sequential ID generator (`Q-2026-0001`, `EGC-2026-0001`), formatting helpers |
| `phase3.css` | **new** | Styling for quote/order cards, status badges, owner panels |
| `owner-dashboard.html` | **new** | Owner-only dashboard page |
| `owner-dashboard.js` | **new** | Pending quotes, approve/modify/reject, order status updates |
| `firestore.rules` | **new** | Security rules — deploy this (step 1 above) |
| `firestore.indexes.json` | **new** | Composite indexes — deploy this (step 2 above) |
| `dashboard.html` | edited | Real "New Shipment" form, "Quote History" tab, connected "Order History" tab |
| `dashboard.js` | edited | Quote submission, live quote/order listeners, merged activity feed |
| `auth.js` | edited | Account menu shows an "Owner Dashboard" link + "Owner" badge for the owner email only |
| `index.html` | edited | Loads `phase3-core.js` so the owner badge also works in the homepage nav |

## 4. How the Quote → Order flow works

1. **Customer** fills the shipment form on their dashboard → a doc is
   created at `quotes/{quoteId}` with `status: "pending_review"`.
2. **Owner** sees it appear instantly on the Owner Dashboard's
   "Pending Quotes" tab (real-time, no refresh needed).
3. Owner clicks **Approve** → in one atomic batch write:
   - A new `orders/{orderId}` document is created (`EGC-2026-0001` style ID)
   - The original quote is marked `status: "approved"` and linked to the order
4. **Modify** lets the owner correct pickup/delivery/weight/packages/notes
   before approving (or just save the edit without approving yet).
5. **Reject** marks the quote `status: "rejected"` with an optional note,
   which the customer sees on their Quote History tab.
6. The customer's **Order History** tab shows the live order status.
   Owner updates status manually via a dropdown
   (Approved → Truck Assigned → Loading → In Transit → Delivered) —
   this is the foundation Module 8 asked for; GPS/automated tracking is
   a later phase.

## 5. Owner access

Owner is identified purely by signing in with
**`piyushmishra3734@gmail.com`** (Google sign-in recommended — it
auto-verifies the email, which the rules check). No separate
"admin" flag or Firestore role document to maintain. If this email
ever needs to change, update it in two places:
- `firestore.rules` (`isOwner()` function)
- `phase3-core.js` (`OWNER_EMAIL` constant)

That's it — both customer-side and owner-side UI key off the same
constant, and the rules are the real gate.
