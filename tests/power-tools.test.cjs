'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const base=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(base,'gis-power-tools.js'),'utf8');
function tools(){
 const window={};
 vm.runInNewContext(code,{window,URL,URLSearchParams,console,setTimeout,clearTimeout},{filename:'gis-power-tools.js'});
 return window.GISPowerTools;
}
test('public catalog search uses HTTPS and public Feature/Map service types',()=>{
 const p=tools();
 const u=new URL(p.utils.searchURL('Houston storm drain',1));
 assert.equal(u.origin,'https://www.arcgis.com');
 assert.equal(u.pathname,'/sharing/rest/search');
 assert.equal(u.searchParams.get('start'),'31');
 assert.match(u.searchParams.get('q'),/access:public/);
 assert.match(u.searchParams.get('q'),/Feature Service/);
 assert.match(u.searchParams.get('q'),/Map Service/);
});
test('only HTTPS ArcGIS REST layer and service URLs can be added',()=>{
 const valid=tools().utils.safeURL;
 assert.equal(valid('https://example.gov/arcgis/rest/services/GIS/FeatureServer/0'),
  'https://example.gov/arcgis/rest/services/GIS/FeatureServer/0');
 assert.equal(valid('https://example.gov/arcgis/rest/services/GIS/MapServer'),
  'https://example.gov/arcgis/rest/services/GIS/MapServer');
 assert.equal(valid('http://example.gov/arcgis/rest/services/GIS/FeatureServer/0'),null);
 assert.equal(valid('https://example.gov/secret/data'),null);
 assert.equal(valid('javascript:alert(1)'),null);
});
test('thematic rendering handles category, number and missing data',()=>{
 const color=tools().themedColor;
 const layer={theme:{mode:'category',field:'MATERIAL',categories:['PVC','DIP']}};
 assert.notEqual(color(layer,{properties:{MATERIAL:'PVC'}}),color(layer,{properties:{MATERIAL:'DIP'}}));
 assert.equal(color(layer,{properties:{MATERIAL:'Unknown'}}),'#acb8c4');
 layer.theme={mode:'numeric',field:'DIAMETER',min:4,max:24};
 assert.notEqual(color(layer,{properties:{DIAMETER:6}}),color(layer,{properties:{DIAMETER:22}}));
 assert.equal(color(layer,{properties:{DIAMETER:null}}),'#acb8c4');
});
test('geoprocessing never treats a truncated feature page as exact',()=>{
 const t=fs.readFileSync(path.join(base,'gis-power-tools.js'),'utf8');
 assert.match(t,/returnIdsOnly:'true'/);
 assert.match(t,/if\(ids.length>LIMIT\)throw Error/);
 assert.match(t,/page\.exceededTransferLimit/);
 assert.match(t,/page\.features\.length!==Math\.min/);
 assert.match(t,/if\(!f\.geometry\)throw Error/);
 assert.equal(tools().utils.LIMIT,3000);
});
test('power tools are wired into the layer manager without replacing auth',()=>{
 const studio=fs.readFileSync(path.join(base,'gis-map-studio.js'),'utf8');
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 assert.match(studio,/window\.GISPowerTools\.discovery\(s,body\)/);
 assert.match(studio,/window\.GISPowerTools\.thematic\(s,p,layer\)/);
 assert.match(studio,/window\.GISPowerTools\.analysis\(s,s\.panelContent\)/);
 assert.match(studio,/window\.GISPowerTools\.annotateClick\(s,event\)/);
 assert.match(studio,/gis\.miniup-project/);
 assert.match(studio,/window\.GISPowerTools\.drawLayer\(s\)/);
 assert.ok(html.indexOf('gis-power-tools.js')<html.indexOf('gis-map-studio.js'));
 assert.match(t, /@turf\/turf@7\.4\.0/);
 assert.doesNotMatch(html, /<script[^>]+@turf\/turf/);
});
