# ABSL Helpdesk — Full Acceptance Test

A scripted pass through the whole product. Every check states the result you
must actually see, so "it seemed fine" is never the answer. Tick a box only
when you have seen that result with your own eyes.

**Time:** about 60 minutes.
**Prerequisite:** migrations 0001–0004 all applied. Run `supabase/diagnose.sql`
— section 1 must show a **1 in every `m0004_` column** before you start.

---

## Setup A — Fresh database

Run `supabase/reset_for_testing.sql`. It refuses to do anything until you
change `v_i_am_sure := false` to `true`, and it tells you what it is about to
delete. It wipes all accounts, tickets and files, keeps the schema and the
company, and resets stock and ticket numbering.

The final query must show `accounts 0, profiles 0, tickets 0` and
`inventory_items 3`.

## Setup B — The cast

| Role | Email | Company to type at signup | Register as |
|---|---|---|---|
| Customer | `chenitharanasinghe@gmail.com` | **Cargills Food City TEST** | Customer |
| Admin / CEO | `info@chenitha.net` | Automated Barcode Solutions Pvt Ltd | Customer |
| Technician | `dilumperera33@gmail.com` | Automated Barcode Solutions Pvt Ltd | **Technician** |
| Technician B *(optional)* | `chenitharanasinghe+tech2@gmail.com` | Automated Barcode Solutions Pvt Ltd | Customer |

Register all of them at `register.html` and verify each email.

Three things to know about this cast:

- **The admin doubles as the agent.** An admin can open all four portals, so
  everywhere this plan says "as Agent", use the admin account on the Agent Desk.
- **The technician registers as a technician on purpose.** That account starts
  as a pending customer, which is exactly what tests 4–7 need. You approve it
  properly in test 8.
- **Technician B is optional** and only needed for the hand-over test (36).
  It is the same inbox as the customer — Gmail ignores everything after a `+`.

After registering, run `supabase/promote_test_accounts.sql` to make
`info@chenitha.net` an admin. Leave the technician out of it — test 8 grants
that role through the admin screen, which is the flow you want to prove works.

> `info@chenitha.net` was the old demo technician account with a leaked
> password. The reset deletes it, so registering now gives it a fresh password
> you choose. Do the same for anything else that was in that seed file.

## Setup C — Three browser windows at once

A login lives in browser storage, so one browser holds one account. Tests
26–28 need two staff sessions open together.

| Window | Account |
|---|---|
| Chrome, normal | Admin (also used as the Agent) |
| Chrome, incognito | Technician |
| Edge or Firefox | Customer |

---

## Part 1 — Identity and access · Diagrams 1–4

- [ ] **1.** Register the customer with company **Cargills Food City TEST**.
      → Modal confirms a verification email was sent, and a real email arrives.
- [ ] **2.** Try to sign in before clicking the link.
      → Refused: *"Please open the verification email we sent before signing in."*
- [ ] **3.** Verify, then sign in.
      → **Customer Portal**, teal accent, your name and role badge top-right.
- [ ] **4.** Register the technician account choosing **Technician / Field Staff**, verify it, sign in.
      → *"Waiting for admin approval."* No dashboard.
- [ ] **5.** In that pending account's console (F12), run:
      ```js
      await supabaseClient.from("tickets").select("id, title")
      ```
      → **Empty array.** 🔒 Launch blocker if any ticket comes back.
- [ ] **6.** Same console:
      ```js
      await supabaseClient.from("profiles").update({ role: "admin", approval_status: "approved" }).eq("id", currentUser.id).select()
      ```
      → Error containing *"You may not change your own role"*. 🔒 Launch blocker if a row returns.
- [ ] **7.** In SQL, check what that signup actually created:
      ```sql
      select p.email, p.role, p.approval_status, ar.requested_role
      from public.profiles p left join public.approval_requests ar on ar.profile_id = p.id
      order by p.created_at desc limit 3;
      ```
      → `role = customer`, `approval_status = pending`, `requested_role = technician`. 🔒
- [ ] **8.** Sign in as Admin → **CEO Console** → **User Approvals**.
      → The technician's request is listed with a `requests: technician` badge.
      Press **Approve as technician**. That account can now reach the Field App.
