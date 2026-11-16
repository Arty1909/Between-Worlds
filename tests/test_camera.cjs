const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={window:{}};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../web/camera.js'),'utf8'),context);
const camera=new context.window.CameraModel();
for(const zoom of [-100,1,1.4,2,100])for(const dx of [-10,.5,10]){
  camera.scale(zoom);camera.move(dx,-dx);
  assert(camera.zoom>=1.04&&camera.zoom<=1.85);
  assert(Math.abs(camera.x)<=(camera.zoom-1)/2);
  assert(Math.abs(camera.y)<=(camera.zoom-1)/2);
}
camera.preset('left');assert(camera.x>0);camera.preset('right');assert(camera.x<0);
camera.preset('center');assert.equal(camera.x,0);assert.equal(camera.zoom,1.12);
camera.preset('wide');assert.equal(camera.zoom,1.04);
console.log('PASS: camera scale bounds, safe pan, presets, reset');
