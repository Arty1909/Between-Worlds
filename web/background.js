"use strict";
// Two decoded video layers overlap at the loop seam. Door shots never loop.
class WorldBackdrop {
  constructor(main,next,onFinish){
    this.main=main;this.next=next;this.onFinish=onFinish;this.id=null;this.serial=0;
    this.enabled=true;this.hidden=false;this.cinematic=false;this.holding=false;this.fading=false;this.pendingFade=false;
    this.timer=setInterval(()=>this.tick(),150);
    main.addEventListener('ended',()=>{if(this.cinematic)this.finish();else if(this.id!=='11')this.swap();});
    main.addEventListener('error',()=>{main.hidden=true;if(this.cinematic)this.finish();});
  }
  select(id,poster,source){
    if(this.id===id)return;
    this.serial++;this.id=id;this.cinematic=false;this.holding=false;this.fading=false;this.pendingFade=false;
    this.main.pause();this.next.pause();this.next.classList.remove('crossfade');this.next.hidden=true;
    document.getElementById('backdrop').style.backgroundImage=`url("${poster}")`;
    this.main.poster=poster;this.main.muted=this.next.muted=true;this.main.loop=false;
    this.source=source;
    // Release the previous decoder; only prepare the second layer near the loop seam.
    this.next.removeAttribute('src');this.next.load();this.next.preload='none';this.preparedNext=false;
    if(source){this.main.src=source;this.main.load();}
    else{this.main.removeAttribute('src');this.main.load();}
    this.configure(this.enabled,this.hidden);
  }
  configure(enabled,hidden){
    this.enabled=enabled;this.hidden=hidden;
    const moving=(enabled||this.cinematic)&&!hidden&&this.source&&(this.id!=='11'||this.cinematic)&&!this.holding;
    this.main.hidden=(!enabled&&!this.cinematic)||!this.source;
    if(moving)this.main.play().catch(()=>{});else this.main.pause();
    if(!moving){this.next.pause();if(!enabled)this.next.hidden=true;}
    else if(this.fading){this.next.hidden=false;this.next.play().catch(()=>{});}
  }
  tick(){
    const v=this.main;
    if(this.cinematic||this.id==='11'||!this.enabled||this.hidden||this.fading||this.pendingFade||v.paused||!Number.isFinite(v.duration)||v.duration<3)return;
    if(v.duration-v.currentTime<=4&&!this.preparedNext){this.next.preload='auto';this.next.src=this.source;this.next.load();this.preparedNext=true;}
    if(v.duration-v.currentTime<=1.45){
      const serial=this.serial;
      this.pendingFade=true;this.next.currentTime=0;this.next.hidden=false;
      this.next.play().then(()=>{
        if(serial!==this.serial)return;
        if(!this.hidden&&this.enabled){this.fading=true;this.next.classList.add('crossfade');}
        else{this.next.pause();this.next.hidden=true;}
      }).catch(()=>{}).finally(()=>{if(serial===this.serial)this.pendingFade=false;});
    }
  }
  swap(){
    if(!this.fading){this.main.currentTime=0;this.configure(this.enabled,this.hidden);return;}
    const serial=this.serial;
    const reveal=()=>{
      if(serial!==this.serial)return;
      this.next.style.transition='none';this.next.classList.remove('crossfade');this.next.hidden=true;this.next.pause();this.fading=false;
      void this.next.offsetWidth;this.next.style.transition='';this.configure(this.enabled,this.hidden);
    };
    this.main.addEventListener('seeked',reveal,{once:true});this.main.currentTime=this.next.currentTime;
  }
  begin(){
    this.cinematic=true;this.holding=false;this.main.currentTime=0;
    this.next.pause();this.next.hidden=true;this.fading=false;
    if(this.source){this.main.hidden=false;this.main.play().catch(()=>this.finish());}
    else this.finish();
  }
  finish(){if(!this.cinematic||this.holding)return;this.holding=true;this.main.pause();this.onFinish();}
  release(){this.cinematic=false;this.holding=this.id==='11';this.main.pause();}
}
window.WorldBackdrop=WorldBackdrop;
