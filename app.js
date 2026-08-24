const $ = id => document.getElementById(id);

const state = {
  price: null,
  previous: null,
  samples: [],
  target: null,
  up: null,
  down: null,
  marketId: null,
  marketEnd: null,
  lastSignal: "WAITING",
  logs: JSON.parse(localStorage.getItem("btcSignalLogs") || "[]")
};

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";

  return "$" + Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function pct(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return (Number(n) * 100).toFixed(1) + "%";
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;

    const n = Number(value);

    if (Number.isFinite(n)) return n;
  }

  return null;
}

function setStatus(text, ok = false) {
  const el = $("status");

  if (!el) return;

  el.innerHTML =
    `<span style="background:${ok ? "#62d58a" : "#f0b429"}"></span>` +
    text;
}

function updatePrice(price) {
  if (!Number.isFinite(price)) return;

  state.previous = state.price;
  state.price = price;

  $("btcPrice").textContent = money(price);

  if (state.previous != null) {
    const change = price - state.previous;
    const percent = (change / state.previous) * 100;

    $("btcChange").textContent =
      (change >= 0 ? "+" : "") +
      money(change) +
      " (" +
      (percent >= 0 ? "+" : "") +
      percent.toFixed(3) +
      "%)";
  } else {
    $("btcChange").textContent = "Live BTC price";
  }

  state.samples.push({
    t: Date.now(),
    p: price
  });

  const oneMinuteAgo = Date.now() - 60 * 1000;

  state.samples = state.samples.filter(x => x.t >= oneMinuteAgo);

  $("sampleCount").textContent =
    state.samples.length + " samples";

  drawChart();

  if (state.target != null) {
    const distance = price - state.target;

    $("distance").textContent =
      (distance >= 0 ? "+" : "") +
      money(distance) +
      " vs target";
  }

  calculateSignal();
}

