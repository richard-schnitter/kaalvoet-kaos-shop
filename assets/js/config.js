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
    blurb: 'Fifty discs came off the boat. Every one is a one-of-one — ' +
           'when it is gone, it is gone. Plus the kit that keeps the rest of you covered.',
    domain: 'shop.kaalvoetkaos.co.za',
    instagram: 'https://instagram.com/kaalvoet_kaos_ultimate',
    facebook: '',
    mainSite: 'https://kaalvoetkaos.co.za',
  },

  /* --- Who receives the orders ------------------------------------------
     whatsapp: international format, digits only. 27 = South Africa,
     then drop the leading 0.  e.g.  082 123 4567  ->  27821234567        */
  contact: {
    whatsapp: '27736269842',
    whatsappDisplay: '073 626 9842',
    email: 'orders@kaalvoetkaos.co.za',
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
      note: 'Arrange a time and place — Bloemfontein area.',
      needsAddress: false,
    },
    {
      id: 'training',
      label: 'Hand-over at training / tournament',
      price: 0,
      note: 'I bring it to the next session you are at. Tell me which one below.',
      needsAddress: false,
    },
    {
      id: 'courier',
      label: 'Courier to your door',
      price: 120,
      note: 'Nationwide, 2–4 working days. Flat rate per order.',
      needsAddress: true,
    },
    {
      id: 'paxi',
      label: 'PAXI to a PEP store',
      price: 60,
      note: 'Cheapest option. 7–9 working days. Give me your PEP store code.',
      needsAddress: true,
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
    mode: 'whatsapp',
    endpointUrl: '',
    orderPrefix: 'KK',
    maxPopSizeMb: 8,
    // Shown to the buyer on the confirmation screen.
    confirmationNote: 'I check orders daily. You will get a WhatsApp from me to ' +
                      'confirm stock and arrange the hand-over.',
  },

  /* --- Shop behaviour ---------------------------------------------------- */
  shop: {
    currency: 'ZAR',
    currencySymbol: 'R',
    productsUrl: 'data/products.json',
    // Reserve stock messaging on one-of-one items
    uniqueBadge: 'One of one',
    lowStockAt: 3,
    // Announcement bar. Set to '' to hide it.
    announcement: '50 discs landed · every one a one-of-one · no card needed, EFT + proof of payment',
  },
};
