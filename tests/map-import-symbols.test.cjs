'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const importSrc=fs.readFileSync(path.join(root,'gis-service-import.js'),'utf8');
const symbolSrc=fs.readFileSync(path.join(root,'gis-point-symbols.js'),'utf8');

class Node{
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.value='';this.style={};this.listeners={};
  this.className='';this.disabled=false;this.checked=false;this.attributes={};
  const c=new Set();this.classList={add:k=>c.add(k),remove:k=>c.delete(k),contains:k=>c.has(k)};
 }
 appendChild(node){this.children.push(node);node.parentNode=this;return node;}
 replaceChildren(...nodes){this.children=[];nodes.forEach(n=>this.appendChild(n));}
 prepend(node){this.children.unshift(node);node.parentNode=this;}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(type,fn){this.listeners[type]=fn;}
 querySelector(selector){
  const cls=selector.startsWith('.')?selector.slice(1):null;
  function find(node){for(const ch of node.children){if(cls&&ch.className.split(/\s+/).includes(cls))return ch;const hit=find(ch);if(hit)return hit;}return null;}
  return find(this);
 }
}
function env(readMeta,addLayer){
 const window={GISMapStudio:{api:{
  baseService(url){const u=new URL(url),m=u.pathname.match(/^(.*\/(?:FeatureServer|MapServer))(?:\/(\d+))?$/);
   if(!m||u.protocol!=='https:')return null;
   return{root:u.origin+m[1],url:u.origin+u.pathname,layerId:m[2]===undefined?null:Number(m[2])};
  },
  readMeta,addLayer
 },getState:()=>({notice:new Node('span')})}};
 const document={createElement:tag=>new Node(tag)};
 vm.runInNewContext(importSrc,{window,document,URL}, {filename:'gis-service-import.js'});
 return {picker:window.GISServiceImport,document};
}
const URL_ROOT='https://services.arcgis.com/demo/arcgis/rest/services/Assets/FeatureServer';

test('single-layer public service is added directly, not merely browsed',async()=>{
 const added=[];
 const e=env(async()=>({layers:[{id:0,name:'Water Meters',type:'Feature Layer'}]}),
  async(s,url)=>{added.push(url);return{name:'Water Meters'};});
 const host=new Node('section');
 const s={layers:[]};
 const outcome=await e.picker.pick(s,URL_ROOT,host);
 assert.equal(outcome.status,'added');
 assert.deepEqual(added,[URL_ROOT+'/0']);
 assert.match(host.querySelector('.ms-import-status').textContent,/Added Water Meters/);
});

test('multi-layer service shows in-place checkbox picker and adds selected sublayers',async()=>{
 const added=[];
 const meta={layers:[
  {id:0,name:'Mainlines',type:'Feature Layer',defaultVisibility:true},
  {id:1,name:'Hydrants',type:'Feature Layer',defaultVisibility:true},
  {id:2,name:'Private table',type:'Table'},
  {id:3,name:'Subgroup',type:'Group Layer',subLayerIds:[4]}
 ]};
 const e=env(async()=>meta,async(s,url)=>{added.push(url);return{name:url.split('/').pop()};});
 const host=new Node('div'),state={layers:[]};
 const outcome=await e.picker.pick(state,URL_ROOT,host);
 assert.equal(outcome.status,'choices');
 assert.equal(outcome.count,2);
 assert.equal(added.length,0,'no auto-add when there are multiple sublayers');
 const list=host.querySelector('.ms-import-list');
 assert.equal(list.children.length,2);
 assert.equal(list.children[0].children[0].checked,true);
 const actions=host.querySelector('.ms-import-actions');
 await actions.children[0].listeners.click();
 assert.deepEqual(added,[URL_ROOT+'/0',URL_ROOT+'/1']);
});

test('catalog metadata failures are reported inline with actionable message',async()=>{
 const e=env(async()=>{throw Error('CORS blocked');},async()=>null),host=new Node('section');
 const response=await e.picker.pick({layers:[]},URL_ROOT,host);
 assert.equal(response.status,'error');
 assert.match(host.querySelector('.ms-import-status').textContent,/CORS blocked/);
 assert.match(host.querySelector('.ms-import-status').textContent,/cross-origin/);
});

test('service chooser excludes tables and group layers',()=>{
 const e=env(async()=>({}),async()=>null);
 const list=e.picker.layerChoices({layers:[
  {id:0,name:'Points',type:'Feature Layer'},
  {id:1,name:'Groups',type:'Group Layer',subLayerIds:[3]},
  {id:2,name:'Table',type:'Table'},
  {id:3,name:'Lines',type:'Feature Layer'}
 ]});
 assert.deepEqual(Array.from(list.map(v=>v.id)),[0,3]);
});

