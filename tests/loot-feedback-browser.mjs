import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchRun } from './helpers/start-run.mjs';

mkdirSync('shots',{recursive:true});
const site=process.env.RIFT_URL||'http://localhost:8000/';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--mute-audio']});
try {
  const page=await browser.newPage(); await page.setViewport({width:1440,height:900});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.evaluateOnNewDocument(()=>{
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket {
      constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',event=>{
        const type=JSON.parse(event.data).type;if(type==='update'||type==='full-reload')event.stopImmediatePropagation();
      });}
    };
  });
  await page.goto(site,{waitUntil:'domcontentloaded',timeout:120000});
  try { await page.waitForFunction(()=>window.RIFT&&!document.getElementById('launchBtn').disabled,{timeout:30000}); }
  catch { throw new Error(`Game failed to boot: ${errors.join(' | ')||'no browser exception reported'}`); }
  await launchRun(page);
  await page.waitForFunction(()=>window.RIFT.running&&document.getElementById('titleScreen').classList.contains('hidden'),{timeout:30000});
  const result=await page.evaluate(()=>{
    const g=window.RIFT; g.enemies.clear(); g.clearHazards(); g.scrap.reset();
    g.scrap.burst(g.player.x+12,g.player.y,-18,100,1,{sourceId:'visual-glow'}); g.scrap.update(.2,0);
    g.scrap.burst(g.player.x,g.player.y,0,40,0,{sourceId:'visual-pickup',bundle:true});
    g.scrap.update(.1,0); g.hud.update(.1);
    g.paused=true;
    const pickup=document.getElementById('scrapPickup'), active=g.scrap.pool.filter(piece=>piece.active);
    return {wallet:g.scrap.wallet.balance,pickup:pickup.textContent,hidden:pickup.hidden,
      haloOpacity:g.scrap.halos.material.opacity,halos:g.scrap.halos.count,
      maxScale:Math.max(...active.map(piece=>piece.sp.scale.x)),reduced:g.scrap.reducedMotion};
  });
  assert.deepEqual({wallet:result.wallet,pickup:result.pickup,hidden:result.hidden},{wallet:40,pickup:'+40 SCRAP',hidden:false});
  assert.ok(result.haloOpacity>=.34&&result.halos>0&&result.maxScale>1,'Physical loot has a bright pulsing halo');
  await new Promise(resolve=>setTimeout(resolve,160));
  const pickupView=await page.$eval('#scrapPickup',element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return {
    opacity:Number(style.opacity),display:style.display,color:style.color,hidden:element.hidden,text:element.textContent,
    rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};});
  assert.ok(pickupView.opacity>.5&&pickupView.rect.width>30&&pickupView.rect.height>8,
    `Pickup indicator is visibly readable: ${JSON.stringify(pickupView)}`);
  await page.screenshot({path:'shots/loot-feedback.png'});

  const reduced=await browser.newPage(); await reduced.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await reduced.goto(site,{waitUntil:'domcontentloaded',timeout:120000});
  await reduced.waitForFunction(()=>window.RIFT,{timeout:120000});
  assert.equal(await reduced.evaluate(()=>window.RIFT.scrap.reducedMotion),true,'Reduced-motion preference selects the slow glow');
  console.log('PASS: exact +SCRAP browser feedback, bright pooled halo, screenshot, and reduced-motion glow selection.');
} finally { await browser.close(); }
