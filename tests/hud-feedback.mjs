import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUD, HUD_NOTICE_DURATIONS } from '../src/ui/HUD.js';

const classSet = () => {
  const values = new Set();
  return { add(...names){names.forEach(name=>values.add(name));},remove(...names){names.forEach(name=>values.delete(name));},
    contains(name){return values.has(name);},toggle(name,on){on?values.add(name):values.delete(name);} };
};
const element = () => ({ textContent:'',className:'',dataset:{},hidden:false,offsetWidth:100,
  classList:classSet(),style:{setProperty(){},color:'',textShadow:''},remove(){
    if (!this.parentElement) return; const i=this.parentElement.children.indexOf(this);
    if(i>=0)this.parentElement.children.splice(i,1); this.parentElement=null;
  },setAttribute(){},innerHTML:'' });
const container = element(); container.children=[]; container.appendChild = child => { child.parentElement=container;container.children.push(child); };
Object.defineProperty(container,'firstChild',{get(){return this.children[0]||null;}});
global.document = { createElement:element };

const hud = Object.create(HUD.prototype);
hud.game={running:true,scrap:{wallet:{balance:0}}}; hud._toastItems=[]; hud._bannerLife=0; hud._pickupAmount=0; hud._pickupLife=0;
hud.el={hud:element(),banner:element(),toasts:container,scrap:element()}; hud.scrapPickupEl=element();

hud.banner('LEARN TO MOVE','#27f5da',{category:'instruction'});
assert.equal(hud._bannerLife,HUD_NOTICE_DURATIONS.instruction);
hud._updateNotices(4.9); assert.equal(hud.el.banner.classList.contains('show'),true,'Instruction remains after brief notices expire');
hud._updateNotices(.11); assert.equal(hud.el.banner.classList.contains('show'),false,'Instruction expires on game time');

hud.toast('MOVE','WASD OR LEFT STICK','#27f5da',{category:'instruction'});
const first=container.firstChild;
hud.toast('FIRE','SPACE OR RT','#27f5da',{category:'instruction',duration:6});
assert.equal(first.parentElement,null,'New tutorial step predictably replaces the old instruction');
assert.equal(container.children.length,1); assert.equal(hud._toastItems[0].remaining,6);
hud._updateNotices(5.9); assert.equal(container.children.length,1);
hud._updateNotices(.11); assert.equal(container.children.length,0);

// Title/results do not tick HUD game time. Their instructional notices get a
// bounded wall fallback instead of remaining over the menu indefinitely.
const nativeSetTimeout=global.setTimeout,nativeClearTimeout=global.clearTimeout;
let wallCallback=null,wallDelay=0;
global.setTimeout=(callback,delay)=>{wallCallback=callback;wallDelay=delay;return 77;};
global.clearTimeout=()=>{};
hud.game.running=false;
hud.toast('FIRST FLIGHT ARMED','Begins next run','#27f5da',{category:'instruction',duration:4.2});
assert.equal(wallDelay,4200); assert.equal(container.children.length,1);
wallCallback(); assert.equal(container.children.length,0); assert.equal(hud._toastItems.length,0);
global.setTimeout=nativeSetTimeout; global.clearTimeout=nativeClearTimeout; hud.game.running=true;

hud.scrapPickup(3,{balance:3}); hud.scrapPickup(4,{balance:7});
assert.equal(hud.scrapPickupEl.textContent,'+7 SCRAP','Rapid fragments combine into one exact indicator');
assert.equal(hud.el.scrap.textContent,'7','Wallet display updates synchronously');
hud._updateNotices(.91); assert.equal(hud.scrapPickupEl.hidden,true); assert.equal(hud._pickupAmount,0);

const directorSource=readFileSync(new URL('../src/core/LevelDirector.js',import.meta.url),'utf8');
const escapeSource=readFileSync(new URL('../src/encounters/FinalEscape.js',import.meta.url),'utf8');
for(const cue of ['LASER GATE INBOUND','TREASURE POCKET']){
  const start=directorSource.indexOf(`'${cue}'`); assert.ok(start>=0,`${cue} exists`);
  assert.match(directorSource.slice(start,start+420),/category:\s*'instruction'/,`${cue} uses the long instructional lane`);
}
const collapse=escapeSource.indexOf("'REACH THE FINAL RIFT'");
assert.ok(collapse>=0); assert.match(escapeSource.slice(collapse,collapse+360),/category:\s*'instruction'/);

console.log('PASS: instruction notices use bounded game/wall time, critical route cues use the long lane, and pickup bursts combine exact credit.');
