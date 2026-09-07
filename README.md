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

1. Run the site locally (see below) and open `http://localhost:8000/manage.html`.
2. Click **Connect project folder** and pick this project folder — the one containing `index.html`.
   Grant write permission.
3. Photograph your discs. Any size, any orientation — they get resized to 1500px and compressed for you.
4. Drag all 50 photos onto the **Photos** dropzone at once.
5. Attach them, whichever suits you:
   - **Match by filename** — name a photo `KK-D07.jpg` and it finds disc `KK-D07` itself.
   - **Fill discs without photos, in order** — assigns them top to bottom.
   - **Make a new disc per photo** — wipes the sample discs first, then creates one product per photo.
   - Or drag a single photo onto any row's thumbnail.
6. Set names, prices and stock in the table. Prices in the table are Rand, no decimals needed.
7. Click **Save changes**. Photos are written to `assets/img/products/` and `data/products.json` is
   rewritten in place.
8. Commit and push.

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
every order to a Google Sheet and drops each proof of payment into a Drive folder — about five minutes
to set up, no monthly cost.

If the endpoint ever fails, the confirmation screen tells the buyer to send the WhatsApp instead, so an
order is never silently lost.

---

## Stock rules

- `stock: 1` plus `unique: true` gives the **One of one** badge and stops quantity increases.
- `stock: 0` marks it sold out — it stays visible but greys out. Untick *In stock only* to see them.
- Discs aren't reserved when someone adds them to a bag. First proof of payment wins; the copy on the
  site says so. Mark a disc `stock: 0` in `manage.html` once it's paid for.

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
