"use strict";
class CameraModel {
  constructor(){this.zoom=1.12;this.x=0;this.y=0;}
  clamp(){this.zoom=Math.max(1.04,Math.min(1.85,this.zoom));const limit=(this.zoom-1)/2-.012;this.x=Math.max(-limit,Math.min(limit,this.x));this.y=Math.max(-limit,Math.min(limit,this.y));}
  move(x,y){this.x+=x;this.y+=y;this.clamp();}
  scale(value){this.zoom=value;this.clamp();}
  preset(name){this.zoom=name==='wide'?1.04:name==='center'?1.12:1.4;this.x=name==='left'?.15:name==='right'?-.15:0;this.y=0;this.clamp();}
}
class WorldCamera {
  constructor(){
    this.model=new CameraModel();this.world=null;this.views=new Map();this.drag=null;
    this.pad=document.getElementById('camera-dragpad');this.slider=document.getElementById('camera-zoom');
    document.querySelectorAll('[data-camera]').forEach(b=>b.onclick=()=>{this.model.preset(b.dataset.camera);this.apply();});
    this.slider.oninput=()=>{this.model.scale(Number(this.slider.value)/100);this.apply();};
    this.pad.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};this.pad.setPointerCapture(e.pointerId);this.pad.classList.add('dragging');});
    this.pad.addEventListener('pointermove',e=>{if(!this.drag||e.pointerId!==this.drag.id)return;this.model.move((e.clientX-this.drag.x)/innerWidth,(e.clientY-this.drag.y)/innerHeight);this.drag.x=e.clientX;this.drag.y=e.clientY;this.apply();});
    const release=()=>{this.drag=null;this.pad.classList.remove('dragging');};
    this.pad.addEventListener('pointerup',release);this.pad.addEventListener('pointercancel',release);this.pad.addEventListener('lostpointercapture',release);
    this.pad.addEventListener('wheel',e=>{e.preventDefault();this.model.scale(this.model.zoom-e.deltaY*.0006);this.apply();},{passive:false});
    this.pad.addEventListener('keydown',e=>{
      const shifts={ArrowLeft:[.035,0],ArrowRight:[-.035,0],ArrowUp:[0,.035],ArrowDown:[0,-.035]};
      if(shifts[e.key]){e.preventDefault();e.stopPropagation();this.model.move(...shifts[e.key]);this.apply();}
      else if(['+','=','-','0'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='0')this.model.preset('center');else this.model.scale(this.model.zoom+(e.key==='-'?-.08:.08));this.apply();}
    });
    window.addEventListener('resize',()=>this.apply());this.apply();
  }
  selectWorld(world){
    if(world===this.world)return;
    if(this.world)this.views.set(this.world,{...this.model});
    this.world=world;this.model=new CameraModel();Object.assign(this.model,this.views.get(world)||{});this.apply();
  }
  apply(){
    this.model.clamp();const root=document.documentElement.style;
    root.setProperty('--camera-x',`${this.model.x*innerWidth}px`);root.setProperty('--camera-y',`${this.model.y*innerHeight}px`);root.setProperty('--camera-scale',String(this.model.zoom));
    root.setProperty('--actor-pan-x',`${this.model.x*innerWidth*.14}px`);root.setProperty('--actor-pan-y',`${this.model.y*innerHeight*.1}px`);
    this.slider.value=Math.round(this.model.zoom*100);document.getElementById('camera-value').textContent=Math.round(this.model.zoom*100)+'%';
  }
}
window.CameraModel=CameraModel;window.WorldCamera=WorldCamera;
