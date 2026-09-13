# Xtra Zone Billing

A standalone billing software product built for local use. It keeps everything in the browser with `localStorage`, so you can add categories, products, and complete sales without a backend.

## Features

- category management
- product catalog with stock and pricing
- instant sales cart
- tax and total calculations
- payment method selection
- configurable country, locale, currency, and tax settings
- configurable client business name for the app header and printed bills
- sales history with today filtering
- printable receipts
- JSON backup export and restore
- inventory deduction and stock validation
- mobile-friendly layout
- local persistence using browser storage

## Run locally

Open the folder in a browser directly, or serve it locally:

```bash
cd morrow-pos
python -m http.server 4173
```

Then open `http://localhost:4173`.

## Notes

This is a standalone local product. Data is stored in the browser on the current device. Export a JSON backup regularly when moving between browsers or devices. Currency values are entered directly in the configured currency; the app does not apply automatic foreign-exchange conversion.
