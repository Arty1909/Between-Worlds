// Build-time only: use Node's bundled parser, with no production dependency.
const fs=require('node:fs'),vm=require('node:vm');
const moduleBox={exports:{}};
vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{exports:moduleBox.exports,module:moduleBox});
const values=new Set();
function walk(node){
 if(!node||typeof node!=='object')return;
 if(node.type==='Literal'&&typeof node.value==='string'&&/[А-Яа-яЁё]/.test(node.value))values.add(node.value);
 if(node.type==='TemplateElement'&&/[А-Яа-яЁё]/.test(node.value.cooked||''))values.add(node.value.cooked);
 for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
}
for(const file of ['app.js','arrivals.js','music.js'])walk(moduleBox.exports.parse(fs.readFileSync('web/'+file,'utf8'),{ecmaVersion:'latest'}));
fs.mkdirSync('.work/locales',{recursive:true});
fs.writeFileSync('.work/locales/ui-raw.json',JSON.stringify([...values],null,2));
