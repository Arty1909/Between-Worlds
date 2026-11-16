const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Video{
 constructor(){this.listeners={};this.style={};this.classList={add(){},remove(){}};this.currentTime=0;this.duration=10;this.paused=true;this.loop=true;}
 addEventListener(key,fn,opts){(this.listeners[key]||=[]).push([fn,opts]);}
 emit(key){const list=this.listeners[key]||[];this.listeners[key]=list.filter(x=>!x[1]?.once);list.forEach(x=>x[0]());}
 play(){this.paused=false;this.playCalls=(this.playCalls||0)+1;return this.pendingPlay||Promise.resolve();}pause(){this.paused=true;}load(){}removeAttribute(name){delete this[name];}
}
const context={window:{},document:{getElementById(){return {style:{}};}},setInterval(){},Number};
vm.runInNewContext(fs.readFileSync('web/background.js','utf8'),context);
(async()=>{
 const a=new Video(),b=new Video();let completed=0;
 const player=new context.window.WorldBackdrop(a,b,()=>completed++);
 player.select('10','moon.jpg','clean.mp4');assert.equal(a.loop,false);assert.equal(a.muted,true);assert.equal(a.paused,false);
 a.currentTime=9;player.tick();await Promise.resolve();assert.equal(player.fading,true);assert.equal(b.paused,false);
 b.currentTime=1.2;a.emit('ended');assert.equal(a.currentTime,1.2);a.emit('seeked');assert.equal(player.fading,false);assert.equal(b.hidden,true);
 player.select('11','door.jpg','door.mp4');assert.equal(a.paused,true);
 player.begin();assert.equal(a.paused,false);
 player.configure(false,false);assert.equal(a.paused,false);assert.equal(completed,0,'disabling ambient animation cannot skip the door');
 player.configure(false,true);assert.equal(a.paused,true);assert.equal(completed,0,'hidden tab pauses without skipping');
 player.configure(false,false);assert.equal(a.paused,false);
 a.emit('ended');assert.equal(completed,1);assert.equal(player.holding,true);
 player.configure(true,false);assert.equal(a.paused,true,'hold last frame until explicit click');
 player.release();player.configure(true,false);assert.equal(a.paused,true,'door never loops');
 player.select('3','forest.jpg','forest.mp4');player.configure(true,true);assert.equal(a.paused,true);
 player.configure(false,false);assert.equal(a.hidden,true);assert.equal(b.hidden,true);
 player.select('4','river.jpg','river.mp4');player.configure(true,false);
 assert.equal(b.src,undefined,'second decoder is not loaded on entry');
 a.currentTime=6.2;player.tick();assert.equal(b.src,'river.mp4','prepare the second layer near the seam');
 let resolvePlay;b.pendingPlay=new Promise(resolve=>resolvePlay=resolve);
 const before=b.playCalls||0;a.currentTime=9;
 player.tick();player.tick();player.tick();
 assert.equal(b.playCalls,before+1,'only one pending play while decoder starts');
 player.select('7','ice.jpg','ice.mp4');resolvePlay();await Promise.resolve();await Promise.resolve();
 assert.equal(player.fading,false,'stale decode cannot fade over the next world');
 assert.equal(b.src,undefined,'old secondary video was released');
 console.log('Background: overlap, mute, one-shot door, hold, visibility and reduced animation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
