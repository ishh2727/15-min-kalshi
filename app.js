const $ = id => document.getElementById(id);

const state = {
  price: null, previous: null, samples: [], target: null,
  up: null, down: null, marketId: null, marketEnd: null,
  lastSignal: "WAITING",
  logs: JSON.parse(localStorage.getItem("btcSignalLogs") || "[]")
};

function money(n){
  return n == null || !isFinite(n) ? "—" :
    "$" + Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
}
function pct(n){
  return n == null || !isFinite(n) ? "—" : (n*100).toFixed(1)+"%";
}
function setStatus(text, ok=false){
  $("status").innerHTML=`<span style="background:${ok?"#62d58a":"#f0b429"}"></span>${text}`;
}

function drawChart(){
  const c=$("chart"), ctx=c.getContext("2d"), dpr=devicePixelRatio||1;
  const w=c.clientWidth, h=c.height;
  c.width=w*dpr; c.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  if(state.samples.length<2) return;
  const vals=state.samples.map(x=>x.p);
  const min=Math.min(...vals), max=Math.max(...vals), pad=(max-min)||1;
  ctx.beginPath();
  state.samples.forEach((x,i)=>{
    const px=i*(w/(state.samples.length-1));
    const py=h-20-((x.p-min)/pad)*(h-35);
    i?ctx.lineTo(px,py):ctx.moveTo(px,py);
  });
  ctx.strokeStyle="#7dd3fc"; ctx.lineWidth=2; ctx.stroke();
}

function updatePrice(p){
  if(!Number.isFinite(p)) return;
  state.previous=state.price; state.price=p;
  state.samples.push({t:Date.now(),p});
  const cutoff=Date.now()-20*60*1000;
  state.samples=state.samples.filter(x=>x.t>=cutoff);
  $("btcPrice").textContent=money(p);
  if(state.previous){
    const ch=p/state.previous-1;
    $("btcChange").textContent=(ch>=0?"+":"")+pct(ch)+" since last tick";
  }
  $("sampleCount").textContent=state.samples.length+" samples";
  drawChart(); calculateSignal();
}

function connectCoinbase(){
  const ws=new WebSocket("wss://advanced-trade-ws.coinbase.com");
  ws.onopen=()=>{
    setStatus("BTC live • Coinbase",true);
    ws.send(JSON.stringify({
      type:"subscribe",
      product_ids:["BTC-USD"],
      channel:"ticker"
    }));
    ws.send(JSON.stringify({type:"subscribe",channel:"heartbeats"}));
  };
  ws.onmessage=e=>{
    try{
      const d=JSON.parse(e.data);
      const tickers=[];
      for(const ev of (d.events||[])){
        for(const t of (ev.tickers||[])) tickers.push(t);
      }
      for(const t of tickers){
        if(t.product_id==="BTC-USD" && t.price) updatePrice(Number(t.price));
      }
    }catch{}
  };
  ws.onerror=()=>setStatus("BTC feed error — reconnecting…");
  ws.onclose=()=>{
    setStatus("BTC reconnecting…");
    setTimeout(connectCoinbase,2000);
  };
}

