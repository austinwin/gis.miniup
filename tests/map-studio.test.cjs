'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','gis-map-studio.js'),'utf8');

function loadModule(custom={}){
 const window=Object.assign({},custom);
 const document={createElement:()=>({}),head:{appendChild(){}}};
 vm.runInNewContext(source,{window,document,localStorage:{getItem:()=>null,setItem(){}},
  URL,URLSearchParams,fetch:()=>Promise.reject(Error('No network in test')),
  setTimeout,clearTimeout,console},{filename:'gis-map-studio.js'});
 return window.GISMapStudio;
}

test('parses valid ArcGIS layer and service URLs',()=>{
 const {baseService}=loadModule().utils;
 const feature=baseService('https://city.gov/arcgis/rest/services/Water/FeatureServer/0?f=pjson');
 assert.equal(feature.layerId,0);
 assert.equal(feature.serviceType,'FeatureServer');
 assert.equal(feature.root,'https://city.gov/arcgis/rest/services/Water/FeatureServer');
 const service=baseService('https://city.gov/arcgis/rest/services/Water/MapServer');
 assert.equal(service.layerId,null);
 assert.equal(service.serviceType,'MapServer');
 assert.equal(baseService('http://city.gov/arcgis/rest/services/Water/MapServer/0'),null);
 assert.equal(baseService('https://city.gov/MapServer/0'),null);
 assert.equal(baseService('javascript:alert(1)'),null);
});

test('sanitizes styles and bounds visual controls',()=>{
 const {validStyle}=loadModule().utils;
 const a=validStyle({color:'evil',fill:'#123456',radius:99,weight:-4,opacity:12,fillOpacity:3,dash:'unknown'});
 assert.equal(a.color,'#1976b9');
 assert.equal(a.fill,'#123456');
 assert.equal(a.radius,16);
 assert.equal(a.weight,1);
 assert.equal(a.opacity,1);
 assert.equal(a.fillOpacity,.9);
 assert.equal(a.dash,'solid');
});

test('restores independent layer options without storing features',()=>{
 const {makeLayer}=loadModule().utils;
 const info={name:'Meters',geometryType:'esriGeometryPoint',fields:[{name:'STATUS'}]};
 const layer=makeLayer('https://city.gov/arcgis/rest/services/Meters/FeatureServer/0',info,{
  visible:false,where:"STATUS = 'Active'",pointMode:'clusters',labelField:'STATUS',labelVisible:true,opacity:.6,
  style:{color:'#123456',fill:'#abcdef',radius:9}
 });
 assert.equal(layer.name,'Meters');
 assert.equal(layer.visible,false);
 assert.equal(layer.where,"STATUS = 'Active'");
 assert.equal(layer.pointMode,'clusters');
 assert.equal(layer.labelField,'STATUS');
 assert.equal(layer.labelVisible,true);
 assert.equal(layer.style.radius,9);
 assert.equal(layer.opacity,.6);
 assert.equal(layer.features,null);
});

test('Map Studio offers distinct basemaps including OpenFreeMap',()=>{
 const names=Object.keys(loadModule().utils.BASEMAPS);
 for(const name of ['streets','satellite','osm','openfree'])assert.ok(names.includes(name));
});

class FakeNode{
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};
  this.listeners={};this.hidden=false;this.isConnected=true;
  this.value='';this.textContent='';
  const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:(c,on)=>{if(on===undefined)on=!classes.has(c);on?classes.add(c):classes.delete(c);return on;},contains:c=>classes.has(c)};
 }
 appendChild(c){this.children.push(c);return c;}
 replaceChildren(...c){this.children=c;}
 setAttribute(key,value){this[key]=value;}
 addEventListener(event,listener){this.listeners[event]=listener;}
 querySelector(){return null;}
}
function fakeLeaflet(){
 const panes=new Map();
 const map={
  on(){},off(){},remove(){},removeLayer(){},fitBounds(){},invalidateSize(){},
  getPane:name=>panes.get(name),
  createPane:name=>{const pane={style:{}};panes.set(name,pane);return pane;},
  getBounds:()=>({getWest:()=>-95.4,getEast:()=>-95.3,getSouth:()=>29.7,getNorth:()=>29.8}),
  getSize:()=>({x:800,y:500}),getZoom:()=>10,getCenter:()=>({lat:29.76,lng:-95.37}),
  getContainer:()=>new FakeNode('div'),
  setView(){return this;}
 };
 const shape=()=>({addTo(){return this;},on(){return this;},bindTooltip(){return this;},getBounds(){return{pad(){return this;}}}});
 return {map:()=>map,tileLayer:shape,geoJSON:shape,circleMarker:shape,point:(x,y)=>({x,y}),
  latLng:(lat,lng)=>({lat,lng}),latLngBounds:()=>({}),
  CRS:{EPSG3857:{unproject:()=>({lat:29.7,lng:-95.3}),project:()=>({x:1,y:2})}},
  _map:map};
}

