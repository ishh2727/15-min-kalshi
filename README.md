# BTC 15M Signal Dashboard v2

This version fixes the two data-feed issues in the first prototype:
- Uses Coinbase Advanced Trade's public BTC-USD ticker WebSocket instead of the Binance browser feed.
- Uses Kalshi's current public production API host: external-api.kalshi.com.

Kalshi documents that public market endpoints do not require authentication and that its public market data can be used for monitoring/analysis. Coinbase documents the public Advanced Trade WebSocket ticker channel for BTC-USD.

This is still a paper/experimental signal model. It is not a guaranteed-profit system. Historical backtesting is required before relying on any probability estimate.

Deploy the files to the same GitHub Pages repository, replacing the existing index.html, style.css, and app.js.
