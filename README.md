# BTC 15M Signal Dashboard

Free static website for monitoring BTC and generating conservative paper signals for Kalshi BTC 15-minute markets.

## Run
Open `index.html` locally or deploy the folder to GitHub Pages.

## Important
- This version does NOT place trades.
- It uses a public Binance BTC/USDT WebSocket for live price updates.
- It attempts to read the public Kalshi BTC 15-minute market endpoint directly from the browser.
- Browser CORS or Kalshi API changes can prevent the public market section from loading. The site will remain usable in observation mode.
- The included signal model is deliberately simple and conservative. It is NOT a proven profitable strategy.

## Next upgrades
1. Historical Kalshi data ingestion.
2. True backtesting.
3. More robust probability model.
4. BRTI-aligned reference-price handling.
5. Persistent paper-trade database.
6. Calibration: compare predicted probabilities to actual win rates.
