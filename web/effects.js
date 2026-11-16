"use strict";
// Quiet original procedural effects, independent of the musical score.
class WorldEffects {
  constructor(){this.context=null;this.enabled=false;this.hidden=false;this.world=null;this.volume=.2;this.timer=null;this.nodes=new Set();}
  async unlock(){
    if(!this.enabled||this.hidden)return;
    const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
    if(!this.context){this.context=new Context();this.master=this.context.createGain();this.master.connect(this.context.destination);}
    this.master.gain.value=this.volume;
    try{await this.context.resume();this.schedule();}catch(_){}
  }
  configure(world,enabled,volume){
    const changed=this.world!==world||this.enabled!==!!enabled;
    this.world=world;this.enabled=!!enabled;this.volume=Math.max(0,Math.min(1,volume));
    if(this.master)this.master.gain.setTargetAtTime(this.enabled?this.volume:0,this.context.currentTime,.3);
    if(changed){this.stop();if(this.context&&this.enabled)this.schedule();}
  }
  stop(){clearTimeout(this.timer);this.timer=null;for(const node of this.nodes){try{node.stop();}catch(_){}}this.nodes.clear();}
  visibility(hidden){this.hidden=hidden;if(hidden){this.stop();if(this.context)void this.context.suspend();}else if(this.enabled)void this.unlock();}
  schedule(){if(this.timer||!this.enabled||this.hidden||!this.context)return;this.timer=setTimeout(()=>{this.timer=null;this.play();this.schedule();},this.world==='2'?22000+Math.random()*14000:11000+Math.random()*10000);}
  play(){
    if(!this.context||!this.enabled||this.hidden)return;
    const c=this.context,dragon=this.world==='2',duration=dragon?3.4:2.3,buffer=c.createBuffer(1,Math.ceil(c.sampleRate*duration),c.sampleRate),data=buffer.getChannelData(0);
    let brown=0;
    for(let i=0;i<data.length;i++){const t=i/c.sampleRate;brown=(brown+.025*(Math.random()*2-1))/1.025;data[i]=brown*(dragon?.7:.34)+ (dragon?.07*Math.sin(2*Math.PI*(75*t-4*t*t))*(.65+.35*Math.sin(2*Math.PI*9*t)):0);}
    const source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();source.buffer=buffer;
    filter.type='lowpass';filter.frequency.value=dragon?380:['4','10'].includes(this.world)?650:this.world==='7'?230:1000;filter.Q.value=.45;
    const now=c.currentTime;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(1,now+.7);gain.gain.linearRampToValueAtTime(0,now+duration);
    source.connect(filter);filter.connect(gain);gain.connect(this.master);source.start();this.nodes.add(source);
    source.onended=()=>{this.nodes.delete(source);source.disconnect();filter.disconnect();gain.disconnect();};
  }
}
window.WorldEffects=WorldEffects;
