const $ = id => document.getElementById(id);

const state = {
  price: null, previous: null, samples: [], target: null,
  up: null, down: null, marketId: null, marketEnd: null,
  lastSignal: "WAITING", logs: JSON.parse(localStorage.getItem("btcSignalLogs") || "[]")
};

function money(n){ return n == null || !isFinite(n) ? "—" : "$" + Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function pct(n){ return n == null || !isFinite(n) ? "—" : (n*100).toFixed(1)+"%"; }

function drawChart(){
  const c=$("chart"), ctx=c.getContext("2d"), dpr=devicePixelRatio||1, w=c.clientWidth, h=c.height;
  c.width=w*dpr; c.height=h*dpr; ctx.scale(dpr,dpr); ctx.clearRect(0,0,w,h);
  if(state.samples.length<2) return;
  const vals=state.samples.map(x=>x.p), min=Math.min(...vals), max=Math.max(...vals), pad=(max-min)||1;
  ctx.beginPath();
  state.samples.forEach((x,i)=>{
    const px=i*(w/(state.samples.length-1)), py=h-20-((x.p-min)/pad)*(h-35);
    i?ctx.lineTo(px,py):ctx.moveTo(px,py);
  });
  ctx.strokeStyle="#7dd3fc";ctx.lineWidth=2;ctx.stroke();
}

function setStatus(text, ok=false){$("status").innerHTML=`<span style="background:${ok?"#62d58a":"#f0b429"}"></span>${text}`;}

function updatePrice(p){
  state.previous=state.price; state.price=p; state.samples.push({t:Date.now(),p});
  const cutoff=Date.now()-20*60*1000; state.samples=state.samples.filter(x=>x.t>=cutoff);
  $("btcPrice").textContent=money(p);
  if(state.previous){
    const ch=(p/state.previous)-1; $("btcChange").textContent=(ch>=0?"+":"")+pct(ch)+" since last tick";
  }
  $("sampleCount").textContent=state.samples.length+" samples";
  drawChart(); calculateSignal();
}

function connectBinance(){
  const ws=new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");
  ws.onopen=()=>setStatus("BTC live",true);
  ws.onmessage=e=>{try{const d=JSON.parse(e.data);updatePrice(Number(d.p))}catch{}};
  ws.onclose=()=>{setStatus("BTC reconnecting…");setTimeout(connectBinance,3000)};
  ws.onerror=()=>ws.close();
}

async function getKalshi(){
  // Public market endpoint. Browser CORS availability can vary.
  try{
    const r=await fetch("https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXBTC15M&status=open&limit=5");
    if(!r.ok) throw new Error("HTTP "+r.status);
    const data=await r.json();
    const markets=data.markets||[];
    if(!markets.length) throw new Error("No open BTC 15M market found");
    const m=markets[0]; state.marketId=m.ticker;
    state.target=Number(m.floor_strike||m.strike_price||m.floor_strike_dollars||0);
    state.up=(m.yes_ask_dollars!=null?Number(m.yes_ask_dollars):m.yes_ask!=null?Number(m.yes_ask)/100:null);
    state.down=(m.no_ask_dollars!=null?Number(m.no_ask_dollars):m.no_ask!=null?Number(m.no_ask)/100:null);
    state.marketEnd=m.close_time?new Date(m.close_time).getTime():null;
    $("marketId").textContent=m.ticker;
    $("targetPrice").textContent=money(state.target);
    $("upPrice").textContent=state.up==null?"—":pct(state.up);
    $("downPrice").textContent=state.down==null?"—":pct(state.down);
    $("upBar").style.width=state.up==null?"0":Math.min(100,state.up*100)+"%";
    $("downBar").style.width=state.down==null?"0":Math.min(100,state.down*100)+"%";
    $("kalshiNote").textContent="Live Kalshi public market data.";
    calculateSignal();
  }catch(e){
    $("kalshiNote").textContent="Kalshi public endpoint unavailable from this browser right now. BTC signal still runs in observation mode.";
  }
}

function calculateSignal(){
  if(state.price==null) return;
  // Conservative baseline model. It intentionally refuses to signal without enough evidence.
  const recent=state.samples.filter(x=>x.t>Date.now()-5*60*1000).map(x=>x.p);
  if(recent.length<20 || !state.target){ $("signal").textContent="COLLECTING"; return; }
  const first=recent[0], last=recent[recent.length-1];
  const momentum=(last/first)-1;
  const distance=(last-state.target)/state.target;
  const vol=Math.sqrt(recent.reduce((s,p)=>s+Math.pow((p/last)-1,2),0)/recent.length);
  let pUp=.5 + Math.tanh(momentum*1200)*.10 + Math.tanh(distance*300)*.18;
  // Avoid false precision.
  pUp=Math.max(.05,Math.min(.95,pUp));
  const pDown=1-pUp;
  const marketUp=state.up ?? .5, marketDown=state.down ?? .5;
  const edgeUp=pUp-marketUp, edgeDown=pDown-marketDown;
  let sig="NO TRADE", prob=Math.max(pUp,pDown), edge=Math.max(edgeUp,edgeDown), reason="Edge too small";
  if(edgeUp>=.10 && pUp>=.62){sig="BUY UP";reason="Momentum + target position";prob=pUp;edge=edgeUp}
  else if(edgeDown>=.10 && pDown>=.62){sig="BUY DOWN";reason="Momentum + target position";prob=pDown;edge=edgeDown}
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
  const done=state.logs.filter(x=>x.r==="WIN"||x.r==="LOSS"), wins=done.filter(x=>x.r==="WIN").length;
  $("wins").textContent=wins;$("losses").textContent=done.length-wins;
  $("winrate").textContent=done.length?(wins/done.length*100).toFixed(1)+"%":"—";
}

setInterval(()=>{ if(state.marketEnd){let s=Math.max(0,Math.floor((state.marketEnd-Date.now())/1000));$("timer").textContent=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")} },500);
setInterval(getKalshi,5000);
window.addEventListener("resize",drawChart);
renderLogs();connectBinance();getKalshi();