- [ ] **9.** As Admin, check the nav: all four portals, purple accent, **CEO Console** heading.
      As Customer, check the nav: **only Customer**. No Agent, Technician or CEO tab.

## Part 2 — Raising a ticket · Diagrams 5, 9, 11

As **Customer**.

- [ ] **10.** On the ticket form, your name and **Cargills Food City TEST** appear as
      read-only text at the top — not as editable boxes.
- [ ] **11.** Attach a file larger than 8 MB as the photo.
      → Refused *before uploading*, naming the actual size.
- [ ] **12.** Press **🎙 Record**, speak five seconds, press **⏹ Stop**.
      → Button reads "Record again", status shows the size. **No rejection message.**
- [ ] **13.** Press **📍 Use my location** and allow the prompt.
      → *"Location captured (±N m)"*.
- [ ] **14.** Tick **Need phone callback?**
      → A phone field appears. Enter `0771234567`.
- [ ] **15.** Fill in title and description, attach a photo, submit.
      → Toast with a real number (`ABSL-2026-000001`), form clears, ticket in **My Tickets**.
- [ ] **16.** Submit another ticket with a one-character title.
      → Refused before it reaches the database.
- [ ] **17.** Check the inbox for a *"Ticket created"* email.
      → Arrives — once the worker is running (Part 7). Until then it sits in the queue.

## Part 3 — The agent's work · Diagrams 6, 7, 10

As **Admin**, on the **Agent Desk**.

- [ ] **18.** Open the Agent Desk.
      → The ticket shows the **customer's real name and "Cargills Food City TEST"** —
      not the literal words "Customer" and "Company".
- [ ] **19.** Type part of the ticket number into the search box.
      → Filters as you type, and **the cursor stays in the box**.
- [ ] **20.** Set the status filter to *Closed*, then back to *All statuses*.
      → The ticket disappears, then returns.
- [ ] **21.** Click **Open**.
      → The photo is a thumbnail and opens full size when clicked. The voice note has
      a player and **audibly plays**.
- [ ] **22.** Check the **Callback Queue** panel.
      → Listed with the phone number and how long it has been waiting.
- [ ] **23.** Press **Call**.
      → The dialler opens, or the browser offers to.
- [ ] **24.** Press **Done**, confirm.
      → It leaves the queue and *"Callback completed by phone."* appears on the thread.
- [ ] **25.** Write a reply and send.
      → Appears with **your real name and role**, not "Team member". The customer's
      window updates **without a refresh**.

## Part 4 — Two people, one ticket · Diagram 18

Admin and Technician windows both open on the same ticket. Assign the ticket
to the technician first (test 29) if the status buttons are not offered.

- [ ] **26.** In the **Technician** window, set the status to **In Progress**.
      Do not touch the Admin window.
- [ ] **27.** In the **Admin** window — still showing the stale version — press **Resolved**.
      → Modal **"Someone got there first"**, naming the *current* status (In Progress).
      It must **not** say "Refresh & Overwrite".
- [ ] **28.** Press **Keep their change**.
      → Nothing is overwritten. Status stays In Progress.

## Part 5 — Field work · Diagrams 12, 13

- [ ] **29.** As Admin, on the ticket → right panel → **Technician** → select the
      technician → **Assign**.
      → A note appears on the thread; the technician receives an email.
- [ ] **30.** As **Technician** → **Technician Field App**.
      → Heading **My Jobs**, and only this ticket listed.
- [ ] **31.** As **Customer**, open the console and run the tickets query from test 5.
      → Only their own ticket. Never anyone else's. 🔒
- [ ] **32.** As Technician, open the job and press **Work** on a part.
      → Confirmation naming the part and the resulting stock level. Accept.
- [ ] **33.** After confirming.
      → Stock drops by exactly 1, and the part appears under **Parts used**.
- [ ] **34.** Press **Work** repeatedly until that part reaches its reorder level.
      → A **Low stock** alert appears in the CEO Console alerts panel.
- [ ] **35.** With no job open, or on a job assigned to someone else, press **Work**.
      → Refused: *"You can only take parts against a job assigned to you."*
