# Shelf Talker Wizard

A small web app for Liquor Outlet Wine Cellars to create print-ready shelf talkers without opening Photoshop. It reproduces the look of the existing amber/purple templates (same logo, layout, and card size) and adds:

- **Manual entry** form for title, description, size/unit, regular price, and sale price.
- **Import from website** &mdash; paste a product page URL and the app tries to pull the title, description, and price automatically (reads the page's structured product data), so you can review and tweak before adding it.
- **Bulk CSV import** for adding many products at once.
- **Standardized sizing** &mdash; every card is the same print dimensions as the original template, and title/description text automatically shrinks (or clamps with an ellipsis as a last resort) so it always fits, no manual formatting needed.
- **Two brand themes** (Amber / Purple) matching the provided templates, mixable on the same print run.
- **Print-ready sheets** &mdash; queue up talkers and print; they're laid out 6-up on Letter-size paper (3 columns &times; 2 rows), the same arrangement as the original template, paginating automatically if you have more than 6.
- Your queue is saved in the browser (localStorage) so it survives a refresh.

## Running it

Requires [Node.js](https://nodejs.org/) 18+ (for built-in `fetch`).

```bash
npm install
npm start
```

Then open http://localhost:3000 in a browser.

## Using the website import

Click **Import from Website**, paste a product page URL from liquoroutletwinecellars.com, and click **Fetch Product Data**. The importer looks for (in order):

1. The page's `application/ld+json` Product schema (name, description, price) &mdash; most modern storefronts (Shopify, WooCommerce, BigCommerce, etc.) include this automatically.
2. Open Graph / meta description tags as a fallback.
3. Common "was / now" price markup (e.g. Shopify's `price-item--sale` / `price-item--regular` classes, or WooCommerce's `<del>`/`<ins>` price tags) to detect a sale price.

If a page doesn't expose any of this, the fields will come back blank and you can fill them in manually &mdash; the import is a shortcut, not a requirement.

## Printing

1. Add shelf talkers via any of the three methods.
2. Review/edit/reorder in the **Queue** panel.
3. Click **Print Sheet(s)**. This opens your browser's print dialog with pages already formatted for Letter paper, 6 talkers per sheet. Choose "Save as PDF" instead of a printer if you want a PDF file.

## Project layout

```
server/
  index.js            Express app: serves the frontend and the URL-import API
  productImport.js    Fetches a product page and extracts title/description/price
public/
  index.html          Wizard UI
  css/styles.css      App styling + the shelf-talker card + print layout
  js/card.js           Card rendering + auto text-fit
  js/app.js            Form, queue, import, CSV, and print wiring
  assets/logo.png      Brand logo (extracted from the provided template)
```

## Customizing

- **Card proportions and theme colors** live at the top of `public/css/styles.css` (the `.card` rules and `--amber-band` / `--purple-band` variables) &mdash; these were measured directly from the provided PSD templates.
- **Card fields/markup** are generated in `public/js/card.js`.
- To add a third theme, add a new `--yourtheme-band` CSS variable, a `.card[data-theme="yourtheme"]` rule, and add the option to the `<select id="fTheme">` in `index.html`.
