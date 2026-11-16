"use strict";
// Offline dictionaries only. Canonical story state and save data are never translated.
window.I18n=(()=>{
 const languages={en:'English',ru:'Русский',es:'Español',it:'Italiano',fr:'Français'};
 const base=new URL('locales/',document.currentScript.src);
 const normalize=s=>s.replace(/\s+/g,' ').trim();
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const originals=new WeakMap(),cache=new Map();
 let language='en',dictionary={},fragments=null,templates=[],request=0,observer;
 let protectedNames=new Set();
 try{const saved=localStorage.getItem('between-worlds-language');if(languages[saved])language=saved;}catch{}
 function compile(data){
  dictionary={...data};templates=[];
  for(const [source,target] of Object.entries(data)){
   if(source.length<80&&!dictionary[source.toLocaleLowerCase()])dictionary[source.toLocaleLowerCase()]=target.charAt(0).toLocaleLowerCase()+target.slice(1);
   if(/\{(?:name|companion)\}/.test(source)){
    const parts=source.split(/(\{(?:name|companion)\})/g),names=[];
    const pattern=parts.map(p=>{if(/^\{/.test(p)){names.push(p.slice(1,-1));return '(.+?)';}return escape(p);}).join('');
    templates.push({pattern:new RegExp('^'+pattern+'$','u'),names,target});
   }
  }
  const keys=Object.keys(dictionary).filter(k=>k.length>2&&!k.includes('{')).sort((a,b)=>b.length-a.length);
  fragments=new RegExp('(?<![\\p{L}\\p{N}])(?:'+keys.map(escape).join('|')+')(?![\\p{L}\\p{N}])','gu');
 }
 function t(value){
  const source=String(value??'');if(language==='ru'||!fragments||!/[А-Яа-яЁё]/.test(source))return source;
  const key=normalize(source);if(protectedNames.has(key))return source;
  let translated=dictionary[key];
  if(translated===undefined){
   for(const template of templates){
    const match=key.match(template.pattern);if(!match)continue;
    translated=template.target;
    template.names.forEach((name,i)=>{translated=translated.replaceAll('{'+name+'}',name==='name'?match[i+1]:t(match[i+1]));});break;
   }
  }
  if(translated===undefined){
   // Mixed labels (chapter numbers, stat effects, timestamps) share the same catalogue.
   const held=[];let safe=key;
   for(const name of protectedNames)if(name)safe=safe.replaceAll(name,()=>{held.push(name);return `\uE000${held.length-1}\uE001`;});
   translated=safe.replace(fragments,match=>dictionary[match]);
   translated=translated.replace(/\uE000(\d+)\uE001/g,(_,i)=>held[Number(i)]);
  }
  return source.match(/^\s*/)[0]+translated+source.match(/\s*$/)[0];
 }
 function localizeValue(node,key,current,set){
  let record=originals.get(node);if(!record){record={};originals.set(node,record);}
  const previous=record[key];const source=previous&&current===previous.last?previous.source:current;
  const translated=t(source);record[key]={source,last:translated};if(current!==translated)set(translated);
 }
 function dom(root=document.body){
  if(!root)return;
  const visit=node=>{
   const element=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
   if(!element||element.closest('script,style,noscript,[data-no-i18n],#dialogue'))return;
   if(node.nodeType===Node.TEXT_NODE){localizeValue(node,'text',node.nodeValue,v=>node.nodeValue=v);return;}
   if(node.nodeType!==Node.ELEMENT_NODE)return;
   for(const attr of ['aria-label','title','placeholder','alt'])if(node.hasAttribute(attr))localizeValue(node,attr,node.getAttribute(attr),v=>node.setAttribute(attr,v));
  };
  visit(root);
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  while(walker.nextNode())visit(walker.currentNode);
 }
 async function change(next){
  if(!languages[next])throw Error('Unsupported language');
  const serial=++request;
  if(!cache.has(next)){
   const response=await fetch(new URL(next+'.json?v=4.5',base));
   if(!response.ok)throw Error('Language file unavailable');
   const data=await response.json();if(!data||typeof data!=='object'||!Object.keys(data).length)throw Error('Empty language dictionary');
   cache.set(next,data);
  }
  if(serial!==request)return false;
  compile(cache.get(next));language=next;document.documentElement.lang=next;
  document.title=t('Между мирами — Осколки ключа');
  try{localStorage.setItem('between-worlds-language',next);}catch{}
  dom();return true;
 }
 async function init(){
  await change(language);
  observer=new MutationObserver(records=>{
   const roots=new Set();
   for(const record of records){
    if(record.type==='childList')record.addedNodes.forEach(n=>roots.add(n));else roots.add(record.target);
   }
   for(const root of roots)if(root.isConnected)dom(root);
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title','placeholder','alt']});
  document.documentElement.dataset.languageReady='true';
 }
 return {languages,t,dom,change,init,get language(){return language;},context(view){protectedNames=new Set([view?.name,...(view?.slots||[]).map(s=>s.name)].filter(Boolean));}};
})();