- [ ] **36.** *(Needs Technician B.)* Select Technician B, reason *"fully booked today"*,
      press **Reassign**.
      → Thread shows *"Job handed over from … to …. Reason: fully booked today"*,
      and the job moves out of A's list into B's.

## Part 6 — Closing out and admin · Diagrams 8, 15

- [ ] **37.** As Admin, move the ticket **In Progress → Resolved → Closed**.
      → The customer gets an email at each change.
- [ ] **38.** Open the **History** panel on the ticket.
      → Every change listed with **who** and **when**.
- [ ] **39.** As Customer, open the closed ticket.
      → No Assign panel, no Delete button, and no status buttons beyond what a
      customer may do.
- [ ] **40.** As Admin, delete a ticket → it disappears. Check the Agent Desk as a
      non-admin — Delete is not offered at all.
- [ ] **41.** As Admin → **Company Limit** → select **Cargills Food City TEST** → set to 2 → update.
      → Success, and the displayed limit changes.
- [ ] **42.** Register a third account on Cargills Food City TEST, exceeding the limit.
      → Refused: *"Your company has used all of its accounts…"*
- [ ] **43.** Reject a pending registration from the approvals panel.
      → It leaves the pending list and that account cannot sign in to a dashboard.

## Part 7 — Notifications · Diagrams 14, 19

- [ ] **44.** Deploy the worker and run it, then check the queue:
      ```sql
      select status, count(*) from public.notifications group by status;
      ```
      → Everything `sent`. Anything stuck in `retry` usually means the Resend domain
      is not verified.
- [ ] **45.** Confirm the emails actually arrived: ticket created, status changed,
      reply received, technician assigned.
- [ ] **46.** Set a deliberately wrong `RESEND_API_KEY`, create a ticket, run the worker
      five times.
      → The notification reaches `dead_letter` and a **critical alert** appears in the
      CEO Console. Restore the real key afterwards.

## Part 8 — Only breaks in production

Do these on the **deployed** site, not localhost.

- [ ] **47.** Open the console on the live site.
      → No **Content-Security-Policy** errors. This cannot be caught locally —
      `npx serve` ignores `_headers`, Netlify applies it.
- [ ] **48.** Open the live site on a real phone.
      → Everything reachable, nothing scrolls sideways, Record and location both work.
- [ ] **49.** Visit `https://your-site/supabase/migrations/0001_initial_schema.sql`.
      → **404.** If the SQL loads you deployed the project folder instead of `dist/`. 🔒
- [ ] **50.** Sign out, then DevTools → Application → Local Storage.
      → No ticket titles, customer names or comment text left behind. 🔒

## Part 9 — Service call evidence, reports and staff-review emails

Everything below was added after the original nineteen diagrams. Needs
migrations 0007–0016 applied — run `supabase/diagnose.sql` and check every
`m0007`–`m0016` column reads `1`/`true` first.

- [ ] **51.** As Technician, open a job assigned to you and press **Resolved**
      without filling in the service call number or choosing a photo.
      → The form refuses to submit until both are provided — no way to mark
      the job resolved without them.
- [ ] **52.** As Admin, resolve a *different* ticket directly from the **Agent
      Desk** (not the Technician Field App).
      → The same evidence form appears. Service call number and photo are
      required for **every** role that resolves a ticket, not technicians only.
- [ ] **53.** As Customer, open the ticket resolved in test 52.
      → The service call number and the technician's resolution notes are
      both shown in plain text on your copy of the ticket.
- [ ] **54.** As Admin → **CEO Console** → **Receipts**, open the receipt for
      that same ticket.
      → Shows the service call number and resolution notes, and the receipt
      photo itself opens full size.
- [ ] **55.** As Customer, start a new ticket.
      → No **Photo** upload field on the create-ticket form. Voice note and
      location capture are still there.
- [ ] **56.** On a resolved ticket, as the technician who resolved it or as
      Admin, look for a Delete button on the service call receipt photo.
      → None offered anywhere in the UI — the required evidence can never be
      deleted once submitted. 🔒
