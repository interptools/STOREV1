# Arroyo POS — Client Intake Form

A single-page form the client fills in at handover. It asks only for things the client
actually knows, and the email arrives formatted for pasting into the Arroyo POS Deployer
(currently v7.11.0). Submissions go to **areymar36@gmail.com**.

## What the client fills in

| Form field | Deployer field |
|---|---|
| Shop name *required* | `bizName` |
| Shop type | `bizType` (same nine values) |
| Owner name | `ownerName` |
| Owner email *required* | `ownerEmail` — becomes the POS sign-in |
| Contact number | agreement generator, `ag-phone` |
| Shop address | `bizLoc` / `ag-address` |
| Who signs the agreement | `ag-signatory` |
| Products | `starterProducts` |
| Screen colour | `themeColor` |
| Daily sales target | `dailyGoal` |
| Paper roll width | `thermalWidth` |
| Print automatically | `autoPrint` |
| Use a waiting queue | `queueOn` |
| Letters before the number | `queuePrefix` |
| Call numbers out loud | `queueVoice` |

The product box runs the deployer's own `parseStarter()` parser — same `|` separator, same
`#` comment lines, same duplicate and price checks — so a list that reads clean on the form
pastes in clean. If lines fail, sending asks for confirmation first.

## What stays out of the form

Entered in the deployer at build time, never asked of the client: GitHub username and repo,
Supabase URL and anon key, admin password, POS sign-in password, creator password, existing
Business ID, package sold, price charged, free service months, and the service fee after the
free period. Nothing sensitive travels by email any more.

The closing panel on the form tells the client these are handled, so the gaps don't read as
an unfinished form.

## Put it online

1. Create a repo (e.g. `pos-intake`) and upload `index.html` to the root.
2. Settings → Pages → Source: **Deploy from a branch** → `main` / `(root)` → Save.
3. Live at `https://<username>.github.io/pos-intake/` in about a minute.

To host it inside an existing Pages repo, drop `index.html` into a folder such as `/intake/`.

## Turn on email delivery (one time)

Handled by [FormSubmit](https://formsubmit.co) — no backend, no account, no API key.

1. Open the live form and send one test submission.
2. FormSubmit emails `areymar36@gmail.com` an activation link. Click it.
3. Submit again. Every submission after that arrives as a table-formatted email.

Until step 2 is done, submissions are held rather than delivered.

### Hide the address, and cut spam

The address sits in plain HTML where scrapers can read it, and anyone who reads it can POST
to the endpoint from anywhere. After activation, FormSubmit gives a random string for the
same inbox — swap it into the top of the `<script>` block:

```js
var ENDPOINT = 'https://formsubmit.co/ajax/YOUR_RANDOM_STRING';
```

Leave `MAIL_TO` as the real address; it only feeds the manual fallback. The form also posts
a `_honey` honeypot field, which FormSubmit uses to drop bots. If junk still arrives, remove
`body._captcha = 'false'` to turn the captcha back on — it costs the client one extra tap.

## If sending fails

Four routes, in order of how much they ask of the client:

1. **Send to Reymar** posts in the background as form-encoded data, so no CORS preflight is
   needed and the client stays on the page.
2. If the browser blocks that, the error offers **Send the direct way** — a real form POST
   with no `fetch` and no CORS involved, so an ad blocker or shield cannot stop it. It leaves
   the page for FormSubmit's confirmation screen, which is why it isn't the default.
3. **Copy as text** puts a formatted summary on the clipboard.
4. **Open my email app** builds the same summary as a pre-filled email.

Opened from a folder rather than a web address, the page says so on load instead of letting
the client discover it by tapping Send. `Failed to fetch` almost always means exactly that: a
`file://` origin, an ad blocker, or no signal — not a FormSubmit problem.

Routes 3 and 4 end with a `DEPLOYER FIELDS` block keyed by deployer input id, plus the
product list as a standalone paste block.

## Notes

- Thirteen FAQ entries sit collapsed just above the send button, where an owner with a doubt
  would hesitate. They are native `<details>` elements — no JS, keyboard-navigable, and
  excluded from the submitted data.
- **Read the BIR answer before you publish.** It states plainly that Arroyo POS is not a
  BIR-accredited system and does not replace official receipts. That is the honest position
  and worth keeping, but the wording is yours to set.
- The answers on one-time payment, what happens after the free service period, data
  ownership and client-carried hardware costs are taken from the deployer's own agreement
  text, so the form and the signed agreement say the same thing. If you reword the
  agreement, reword these too.
- The waiting queue section only appears for cafe, restaurant and bakery — the same gate the
  deployer uses.
- Print settings appear unless the client says they won't print receipts. **In the deployer
  these two controls sit inside `queueFields`**, so they're hidden for a sari-sari store or
  salon even though those clients may well own a printer. Worth moving out of the queue card
  in v7.12.
- Logos can't travel through a form. The client ticks a box and emails the file separately.
- The receipt preview at the top is cosmetic — it shows the first three products, the shop
  name, the address and the queue prefix in the chosen colour.
