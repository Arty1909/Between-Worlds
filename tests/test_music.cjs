// No npm packages: exercise the real music controller with a deterministic audio clock.
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
let requests=[],sources=[],errors=0;
class Param {
  constructor(){this.value=0;this.events=[];}
  setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);}
  setTargetAtTime(v,t,d){this.value=v;this.events.push(['target',v,t,d]);}
  linearRampToValueAtTime(v,t){this.value=v;this.events.push(['ramp',v,t]);}
  cancelAndHoldAtTime(t){this.events.push(['hold',t]);}
}
class Context {
  constructor(){this.currentTime=10;this.state='suspended';this.destination={};}
  createGain(){return {gain:new Param(),connect(){},disconnect(){}};}
  createBufferSource(){const s={connect(){},disconnect(){},start(t){this.started=t;},stop(t){this.stopped=t;}};sources.push(s);return s;}
  async resume(){this.state='running';}
  async suspend(){this.state='suspended';}
  async decodeAudioData(x){return {decoded:x};}
}
const sandbox={window:{AudioContext:Context},fetch:url=>new Promise(resolve=>requests.push({url,resolve}))};
vm.runInNewContext(readFileSync(path.join(__dirname,'../web/music.js'),'utf8'),sandbox);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deliver=i=>requests[i].resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});
(async()=>{
  const music=new sandbox.window.WorldMusic(()=>errors++);
  music.configure('3',false,.3);await music.unlock();assert.equal(music.context,null);
  music.configure('3',true,.3);const boot=music.unlock();await tick();
  assert.equal(requests.length,1);deliver(0);await boot;
  assert.equal(music.current.track,'3');assert.equal(sources[0].loop,true);
  for(let i=0;i<10;i++)music.configure('3',true,.3);
  assert.equal(requests.length,1);assert.equal(sources.length,1,'dialogue must not restart score');
  music.configure('4',true,.3);music.configure('7',true,.3);
  deliver(2);await tick();deliver(1);await tick();
  assert.equal(music.current.track,'7','stale downloads must not replace current world');
  assert.equal(sources.length,2);assert.equal(sources[0].stopped,11.55);
  music.configure('7',false,.3);assert.equal(music.master.gain.value,0);
  music.configure('7',true,.6);assert.equal(music.master.gain.value,.6);
  assert.equal(sources.length,2,'mute must preserve position');
  await music.visibility(true);assert.equal(music.context.state,'suspended');
  music.configure('10',true,.6);assert.equal(requests.length,3);
  const shown=music.visibility(false);await tick();deliver(3);await shown;
  assert.equal(music.current.track,'10');
  music.configure('3',true,.6);await tick();assert.equal(requests.length,4,'decoded tracks should be cached');
  assert.equal(music.current.track,'3');
  music.configure('9',true,.6);requests[4].resolve({ok:false});await tick();
  assert.equal(errors,1);assert.equal(music.current.track,'3','failed load keeps previous score');
  console.log('PASS: gesture, loop, no restart, crossfade, race, mute, volume, visibility, cache, missing file');
})().catch(error=>{console.error(error);process.exitCode=1;});
