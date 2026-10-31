/* GIS Power Tools: public catalog discovery, thematic styles, exact bounded analysis and map annotations. */
(function(){
'use strict';
const LIMIT=3000;
function E(t,c,v){let n=document.createElement(t);if(c)n.className=c;if(v!==undefined)n.textContent=String(v);return n;}
function B(t,c,fn){let b=E('button',c,t);b.type='button';b.addEventListener('click',fn);return b;}
function A(p,...xs){xs.forEach(x=>{if(x)p.appendChild(x)});return p;}
function core(){return window.GISCore;}function api(){return window.GISMapStudio.api;}
function msg(p,t,cls){p.replaceChildren(E('p',cls||'gp-note',t));}
function safeURL(url){try{let u=new URL(url);return u.protocol==='https:'&&/\/rest\/services\/.+\/(?:FeatureServer|MapServer)(?:\/\d+)?$/i.test(u.pathname)?u.origin+u.pathname.replace(/\/+$/,''):null;}catch(e){return null;}}
function searchURL(query,page){let u=new URL('https://www.arcgis.com/sharing/rest/search');
 let q=String(query).replace(/[^\p{L}\p{N} ._-]/gu,' ').trim().slice(0,120);
 u.searchParams.set('f','json');u.searchParams.set('q',q+' AND access:public AND (type:"Feature Service" OR type:"Map Service")');
 u.searchParams.set('num','30');u.searchParams.set('start',String(page*30+1));
 u.searchParams.set('sortField','numviews');return u.href;
}
function discovery(s,p){
 A(p,E('h3','','Search public GIS data'),E('p','gp-note','Search publicly indexed ArcGIS Online services. This is not an index of all REST servers.'));
 let f=E('form','gp-search'),input=E('input','ms-input');input.type='search';input.maxLength=120;input.placeholder='e.g. Houston storm drains';input.value=s.discoverQuery||'';
 let go=B('Search','gp-primary');go.type='submit';A(f,input,go);
 let results=E('div','gp-results'),pages=E('div','gp-inline');A(p,f,results,pages);
 async function run(page){
  if(input.value.trim().length<2){msg(results,'Enter two or more characters.');return;}
  s.discoverQuery=input.value.trim();s.discoverPage=page;
  const id=s.discoverId=(s.discoverId||0)+1;
  go.disabled=true;msg(results,'Searching public GIS catalog…');pages.replaceChildren();
  try{
   let r=await fetch(searchURL(s.discoverQuery,page),{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer'});
   if(!r.ok)throw Error('HTTP '+r.status);
   let data=await r.json();if(data.error)throw Error(data.error.message||'Catalog error');
   if(id!==s.discoverId||s.panel!=='add')return;
   results.replaceChildren();
   (data.results||[]).forEach(item=>{
    let url=safeURL(item.url),row=E('div','gp-result');
    A(row,E('strong','',String(item.title||'Untitled').slice(0,150)),
      E('p','gp-note',String(item.owner||'Unknown publisher')+' · '+String(item.type||'')),
      E('p','gp-note',String(item.snippet||'').replace(/<[^>]*>/g,'').slice(0,170)));
    let actions=E('div','gp-inline'),choices=E('div','ms-import-result');
    const choose=async(forceChoose)=>{
     if(!url||!window.GISServiceImport){msg(choices,'Layer import is unavailable. Try Add URL.','gp-error');return;}
     const active=forceChoose?preview:add;
     active.disabled=true;
     try{await window.GISServiceImport.pick(s,url,choices,{forceChoose});}
     catch(e){msg(choices,'Unable to open service layers: '+e.message,'gp-error');}
     finally{active.disabled=false;}
    };
    let preview=B('Browse layers','gp-secondary',()=>choose(true));
    let add=B('Add to map','gp-primary',()=>choose(false));
    preview.disabled=add.disabled=!url;
    A(actions,preview,add);row.appendChild(actions);row.appendChild(choices);results.appendChild(row);
   });
   if(!data.results?.length)msg(results,'No indexed public services found. Try broader keywords or paste a service URL.');
   let total=Number(data.total)||0;
   let prev=B('Previous','gp-secondary',()=>run(page-1));prev.disabled=page===0;
   let next=B('Next','gp-secondary',()=>run(page+1));next.disabled=(page+1)*30>=total;
   A(pages,E('span','gp-note','Results '+(page*30+1)+'–'+(page*30+(data.results||[]).length)+' of '+total),prev,next);
  }catch(e){if(id===s.discoverId)msg(results,'Catalog unavailable: '+e.message+'. You can still paste a REST URL.','gp-error');}
  finally{if(id===s.discoverId)go.disabled=false;}
 }
 f.addEventListener('submit',e=>{e.preventDefault();run(0);});
}
const CATEGORY=['#2675af','#ed8d3b','#388b6b','#9466b1','#cb6070','#71892e','#317a8b','#b87947'];
const SCALE=['#dbeaf5','#aacce5','#76a9d1','#407eb5','#174f86'];
function themedColor(layer,feature){
 let t=layer.theme,v=feature?.properties?.[t?.field];
 if(!t||!t.field||t.mode==='single')return null;
 if(t.mode==='category'){let idx=(t.categories||[]).indexOf(String(v??'(null)'));return idx<0?'#acb8c4':CATEGORY[idx%CATEGORY.length];}
 if(t.mode==='numeric'){
  let n=Number(v);if(v==null||!Number.isFinite(n)||!(t.max>t.min))return '#acb8c4';
  return SCALE[Math.min(4,Math.max(0,Math.floor(5*(n-t.min)/(t.max-t.min))))];
 }
 return null;
}
function thematic(s,p,layer){
 if(!layer.features?.length)return;
 let box=E('section','gp-theme');
 A(box,E('h3','','Style by field'),E('p','gp-note','Thematic classes use currently loaded preview features.'));
 let kind=E('select','ms-select'),field=E('select','ms-select');
 [['single','Single symbol'],['category','Categories'],['numeric','Graduated color']].forEach(([v,n])=>{let o=E('option','',n);o.value=v;kind.appendChild(o);});
 let theme=layer.theme||{mode:'single',field:''};kind.value=theme.mode||'single';field.setAttribute('aria-label','Thematic style field');
 let legend=E('div','gp-legend');A(box,kind,field,legend);p.appendChild(box);
 function updateFields(){
  let fs=(layer.fields||[]).filter(f=>theme.mode==='numeric'?/Integer|Double|SmallInteger|Single|BigInteger/.test(f.type||''):!!f.name);
  field.replaceChildren();fs.forEach(f=>{let o=E('option','',f.alias||f.name);o.value=f.name;field.appendChild(o);});
  if(!fs.some(f=>f.name===theme.field))theme.field=fs[0]?.name||'';
  field.value=theme.field;field.disabled=theme.mode==='single';
 }
 function update(){
  let vals=(layer.features||[]).map(f=>f.properties?.[theme.field]).filter(v=>v!=null);
  if(theme.mode==='category'){
   let m=new Map();vals.forEach(v=>m.set(String(v),(m.get(String(v))||0)+1));
   theme.categories=[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
  }else if(theme.mode==='numeric'){
   let n=vals.map(Number).filter(Number.isFinite);
   theme.min=n.length?Math.min(...n):0;theme.max=n.length?Math.max(...n):0;
  }
  layer.theme=theme;legend.replaceChildren();
  function item(color,label){let row=E('div','gp-legend-row'),swatch=E('span','gp-swatch');swatch.style.backgroundColor=color;A(row,swatch,E('span','',label));legend.appendChild(row);}
  if(theme.mode==='category')theme.categories.forEach((x,i)=>item(CATEGORY[i],x));
  if(theme.mode==='numeric')for(let i=0;i<5;i++)item(SCALE[i],(theme.min+(theme.max-theme.min)*i/5).toFixed(1)+'–'+(theme.min+(theme.max-theme.min)*(i+1)/5).toFixed(1));
  api().renderFeatures(s,layer);
 }
 kind.addEventListener('change',()=>{theme.mode=kind.value;updateFields();update();});
 field.addEventListener('change',()=>{theme.field=field.value;update();});
 updateFields();update();
}
let turfLoading=null;
function turf(){
 if(window.turf?.buffer&&window.turf?.booleanIntersects)return Promise.resolve(window.turf);
 if(turfLoading)return turfLoading;
 turfLoading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src='https://cdn.jsdelivr.net/npm/@turf/turf@7.4.0/turf.min.js';
  script.async=true;
  script.onload=()=>{
   if(window.turf?.buffer&&window.turf?.booleanIntersects)resolve(window.turf);
   else reject(Error('The spatial engine did not initialize.'));
  };
  script.onerror=()=>reject(Error('Unable to load the spatial engine; check network access.'));
  document.head.appendChild(script);
 }).catch(e=>{turfLoading=null;throw e;});
 return turfLoading;
}
function download(json,name){
 let b=new Blob([JSON.stringify(json,null,2)],{type:'application/geo+json'}),u=URL.createObjectURL(b),a=document.createElement('a');
 a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1200);
}
function result(s,features,buffer){
 if(s.analysisLayer)s.map.removeLayer(s.analysisLayer);
 let group=window.L.featureGroup().addTo(s.map);
 if(buffer)window.L.geoJSON(buffer,{style:{color:'#2162a6',fillOpacity:.08,weight:2,dashArray:'6 4'}}).addTo(group);
 window.L.geoJSON({type:'FeatureCollection',features},{
  style:{color:'#e87e25',weight:4,fillOpacity:.15},
  pointToLayer:(f,ll)=>window.L.circleMarker(ll,{radius:7,color:'#e87e25',weight:3})
 }).addTo(group);
 s.analysisLayer=group;s.analysisResults={type:'FeatureCollection',features};
}
async function complete(s,layer,bbox){
 let args={where:api().layerWhere(s,layer),returnIdsOnly:'true',returnGeometry:'false',
  geometry:JSON.stringify({xmin:bbox[0],ymin:bbox[1],xmax:bbox[2],ymax:bbox[3],spatialReference:{wkid:4326}}),
  geometryType:'esriGeometryEnvelope',spatialRel:'esriSpatialRelIntersects',inSR:4326};
 let response=await api().queryServer(s,layer.url,args);
 if(response.exceededTransferLimit)throw Error('Server indicated a transfer limit. Exact analysis stopped.');
 if(!Array.isArray(response.objectIds))throw Error('Source does not support full ID retrieval. Exact analysis stopped.');
 let ids=response.objectIds;
 if(ids.length>LIMIT)throw Error(ids.length+' candidate features exceed the '+LIMIT+'-feature analysis limit. Narrow the area.');
 let out=[];
 for(let i=0;i<ids.length;i+=100){
  if(!s.host.isConnected||core().state.map!==s.map)throw Error('Map closed; analysis cancelled.');
  let page=await api().queryServer(s,layer.url,{objectIds:ids.slice(i,i+100).join(','),outFields:'*',returnGeometry:'true',outSR:4326});
  if(!Array.isArray(page.features)||page.exceededTransferLimit||page.features.length!==Math.min(100,ids.length-i))
   throw Error('Incomplete server response. No approximate analysis was reported.');
  for(let f of page.features){
   if(!f.geometry)throw Error('Missing feature geometry. Exact analysis stopped.');
   let geom=core().esriToGeoGeometry(f.geometry);
   if(!geom)throw Error('Unsupported or empty geometry in candidate set.');
   out.push({type:'Feature',geometry:geom,properties:f.attributes||{}});
  }
 }
 return out;
}
function analysis(s,p){
 A(p,E('h3','','Spatial analysis'),E('p','gp-note','Tap one source feature on the map; then select a target layer. Queries fetch every matched candidate ID, subject to a safety limit.'));
 let picked=s.pickedFeature;
 p.appendChild(E('p','gp-picked',picked?'Selected: '+picked.layer.name:'No source feature selected. Tap a map feature first.'));
 let form=E('form','gp-form'),target=E('select','ms-select'),operation=E('select','ms-select'),distance=E('input','ms-input'),units=E('select','ms-select');
 s.layers.filter(l=>l.visible).forEach(l=>{let o=E('option','',l.name);o.value=l.url;target.appendChild(o);});
 if(picked&&s.layers.some(l=>l!==picked.layer))target.value=s.layers.find(l=>l!==picked.layer).url;
 [['buffer','Select within buffer'],['intersect','Select intersecting'],['nearest','Nearest centroid within distance']].forEach(([v,n])=>{let o=E('option','',n);o.value=v;operation.appendChild(o);});
 distance.type='number';distance.min='1';distance.max='50000';distance.value='500';
 [['feet','feet'],['meters','meters'],['miles','miles']].forEach(([v,n])=>{let o=E('option','',n);o.value=v;units.appendChild(o);});
 function label(t,n){return A(E('label','gp-field'),E('span','',t),n);}
 A(form,label('Target layer',target),label('Operation',operation),label('Distance',distance),label('Units',units));
 let go=B('Run analysis','gp-primary');go.type='submit';form.appendChild(go);p.appendChild(form);
 let output=E('div','gp-analysis-results');p.appendChild(output);
 form.addEventListener('submit',async e=>{
  e.preventDefault();picked=s.pickedFeature;
  if(!picked?.feature?.geometry){msg(output,'Select a visible source feature by tapping it on the map.','gp-error');return;}
  let dest=s.layers.find(l=>l.url===target.value);if(!dest){msg(output,'Select a target layer.','gp-error');return;}
  let d=Number(distance.value);
  if(operation.value!=='intersect'&&(!Number.isFinite(d)||d<=0||d>50000)){msg(output,'Distance must be between 1 and 50,000.','gp-error');return;}
  go.disabled=true;msg(output,'Retrieving complete candidate records…');
  try{
   let t=await turf(),zone=operation.value==='intersect'?picked.feature:t.buffer(picked.feature,d,{units:units.value,steps:32});
   if(!zone)throw Error('Could not construct analysis geometry');
   let candidates=await complete(s,dest,t.bbox(zone));
   let matches=candidates.filter(f=>t.booleanIntersects(zone,f));
   if(operation.value==='nearest'&&matches.length){
    const center=t.centroid(picked.feature);
    matches.sort((a,b)=>t.distance(center,t.centroid(a),{units:units.value})-t.distance(center,t.centroid(b),{units:units.value}));
    matches=matches.slice(0,1);
   }
   result(s,matches,operation.value==='intersect'?null:zone);
   output.replaceChildren();
   A(output,E('strong','',matches.length+' matching features'),
     E('p','gp-note','Complete geometry check of '+candidates.length+' server candidates.'+(operation.value==='nearest'?' Nearest is centroid-based.':'')),
     B('Export GeoJSON','gp-secondary',()=>download(s.analysisResults,'gis-analysis.geojson')),
     B('Clear result','gp-secondary',()=>{s.map.removeLayer(s.analysisLayer);s.analysisLayer=null;s.analysisResults=null;msg(output,'Result cleared.');}));
  }catch(err){msg(output,err.message,'gp-error');}
  finally{go.disabled=false;}
 });
}
function drawLayer(s){
 if(s.annotationLayer)s.map.removeLayer(s.annotationLayer);
 s.annotationLayer=window.L.geoJSON({type:'FeatureCollection',features:s.annotations||[]},{
  style:{color:'#c14d2d',weight:3,fillOpacity:.16},
  pointToLayer:(f,ll)=>window.L.circleMarker(ll,{radius:6,color:'#ba4928',weight:2}),
  onEachFeature:(f,layer)=>{if(f.properties?.label)layer.bindTooltip(E('span','',f.properties.label),{permanent:true,direction:'top'});}
 }).addTo(s.map);
}
function annotateClick(s,e){
 if(!s.drawMode)return false;
 let point=[e.latlng.lng,e.latlng.lat];
 if(s.drawMode==='point'||s.drawMode==='text'){
  let text=s.drawMode==='text'?String(window.prompt('Annotation text:','')||'').slice(0,100):'';
  s.annotations.push({type:'Feature',geometry:{type:'Point',coordinates:point},properties:{label:text}});
  s.drawMode=null;drawLayer(s);api().renderPanel(s);return true;
 }
 s.drawPoints.push(point);api().renderPanel(s);return true;
}
function annotate(s,p){
 A(p,E('h3','','Draw & measure'),E('p','gp-note','Private, read-only map markup. Click map locations; finish multi-point shapes here.'));
 let tools=E('div','gp-inline');
 [['point','Point'],['line','Line'],['polygon','Polygon'],['text','Text']].forEach(([v,name])=>tools.appendChild(B(name,'gp-secondary'+(s.drawMode===v?' gp-active':''),()=>{
  s.drawMode=v;s.drawPoints=[];api().renderPanel(s);
 })));p.appendChild(tools);
 p.appendChild(E('p','gp-note',s.drawMode?'Drawing '+s.drawMode+': '+s.drawPoints.length+' point(s).':'Choose a tool.'));
 let actions=E('div','gp-inline');
 actions.appendChild(B('Finish shape','gp-primary',async()=>{
  let pts=s.drawPoints||[],mode=s.drawMode;
  if(!['line','polygon'].includes(mode)||pts.length<(mode==='line'?2:3))return;
  let geom=mode==='line'?{type:'LineString',coordinates:pts}:{type:'Polygon',coordinates:[[...pts,pts[0]]]};
  let t;
  try{t=await turf();}catch(e){if(s.notice){s.notice.textContent=e.message;s.notice.hidden=false;}return;}
  let distance=mode==='line'?Math.round(t.length(t.feature(geom),{units:'kilometers'})*1000)+' m':Math.round(t.area(t.feature(geom)))+' m²';
  s.annotations.push({type:'Feature',geometry:geom,properties:{label:distance}});
  s.drawMode=null;s.drawPoints=[];drawLayer(s);api().renderPanel(s);
 }));
 actions.appendChild(B('Cancel','gp-secondary',()=>{s.drawMode=null;s.drawPoints=[];api().renderPanel(s);}));
 p.appendChild(actions);
 let manage=E('div','gp-inline');
 manage.appendChild(B('Undo','gp-secondary',()=>{s.annotations.pop();drawLayer(s);api().renderPanel(s);}));
 manage.appendChild(B('Export notes','gp-secondary',()=>download({type:'FeatureCollection',features:s.annotations},'annotations.geojson')));
 manage.appendChild(B('Clear','gp-secondary',()=>{if(window.confirm('Clear annotations?')){s.annotations=[];drawLayer(s);api().renderPanel(s);}}));
 A(p,E('p','gp-note',(s.annotations||[]).length+' annotations in this map.'),manage);
}
function onPick(s,l,f){s.pickedFeature={layer:l,feature:f};if(s.panel==='analyze')api().renderPanel(s);}
function attach(s){s.annotations=[];s.drawMode=null;s.drawPoints=[];}
window.GISPowerTools={discovery,thematic,analysis,annotate,annotateClick,onPick,attach,drawLayer,themedColor,
 utils:{safeURL,searchURL,LIMIT}};
})();