function drawChart() {
  const canvas = $("chart");

  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.height || 220;

  canvas.width = w * dpr;
  canvas.height = h * dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (state.samples.length < 2) return;

  const values = state.samples.map(x => x.p);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  ctx.beginPath();

  state.samples.forEach((sample, index) => {
    const x =
      index * (w / (state.samples.length - 1));

    const y =
      h -
      20 -
      ((sample.p - min) / range) *
        (h - 40);

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 2;
  ctx.stroke();
}

async function getBTC() {
  try {
    const response = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error("BTC HTTP " + response.status);
    }

    const data = await response.json();

    const price = Number(data.price);

    if (!Number.isFinite(price)) {
      throw new Error("Invalid BTC price");
    }

    updatePrice(price);
    setStatus("BTC live • Binance", true);

  } catch (error) {
    console.error("BTC error:", error);
    setStatus("BTC feed error — retrying…");
  }
}

async function getKalshi() {
  try {
    const kalshiUrl =
      "https://external-api.kalshi.com/trade-api/v2/markets" +
      "?series_ticker=KXBTC15M&status=open&limit=10";

    const relay =
      "https://api.allorigins.win/raw?url=" +
      encodeURIComponent(kalshiUrl);

    const response = await fetch(relay, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Kalshi relay HTTP " + response.status);
    }

    const data = await response.json();

    const markets = (data.markets || []).filter(
      market =>
        market.status === "open" ||
        market.status === "active" ||
        !market.status
    );

    if (!markets.length) {
      throw new Error("No active BTC 15M market");
    }

    markets.sort((a, b) => {
      const aTime = new Date(
        a.close_time ||
        a.expected_expiration_time ||
        a.expiration_time ||
        0
      ).getTime();

      const bTime = new Date(
        b.close_time ||
        b.expected_expiration_time ||
        b.expiration_time ||
        0
      ).getTime();

      return aTime - bTime;
    });

    const market = markets[0];

    state.marketId = market.ticker || null;

    state.target = firstNumber(
      market.floor_strike,
      market.strike_price,
      market.floor_strike_dollars
    );

    state.marketEnd = market.close_time
      ? new Date(market.close_time).getTime()
      : market.expected_expiration_time
      ? new Date(market.expected_expiration_time).getTime()
      : null;

    let yesAsk = firstNumber(
      market.yes_ask_dollars,
      market.yes_ask
    );

    let noAsk = firstNumber(
      market.no_ask_dollars,
      market.no_ask
    );

    let yesBid = firstNumber(
      market.yes_bid_dollars,
      market.yes_bid
    );

    let noBid = firstNumber(
      market.no_bid_dollars,
      market.no_bid
    );

    if (
      market.yes_ask_dollars == null &&
      yesAsk != null &&
      yesAsk > 1
    ) {
      yesAsk /= 100;
    }

    if (
      market.no_ask_dollars == null &&
      noAsk != null &&
      noAsk > 1
    ) {
      noAsk /= 100;
    }

    if (
      market.yes_bid_dollars == null &&
      yesBid != null &&
      yesBid > 1
    ) {
      yesBid /= 100;
    }

    if (
      market.no_bid_dollars == null &&
      noBid != null &&
      noBid > 1
    ) {
      noBid /= 100;
    }

    state.up =
      yesAsk ??
      (noBid != null ? 1 - noBid : yesBid);

    state.down =
      noAsk ??
      (yesBid != null ? 1 - yesBid : noBid);

    $("marketId").textContent =
      market.ticker || "—";

    $("targetPrice").textContent =
      money(state.target);

    $("upPrice").textContent =
      state.up == null ? "—" : pct(state.up);

    $("downPrice").textContent =
      state.down == null ? "—" : pct(state.down);

    $("upBar").style.width =
      state.up == null
        ? "0%"
        : Math.min(100, state.up * 100) + "%";

    $("downBar").style.width =
      state.down == null
        ? "0%"
        : Math.min(100, state.down * 100) + "%";

    $("kalshiNote").textContent =
      "Live Kalshi public market data • " +
      (market.volume_fp ?? market.volume ?? 0) +
      " volume";

    if (state.price != null && state.target != null) {
      const distance = state.price - state.target;

      $("distance").textContent =
        (distance >= 0 ? "+" : "") +
        money(distance) +
        " vs target";
    }

    calculateSignal();

  } catch (error) {
    console.error("Kalshi error:", error);

    $("kalshiNote").textContent =
      "Kalshi feed unavailable: " +
      error.message;
  }
}

function calculateSignal() {
  if (
    state.price == null ||
    state.target == null ||
    state.up == null ||
    state.down == null
  ) {
    $("signal").textContent = "WAITING";
    $("modelProb").textContent = "—";
    $("marketProb").textContent = "—";
    $("edge").textContent = "—";
    $("confidence").textContent = "—";
    $("reason").textContent = "Collecting data…";
    return;
  }

  const distance =
    (state.price - state.target) /
    Math.max(state.target, 1);

  const recent =
    state.samples.length >= 2
      ? state.samples[state.samples.length - 1].p -
        state.samples[0].p
      : 0;

  let pUp = 0.5;

  pUp += Math.max(
    -0.18,
    Math.min(0.18, distance * 5)
  );

  pUp += Math.max(
    -0.08,
    Math.min(0.08, recent / state.price * 20)
  );

  pUp = Math.max(0.05, Math.min(0.95, pUp));

  const pDown = 1 - pUp;

  const marketUp = state.up;
  const marketDown = state.down;

  const edgeUp = pUp - marketUp;
  const edgeDown = pDown - marketDown;

  let signal = "WAITING";
  let probability = null;
  let edge = 0;
  let reason = "No high-confidence setup.";

  if (edgeUp >= 0.10 && pUp >= 0.62) {
    signal = "BUY UP";
    probability = pUp;
    edge = edgeUp;
    reason = "Model probability is meaningfully above the market price.";
  } else if (
    edgeDown >= 0.10 &&
    pDown >= 0.62
  ) {
    signal = "BUY DOWN";
    probability = pDown;
    edge = edgeDown;
    reason = "Model probability is meaningfully above the market price.";
  } else {
    probability = Math.max(pUp, pDown);
  }

  $("signal").textContent = signal;
  $("modelProb").textContent = pct(probability);

  $("marketProb").textContent =
    signal === "BUY DOWN"
      ? pct(marketDown)
      : pct(marketUp);

  $("edge").textContent =
    (edge * 100).toFixed(1) + " pts";

  $("confidence").textContent =
    (probability * 100).toFixed(0) +
    "% confidence";

  $("reason").textContent = reason;
}

function renderLogs() {
  const body = $("log");

  if (!body) return;

  body.innerHTML = "";

  state.logs
    .slice(0, 30)
    .forEach(item => {
      const row = document.createElement("tr");

      row.innerHTML =
        "<td>" +
        new Date(item.t).toLocaleTimeString() +
        "</td>" +
        "<td>" +
        item.s +
        "</td>" +
        "<td>" +
        pct(item.p) +
        "</td>" +
        "<td>" +
        pct(item.m) +
        "</td>" +
        "<td>" +
        (item.e * 100).toFixed(1) +
        " pts</td>" +
        "<td>" +
        (item.r || "PENDING") +
        "</td>";

      body.appendChild(row);
    });

  $("signals").textContent =
    state.logs.length;

  const finished =
    state.logs.filter(
      item =>
        item.r === "WIN" ||
        item.r === "LOSS"
    );

  const wins =
    finished.filter(
      item => item.r === "WIN"
    ).length;

  $("wins").textContent = wins;

  $("losses").textContent =
    finished.length - wins;

  $("winrate").textContent =
    finished.length
      ? ((wins / finished.length) * 100).toFixed(1) + "%"
      : "—";
}

setInterval(getBTC, 5000);

setInterval(getKalshi, 5000);

setInterval(() => {
  if (!state.marketEnd) return;

  const seconds = Math.max(
    0,
    Math.floor(
      (state.marketEnd - Date.now()) / 1000
    )
  );

  $("timer").textContent =
    String(Math.floor(seconds / 60)).padStart(2, "0") +
    ":" +
    String(seconds % 60).padStart(2, "0");
}, 250);

window.addEventListener(
  "resize",
  drawChart
);

renderLogs();
getBTC();
getKalshi();