test('mobile opens a map-first workspace and loads the current feature layer',async()=>{
 const leaflet=fakeLeaflet();
 const state={root:'https://city.gov/arcgis/rest/services',
  url:'https://city.gov/arcgis/rest/services/Meters/FeatureServer/0',
  data:{name:'Meters',geometryType:'esriGeometryPoint',
   extent:{xmin:-95.4,xmax:-95.3,ymin:29.7,ymax:29.8,spatialReference:{wkid:4326}}}};
 const core={state,scopedToken:()=>'',jsonUrl:u=>u+'?f=pjson',
  read:async()=>({name:'Meters',geometryType:'esriGeometryPoint',fields:[{name:'NAME',type:'esriFieldTypeString'}]}),
  post:async()=>({features:[{geometry:{x:-95.35,y:29.75},attributes:{OBJECTID:123,NAME:'Station'}}]}),
  esriToGeoGeometry:g=>({type:'Point',coordinates:[g.x,g.y]})};
 const window={L:leaflet,GISCore:core,innerWidth:390};
 const document={createElement:tag=>new FakeNode(tag),head:new FakeNode('head')};
 const sandbox={window,document,localStorage:{getItem:()=>null,setItem(){}},
  URL,URLSearchParams,setTimeout:()=>1,clearTimeout(){},console,fetch};
 vm.runInNewContext(source,sandbox,{filename:'gis-map-studio.js'});
 const mount=window.GISMapStudio;
 const container=new FakeNode('main');
 mount.mount(container);
 for(let i=0;i<30;i++)await Promise.resolve();
 const mapState=mount.getState();
 assert.equal(mapState.map,leaflet._map);
 assert.equal(state.map,leaflet._map);
 assert.equal(mapState.sidebar.hidden,true);
 assert.equal(mapState.layers.length,1);
 assert.equal(mapState.layers[0].name,'Meters');
 assert.equal(mapState.layers[0].loaded,true);
 assert.equal(mapState.layers[0].count,1);
 // Both toolbar buttons open the same panel, with correct section and a visible X.
 assert.equal(mapState.sidebar.children[0].children[1].textContent,'×');
 assert.equal(mapState.sidebar.children[0].children[1]['aria-label'],'Close layer panel');
 assert.equal(mapState.addButton['aria-expanded'],'false');
 mapState.addButton.listeners.click();
 assert.equal(mapState.sidebar.hidden,false);
 assert.equal(mapState.panel,'add');
 assert.equal(mapState.panelHeading.textContent,'Add layers');
 assert.equal(mapState.addButton['aria-expanded'],'true');
 // "Layers" changes panels instead of unexpectedly closing Add.
 mapState.layersButton.listeners.click();
 assert.equal(mapState.panel,'layers');
 assert.equal(mapState.sidebar.hidden,false);
 assert.equal(mapState.panelHeading.textContent,'Layers');
 mapState.sidebar.children[0].children[1].listeners.click();
 assert.equal(mapState.sidebar.hidden,true);
 assert.equal(mapState.layersButton['aria-expanded'],'false');
 assert.equal(mapState.addButton['aria-expanded'],'false');
 mapState.layersButton.listeners.click();
 assert.equal(mapState.sidebar.hidden,false);
 assert.equal(mapState.panel,'layers');
 mapState.layersButton.listeners.click();
 assert.equal(mapState.sidebar.hidden,true);
 // Only two compact floating controls remain on the canvas.
 const float=mapState.mapwrap.children.find(node=>node.children?.some(x=>x.tag==='details'));
 assert.ok(float,'Floating map toolbar should exist');
 assert.equal(float.children.length,2);
 assert.equal(float.children[0].textContent,'Fit');
 assert.equal(float.children[1].children[0].textContent,'Tools');
 mount.cleanup();
 assert.equal(state.map,null);
});

test('navigation More menu sits above map and Map Studio controls',()=>{
 const css=fs.readFileSync(path.join(__dirname,'..','gis-map-studio.css'),'utf8');
 assert.match(css,/#tabs:has\(\.gx-more-tabs\)\s*\{[^}]*z-index:\s*1200/s);
 assert.match(css,/\.ms-topbar\s*\{[^}]*z-index:\s*30/s);
 assert.match(css,/\.ms-panel-header\s*\{/);
 assert.match(css,/\.ms-panel-close\s*\{/);
 assert.match(css,/\.ms-map-tools-menu\s*\{/);
});