- [ ] **57.** As the uploader of an ordinary photo (not the receipt), press
      **Delete** on it.
      → Removed immediately — gone from the gallery on a refresh.
- [ ] **58.** As Admin → **CEO Console** → **User Approvals**, reject one
      pending registration with a reason typed in, then approve a different one.
      → The rejected applicant's inbox gets an email with that reason; the
      approved applicant's inbox gets "approved, log in" instead.
- [ ] **59.** As Agent/Admin → **Reports**, search with **Status** set to
      *Resolved* and **Priority** set to *High*, nothing else filled in.
      → Only High-priority Resolved tickets are listed — the two filters
      narrow the result together, not separately.
- [ ] **60.** Still on Reports, also set **Technician** to one specific name
      and search again.
      → The list narrows further to only that technician's tickets.
- [ ] **61.** Click **View Summary** on a result that has files attached.
      → The summary shows the service call number, and below it every
      attached file — including the service call receipt photo — without
      leaving the Reports page.
- [ ] **62.** Export the current Reports results (**Export to spreadsheet**)
      and open the file.
      → Columns include **Priority** and an attachment count next to
      **Service Call Number**.

## Part 10 — Logging a call-in job

A ticket used to only exist if a customer raised it through the portal. Needs
migration 0017 applied.

- [ ] **63.** As Technician (or Agent), press **📞 Log a Call-In Job**. Type an
      existing company name (e.g. **Cargills Food City TEST**), a made-up
      caller name and phone, and a problem, then submit.
      → A real ticket number is issued. Its detail panel shows **Caller**
      with that name/phone, and **Logged by** with your own name.
- [ ] **64.** Check the inbox that belongs to the staff member who just logged
      it.
      → No "Ticket created" email arrives for them — logging a job on
      someone else's behalf never self-notifies the logger.
- [ ] **65.** Claim or assign that job to a technician and resolve it with a
      service call number and receipt photo, same as any other ticket.
      → Resolves normally. On **Reports**, it appears exactly like a
      customer-raised job, with the caller's name/phone shown alongside who
      logged it.
- [ ] **66.** Type a brand-new company name (not already in the list) into
      the Log a Call-In Job form and submit.
      → Succeeds, and that company now exists for real — visible under
      Admin → **Company Limit**.

## Part 11 — Job type

Needs migration 0018 applied.

- [ ] **67.** As Customer, start a new ticket and try to submit without
      touching the **Job Type** field.
      → Refused before it reaches the database — "Choose one…" is a
      placeholder, not a real option.
- [ ] **68.** Submit choosing **Installation**.
      → The ticket card and detail panel both show an **Installation**
      badge/fact alongside the usual status and priority.
- [ ] **69.** As Agent/Admin → **Reports**, filter by **Job Type = Service**
      together with any other filter.
      → Only Service jobs matching the rest of the filters are listed, and
      the exported spreadsheet includes a Job Type column.

## Part 12 — Production hardening

A full audit pass over everything above found and fixed three more defects.
Needs migration 0019 applied.

- [ ] **70.** Run `supabase/diagnose.sql` section 5 ("Duplicate function
      overloads").
      → No rows returned. A row here means a migration changed a
      function's arguments without dropping the old version first — a
      real bug, not something to interpret away.
- [ ] **71.** As Technician, open the resolve form on an assigned job,
      select a receipt photo, then — before submitting — have another
      window change that same ticket's status first. Submit anyway and
      choose **Keep their change** on the conflict prompt.
      → The photo you selected does not linger as a "receipt" on that
      ticket. Reopen the resolve form later and it still asks for a real
      photo; it does not consider the job already evidenced.
- [ ] **72.** As two different technicians (or two windows of the same
      one), log a call-in job for a brand-new company name at the same
      time, in different letter casing (e.g. "Test Co" and "test co").
      → Only one company is created. The second attempt either reuses it
      or gets a clear message that it already exists — never two
      separate companies for the same name.

---

## Result

```
Passed: ____ / 72       Date: __________       Tested by: __________
```

🔒 marks a security check — **5, 6, 7, 31, 49, 50, 56**. A failure in any of
those stops the launch. Everything else is a defect to fix, not a gate.