function symbols(){
 const window={GISPowerTools:{themedColor:()=>null}};
 const document={createElement:tag=>new Node(tag),createElementNS:(uri,tag)=>new Node(tag)};
 vm.runInNewContext(symbolSrc,{window,document}, {filename:'gis-point-symbols.js'});
 return window.GISPointSymbols;
}
test('invalid SVG name is replaced with trusted path set and emoji stays text-only',()=>{
 const api=symbols();
 const v=api.validSymbol({type:'lucide',icon:'<svg onload=alert(1)>'});
 assert.equal(v.icon,'map-pin');
 const e=api.validSymbol({type:'emoji',emoji:'📍<script>alert(1)</script>'});
 assert.doesNotMatch(e.emoji,/[<>]/);
 const svg=api.symbolNode({style:{symbol:v,color:'#1464af',fill:'#3280bd',radius:8}});
 assert.equal(svg.children.length,1);
 assert.equal(svg.children[0].tag,'svg');
 assert.ok(svg.children[0].children.length>0);
 const em=api.symbolNode({style:{symbol:e,color:'#1464af',fill:'#3280bd',radius:8}});
 assert.equal(em.textContent,e.emoji);
 assert.equal(em.children.length,0);
});
test('Leaflet marker uses divIcon for SVG and emoji and circleMarker for circles',()=>{
 const api=symbols();
 const leaflet={marker:(p,o)=>({type:'marker',p,o}),divIcon:args=>args,circleMarker:(p,o)=>({type:'circle',p,o})};
 const layer={id:6,style:{radius:8,weight:2,opacity:.8,fillOpacity:.5,color:'#13689e',fill:'#1a87ba',symbol:{type:'lucide',icon:'droplets'}}};
 const svg=api.marker(leaflet,layer,{properties:{}},[29,-95]);
 assert.equal(svg.type,'marker');assert.equal(svg.o.icon.html.children[0].tag,'svg');
 layer.style.symbol={type:'emoji',emoji:'🚰'};
 assert.equal(api.marker(leaflet,layer,{},[29,-95]).type,'marker');
 layer.style.symbol={type:'circle'};
 assert.equal(api.marker(leaflet,layer,{},[29,-95]).type,'circle');
});
test('Map Studio integrates imports and preserves point symbols in layer style',()=>{
 const studio=fs.readFileSync(path.join(root,'gis-map-studio.js'),'utf8');
 const power=fs.readFileSync(path.join(root,'gis-power-tools.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(studio,/GISServiceImport\.pick\(s,target\.root/);
 assert.match(studio,/GISPointSymbols\.picker\(s,p,layer/);
 assert.match(studio,/GISPointSymbols\.marker\(L\(\),layer/);
 assert.match(studio,/symbol:window\.GISPointSymbols\?\.validSymbol/);
 assert.match(power,/GISServiceImport\.pick\(s,url,choices/);
 assert.ok(html.indexOf('gis-service-import.js')<html.indexOf('gis-map-studio.js'));
 assert.ok(html.indexOf('gis-point-symbols.js')<html.indexOf('gis-map-studio.js'));
});


test('symbol choice persists through Map Studio style normalization',()=>{
 const window={},document={createElement:tag=>new Node(tag),createElementNS:(uri,tag)=>new Node(tag)};
 const sandbox={window,document,URL,URLSearchParams,setTimeout,clearTimeout,console,fetch:()=>Promise.reject(Error('Offline'))};
 vm.runInNewContext(symbolSrc,sandbox,{filename:'gis-point-symbols.js'});
 const studio=fs.readFileSync(path.join(root,'gis-map-studio.js'),'utf8');
 vm.runInNewContext(studio,sandbox,{filename:'gis-map-studio.js'});
 const style=window.GISMapStudio.utils.validStyle({symbol:{type:'emoji',emoji:'🚰'},color:'#215d92'});
 assert.equal(style.symbol.type,'emoji');
 assert.equal(style.symbol.emoji,'🚰');
 const saved=window.GISMapStudio.utils.makeLayer('https://city.gov/arcgis/rest/services/Water/FeatureServer/0',
  {name:'Water hydrants',geometryType:'esriGeometryPoint',fields:[]},{style});
 assert.equal(saved.style.symbol.type,'emoji');
 assert.equal(saved.style.symbol.emoji,'🚰');
});
