# Kaalvoet Kaos Merch

The merch shop for [shop.kaalvoetkaos.co.za](https://shop.kaalvoetkaos.co.za) — 50 one-of-one ultimate
frisbee discs, plus socks, shirts and whatever else lands next.

There is **no card checkout**. Buyers pick their gear, hand over their details, EFT the total and upload a
proof of payment. You confirm on WhatsApp and arrange the hand-over.

---

## What's in the box

| Page | What it does |
| --- | --- |
| `index.html` | The shop — search, filters, quick view, bag |
| `order.html` | Order form, banking details, proof-of-payment upload |
| `manage.html` | **Admin.** Bulk photo import and stock editing. Not linked from the shop |
| `404.html` | Friendly not-found page |
| `data/products.json` | Every product. The single source of truth |
| `assets/js/config.js` | Your details — bank account, WhatsApp number, delivery options |
| `server/google-apps-script.gs` | Optional free receiver that logs orders to a Google Sheet |

No build step, no npm, no framework. Plain HTML, CSS and JavaScript — edit a file, refresh, done.

---

## First things to change

Open `assets/js/config.js` and fix these before you go live:

1. ~~**`contact.whatsapp`**~~ — done, set to `27736269842` (073 626 9842).
2. **`banking`** — currently `ready: false`, so **no account number is shown to anyone**. The order page
   tells buyers you will WhatsApp them the details, and the proof-of-payment step reads as optional.
   Fill in `bank`, `accountNumber`, `branchCode` and `accountType`, then set `ready: true` and the EFT
   panel appears on its own. Nothing else to change.
3. **`contact.email`** — currently `orders@kaalvoetkaos.co.za`. Change it if that mailbox does not exist.
4. **`delivery`** — courier and PAXI prices, or delete the options you don't offer.

Everything else (announcement bar, tagline, blurb, low-stock threshold) is in the same file.

---

## Loading your 50 discs

Every disc is different, so every disc needs its own photo. `manage.html` exists to make that quick.

### The fast way (Chrome or Edge on desktop)

The shop ships with 50 **sample** discs so it looks real before your stock is in. Replacing them with
your actual discs takes about twenty minutes.

1. Run the site locally (see below) and open <http://localhost:8000/manage.html>.
2. Click **Connect project folder**, pick this project folder — the one containing `index.html` — and
   grant write permission.
3. Press **Clear sample stock**. That empties the catalogue so you start from nothing. (Nothing is
   written to disk until step 7, so this is safe to undo by pressing **Reload catalogue**.)
4. Photograph your discs, one photo each. Any size or orientation — they are resized to 1500px and
   compressed in your browser.
5. Drag all the photos onto the **Photos** dropzone at once, then press **Make a new disc per photo**.
   You get one product per photo, named from the filename, with a fresh SKU.
6. Fill in the details:
   - **Price** — type it straight into the table. Same price for a batch? Tick them and use
     *Set price* in the bulk bar.
   - **Brand, model, condition, weight, colourway** — tick a batch and use *Set … to …* in the bulk
     bar. Most crates are all the same mould, so this is usually two clicks for all of them.
   - **Name and description** — click the pencil on a row for the full editor.
7. Click **Save changes**. Photos are written to `assets/img/products/` and `data/products.json` is
   rewritten in place.
8. Commit and push.

### Adding a few more later

Skip step 3. Drop the new photos in and either press **Make a new disc per photo**, or use
**Match by filename** (name a photo `KK-D07.jpg` and it finds disc `KK-D07`), **Fill discs without
photos, in order**, or just drag one photo onto any row's thumbnail.

### Any other browser

Same page, same workflow, but it can't write to your folder. Use **Download products.json** and
**Download photos .zip**, then unzip into the project yourself. The zip already has the right folder
structure — extract it over the project root and the paths line up.

### Editing names, prices and descriptions

Click the **pencil** in a product's row (or its thumbnail) to open the full editor:

- Photos — add, remove, or **make main** (the first photo is the one the grid shows)
- Name, description, price, was-price, stock, category
- Brand, model, weight, condition, stamp, colourway
- Two placeholder colours, used to draw the fallback disc art until a photo exists
- Tags (comma separated, feeds the shop search)
- Options label + options, e.g. `Size` and `XS, S, M, L, XL` — sized items make the buyer
  pick before adding to the bag

Simple fields (name, price, stock, category, model, condition) are also editable straight
in the table, and the toolbar can set price or stock across everything you tick.

Nothing is written until you press **Save changes**, so experiment freely. The button grows
a dot when you have unsaved work, and the browser warns you if you try to leave.

### The fastest way to name and price everything

Typing 64 names and prices into a web table is slow however fast the table is.
Use a spreadsheet instead:

1. **Download spreadsheet** in the toolbar.
2. Open it in Excel or Google Sheets and fill in `name`, `price`, `stock`,
   `tier`, `condition` and the rest. Fill-down and paste work as you would
   expect, which is the whole point.
3. **Import spreadsheet** and pick the file.

Rows are matched on `sku`, so the order does not matter, you can delete rows you
do not want to touch, and an unknown SKU is skipped rather than creating
anything. Photos, groups and flags are never affected. Nothing is written to
disk until **Save changes**.

### When the automatic cut-out gets it wrong

Some photos cannot be separated automatically. If a crease or reflection in the
sweep lies against the rim, it looks exactly like disc plastic, and guessing
harder risks eating the disc itself.

Those get **flagged** for you: the backdrop pass raises a flag on anything it
refused, and you can raise or clear one yourself with the flag button in the
**Fix** column. Filter the table to *Flagged for fixing* to work through them.

To fix one, open the product, hover its photo and press the **dashed-circle**
button. That opens the cookie cutter:

- A circle is placed on the disc for you
- Drag inside it to move, drag the side or bottom handle to resize, scroll to
  grow or shrink, arrow keys to nudge (hold shift for bigger steps)
- **Make it a circle** evens up an oval; **Snap back to auto** starts over
- **Apply the cut** replaces everything outside the ring, using the same colour
  rule as the automatic pass, and clears the flag

Nothing is written until **Save changes**, and the originals are always in git:
`git checkout HEAD -- assets/img/products/` puts every photo back.

### Photo tips

- Shoot straight down on a plain background, disc filling the frame. The shop crops to a square.
- Same background and lighting for all 50 makes the grid look far better than perfect individual shots.
- HEIC from an iPhone often won't decode in the browser. Set the iPhone camera to
  *Settings > Camera > Formats > Most Compatible*, or convert to JPG first.
- The first photo is the one shown in the grid. Open a product's thumbnail to reorder or add more.

Any product without a photo falls back to a generated disc graphic in its colourway, so the shop never
looks broken while you work through the crate.

---

## Running it locally

Opening `index.html` straight from Explorer will **not** work — browsers block `fetch` of
`data/products.json` over `file://`. Serve it instead:

```bash
# Python (already on most machines)
python -m http.server 8000

# or Node
npx serve .
```

Then visit <http://localhost:8000>.

---

## How orders reach you

Set by `orders.mode` in `assets/js/config.js`:

- **`whatsapp`** (default) — the buyer submits, gets an order number, then taps a button that opens
  WhatsApp with the whole order pre-written. They attach the POP in the chat. Zero setup, works today.
- **`endpoint`** — the order, including the POP file, is POSTed to a URL you control.
- **`both`** — posts to your endpoint *and* offers the WhatsApp handoff. Recommended once the
  endpoint is live.

For a free endpoint, follow the setup comments at the top of `server/google-apps-script.gs`. It logs
every order to a Google Sheet, drops each proof of payment into a Drive folder, and keeps the live
claim count that drives automatic sold-out — about five minutes to set up, no monthly cost.

**Automatic sold-out only works once this is deployed.** Until then the shop shows whatever stock
`products.json` says.

If the endpoint ever fails, the confirmation screen tells the buyer to send the WhatsApp instead, so an
order is never silently lost.

---

## Stock and automatic sold-out

`data/products.json` holds the **starting** stock. Who has claimed what is live state, and a static site
has no way to know it on its own — so that part needs the endpoint.

**With `orders.endpointUrl` set** (see below), it is automatic:

1. Every page load asks the endpoint how many of each SKU are claimed.
2. That is subtracted from the starting stock. Anything at zero shows **Sold** to everyone, greyed out,
   with the add button disabled.
3. Submitting an order claims its items immediately.
4. The order page re-checks right before submitting, so if someone claims a disc while a buyer is
   filling in the form, they are told it just sold out and it is dropped from their bag — the rest of
   the order still goes through.
5. The endpoint refuses an order that would oversell, even if two people hit submit at the same instant
   (it takes a lock).

If the endpoint is slow, down, or not configured, the shop falls back to the `products.json` stock and
carries on — it never hangs or blocks an order. Set `orders.liveStock: false` to switch it off entirely.

**To free an item up again** (someone claimed it and never paid), open the **Stock** sheet in your
orders spreadsheet and lower that SKU's `Claimed` number. The shop picks it up on the next load.

**Without an endpoint**, you mark things sold yourself: set stock to 0 in `manage.html`, then commit.

Other rules:

- `stock: 1` plus `unique: true` gives the **One of one** badge and stops quantity increases.
- `stock: 0` keeps the item visible but greyed out. Untick *In stock only* to see sold items.

---

## Deploying

The site is plain files at the repo root, so GitHub Pages can serve it straight from the branch — no
build, no Actions workflow needed.

1. Push to GitHub.
2. **Settings > Pages > Build and deployment > Source: Deploy from a branch**, branch `main`, folder
   `/ (root)`.
3. **Settings > Pages > Custom domain:** `shop.kaalvoetkaos.co.za`, then tick *Enforce HTTPS* once the
   certificate is issued.
4. At your DNS host, add a `CNAME` record:

   | Type | Name | Value |
   | --- | --- | --- |
   | CNAME | `shop` | `<your-github-username>.github.io` |

The `CNAME` file in this repo already holds the domain — leave it there or Pages forgets the domain on
each deploy. DNS can take anywhere from a few minutes to a few hours.

Every push to `main` republishes within a minute or two.

### If you would rather deploy with GitHub Actions

`server/github-pages-workflow.yml.example` is a ready-made workflow. To use it, move it to
`.github/workflows/pages.yml` and set **Source: GitHub Actions** instead. Note that pushing a workflow
file needs the `workflow` scope on your token — run `gh auth refresh -s workflow` first if you use the
GitHub CLI. Branch deployment above is simpler and does the same job for a static site.

---

## Adding socks, shirts and other kit

Add a product in `manage.html` and set its category to `apparel` or `accessories` — a filter chip appears
automatically. For sized items, give the product a `variantLabel` and `variants` array in
`data/products.json`:

```json
"variantLabel": "Size",
"variants": ["XS", "S", "M", "L", "XL", "2XL"]
```

Sized products then force the buyer through quick view to choose a size before adding to the bag, and
the chosen size travels through to the order.

---

## Privacy

Buyer details go to you and nobody else. The cart and remembered contact details live in the buyer's own
browser (`localStorage`). Proofs of payment go wherever you point `orders`. No analytics, no trackers,
no third-party scripts other than Google Fonts.