function firstNumber(...vals){
  for(const v of vals){
    if(v!==undefined && v!==null && v!=="" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

async function getKalshi(){
  try{
    const url="https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXBTC15M&status=open&limit=10";
    const r=await fetch(url,{cache:"no-store"});
    if(!r.ok) throw new Error("Kalshi HTTP "+r.status);
    const data=await r.json();
    const markets=(data.markets||[]).filter(m=>m.status==="open" || m.status==="active" || !m.status);
    if(!markets.length) throw new Error("No open BTC 15M market");

    // Prefer the market closing soonest.
    markets.sort((a,b)=>new Date(a.close_time||a.expected_expiration_time||0)-new Date(b.close_time||b.expected_expiration_time||0));
    const m=markets[0];

    state.marketId=m.ticker;
    state.target=firstNumber(m.floor_strike,m.strike_price,m.floor_strike_dollars);
    state.marketEnd=m.close_time ? new Date(m.close_time).getTime() :
                    m.expected_expiration_time ? new Date(m.expected_expiration_time).getTime() : null;

    let yesAsk=firstNumber(m.yes_ask_dollars,m.yes_ask);
    let noAsk=firstNumber(m.no_ask_dollars,m.no_ask);
    let yesBid=firstNumber(m.yes_bid_dollars,m.yes_bid);
    let noBid=firstNumber(m.no_bid_dollars,m.no_bid);

    // Integer cent fields are converted to dollars.
    if(m.yes_ask_dollars==null && yesAsk!=null && yesAsk>1) yesAsk/=100;
    if(m.no_ask_dollars==null && noAsk!=null && noAsk>1) noAsk/=100;
    if(m.yes_bid_dollars==null && yesBid!=null && yesBid>1) yesBid/=100;
    if(m.no_bid_dollars==null && noBid!=null && noBid>1) noBid/=100;

    // If an ask isn't exposed, derive it from the opposite side's bid.
    state.up=yesAsk ?? (noBid!=null ? 1-noBid : yesBid);
    state.down=noAsk ?? (yesBid!=null ? 1-yesBid : noBid);

    $("marketId").textContent=m.ticker;
    $("targetPrice").textContent=money(state.target);
    $("upPrice").textContent=state.up==null?"—":pct(state.up);
    $("downPrice").textContent=state.down==null?"—":pct(state.down);
    $("upBar").style.width=state.up==null?"0":Math.min(100,state.up*100)+"%";
    $("downBar").style.width=state.down==null?"0":Math.min(100,state.down*100)+"%";
    $("kalshiNote").textContent="Live Kalshi public market data • "+(m.volume_fp??m.volume??0)+" volume";
    calculateSignal();
  }catch(e){
    $("kalshiNote").textContent="Kalshi feed unavailable: "+e.message;
  }
}

function calculateSignal(){
  if(state.price==null || state.target==null) return;
  const recent=state.samples.filter(x=>x.t>Date.now()-5*60*1000).map(x=>x.p);
  if(recent.length<20){
    $("signal").textContent="COLLECTING";
    $("reason").textContent="Collecting enough live BTC observations…";
    return;
  }

  const first=recent[0], last=recent[recent.length-1];
  const momentum=last/first-1;
  const distance=(last-state.target)/state.target;

  // Baseline probability model. It is intentionally conservative and will
  // later be replaced/tuned using historical Kalshi backtesting.
  let pUp=.5 + Math.tanh(momentum*1200)*.10 + Math.tanh(distance*300)*.18;
  pUp=Math.max(.05,Math.min(.95,pUp));
  const pDown=1-pUp;

  const marketUp=state.up ?? .5, marketDown=state.down ?? .5;
  const edgeUp=pUp-marketUp, edgeDown=pDown-marketDown;

  let sig="NO TRADE", prob=Math.max(pUp,pDown), edge=Math.max(edgeUp,edgeDown);
  let reason="No sufficiently large model edge.";

  if(edgeUp>=.10 && pUp>=.62){
    sig="BUY UP"; prob=pUp; edge=edgeUp; reason="BTC momentum + position versus Kalshi target.";
  }else if(edgeDown>=.10 && pDown>=.62){
    sig="BUY DOWN"; prob=pDown; edge=edgeDown; reason="BTC momentum + position versus Kalshi target.";
  }

  $("signal").textContent=sig;
  $("modelProb").textContent=pct(prob);
  $("marketProb").textContent=pct(sig==="BUY DOWN"?marketDown:marketUp);
  $("edge").textContent=(edge*100).toFixed(1)+" pts";
  $("confidence").textContent=(prob*100).toFixed(0)+"% confidence";
  $("reason").textContent=reason;
}

function renderLogs(){
  const body=$("log"); body.innerHTML="";
  state.logs.slice(0,30).forEach(x=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${new Date(x.t).toLocaleTimeString()}</td><td>${x.s}</td><td>${pct(x.p)}</td><td>${pct(x.m)}</td><td>${(x.e*100).toFixed(1)} pts</td><td>${x.r||"PENDING"}</td>`;
    body.appendChild(tr);
  });
  $("signals").textContent=state.logs.length;
  const done=state.logs.filter(x=>x.r==="WIN"||x.r==="LOSS");
  const wins=done.filter(x=>x.r==="WIN").length;
  $("wins").textContent=wins; $("losses").textContent=done.length-wins;
  $("winrate").textContent=done.length?(wins/done.length*100).toFixed(1)+"%":"—";
}

setInterval(()=>{
  if(state.marketEnd){
    const s=Math.max(0,Math.floor((state.marketEnd-Date.now())/1000));
    $("timer").textContent=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
  }
},250);

setInterval(getKalshi,2000);
window.addEventListener("resize",drawChart);
renderLogs();
connectCoinbase();
getKalshi();
