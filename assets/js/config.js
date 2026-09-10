/* ==========================================================================
   KAALVOET KAOS MERCH — CONFIGURATION
   --------------------------------------------------------------------------
   Everything you are likely to change lives in this one file.
   Edit the values, save, commit. No build step, no npm, nothing to compile.
   ========================================================================== */

window.KK_CONFIG = {

  /* --- Shop identity ---------------------------------------------------- */
  brand: {
    name: 'Kaalvoet Kaos',
    shopName: 'Kaalvoet Kaos Merch',
    tagline: 'Barefoot. Chaotic. Fully kitted.',
    blurb: 'Your favourite team has merch. Ultimate discs, socks, shirts — ' +
           'every disc is a one-of-one, so get it while stocks last.',
    domain: 'shop.kaalvoetkaos.co.za',
    instagram: 'https://instagram.com/kaalvoet_kaos_ultimate',
    facebook: '',
    mainSite: '',            // no separate site; the link hides itself when blank
  },

  /* --- Who receives the orders ------------------------------------------
     whatsapp: international format, digits only. 27 = South Africa,
     then drop the leading 0.  e.g.  082 123 4567  ->  27821234567        */
  contact: {
    whatsapp: '27736269842',
    whatsappDisplay: '073 626 9842',
    email: 'kaalvoetkaos@gmail.com',
    contactName: 'Richard',
  },

  /* --- Banking details shown on the order page --------------------------
     TO DO: fill these in, then flip `ready` to true.

     While `ready` is false the order page does NOT show an account number.
     It tells the buyer you will send banking details on WhatsApp instead,
     and the proof-of-payment step becomes optional. That way nobody can
     EFT money into a half-filled-in account.

     Once the real details are in here, set ready: true and the EFT panel
     appears on its own.                                                   */
  banking: {
    ready: false,
    accountName: 'Kaalvoet Kaos',
    bank: '',
    accountNumber: '',
    branchCode: '',
    accountType: '',
    referenceHint: 'Use your ORDER NUMBER as the payment reference.',
  },

  /* --- Delivery options -------------------------------------------------
     price: 0 shows as "Free". Add or remove entries freely.               */
  delivery: [
    {
      id: 'collect',
      label: 'Collect from me',
      price: 0,
      note: 'Arrange a time and place -- Bloemfontein area.',
      needsAddress: false,
    },
    {
      id: 'tournament',
      label: 'Hand-over at a tournament or training',
      price: 0,
      note: 'I bring it to the next one you are at. Tell me which below.',
      needsAddress: false,
    },
    {
      id: 'courier-friend',
      label: 'Send it down with someone',
      price: 0,
      note: 'If a teammate is heading your way I will send it with them. Tell me who or where below.',
      needsAddress: false,
    },
  ],

  /* --- Order submission -------------------------------------------------
     The site never takes card payments. An order is: pick items, fill in
     your details, EFT, upload proof.

     mode:
       'whatsapp'  — order opens in WhatsApp, buyer sends the POP there.
                     Works instantly with zero setup. This is the default.
       'endpoint'  — also POSTs the whole order (POP file included) to your
                     own endpoint. See server/google-apps-script.gs for a
                     free Google Sheets + Drive receiver you can deploy in
                     about five minutes. Set endpointUrl below.
       'both'      — POST to the endpoint AND offer the WhatsApp handoff.
                     Recommended once your endpoint is live.                */
  orders: {
    mode: 'both',
    endpointUrl: 'https://script.google.com/macros/s/AKfycbz33g3kPKk3PckmueNq2R52RQj-u2ZskXpk0nyHOmVMlbMrccRlDoP4qiz4mowBgPvV/exec',
    orderPrefix: 'KK',
    maxPopSizeMb: 8,

    /* --- Automatic sold-out ---------------------------------------------
       With an endpointUrl set, the shop asks it on every page load how many
       of each SKU have already been claimed, subtracts that from the stock
       in products.json, and anything at zero shows as SOLD OUT to everyone.
       Claiming happens the moment an order is submitted, and the order page
       re-checks immediately before submitting so two people cannot take the
       same disc.

       This needs the endpoint: a plain static site has no way to know what
       another visitor claimed. Until endpointUrl is filled in, stock stays
       exactly as products.json says and you mark items sold yourself in
       manage.html.

       liveStock:      false turns the whole thing off even with an endpoint
       stockTimeoutMs: how long to wait before giving up and showing the
                       products.json stock instead — the shop never hangs   */
    /* --- INTEREST MODE (currently ON) ------------------------------------
       While reserveStock is false the shop takes expressions of interest
       rather than claims:

         - nothing is ever marked sold out, so everyone can pick freely and
           several people can put their name against the same disc
         - orders still land in the Orders tab exactly as before
         - the Stock tab still tallies how many people asked for each SKU,
           which is the useful part: it tells you what is in demand

       TO GO BACK TO A REAL SHOP: set both of these to true. Nothing else
       to change and no need to redeploy the Apps Script.                */
    reserveStock: false,
    liveStock: false,
    // Apps Script answers through a redirect and can cold-start, so it
    // regularly takes 3-6 seconds. At 4s the check was timing out and the
    // shop was quietly falling back to products.json -- which showed sold
    // discs as still available, the exact thing this is meant to prevent.
    // The check no longer blocks the page, so a longer wait costs nothing.
    stockTimeoutMs: 15000,
    // Ceiling on submitting an order. If the endpoint is slower than this
    // the buyer still gets their confirmation and the WhatsApp handoff.
    orderTimeoutMs: 25000,
    // Shown to the buyer on the confirmation screen.
    confirmationNote: 'I check orders daily. You will get a WhatsApp from me to ' +
                      'confirm stock and arrange the hand-over.',
  },

  /* --- Shop behaviour ---------------------------------------------------- */
  shop: {
    currency: 'ZAR',
    currencySymbol: 'R',
    productsUrl: 'data/products.json',
    /* --- Pricing tiers ----------------------------------------------------
       Buckets you sort discs into so you can price a whole group at once in
       manage.html. Rename, reorder or add to this list freely.

       Tiers are INTERNAL. They never appear in the shop, so a disc graded
       'Boring' is not labelled that to a buyer. If you do want a tier to
       show a badge publicly, add it to tierBadges below with the wording
       you want; anything not listed stays hidden.                        */
    tiers: ['Coolest', 'Cool', 'Okay', 'Boring'],
    tierBadges: {
      // 'Coolest': 'Top pick',
    },

    // Reserve stock messaging on one-of-one items
    uniqueBadge: 'One of one',
    lowStockAt: 3,
    // Announcement bar. Set to '' to hide it.
    announcement: 'Your favourite team has merch · South Africa only · EFT, no card needed',

    /* Orders are taken from inside South Africa only: payment is by EFT into
       a local account and delivery is courier or PAXI. The province list, the
       cell number check and the copy below all follow from this.           */
    countryOnly: 'South Africa',
  },
};
