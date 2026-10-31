/* GIS Map Studio — read-only layer composer for ArcGIS REST, built on Leaflet.
   Stores only opt-in configuration; never persists tokens or feature payloads. */
(function(){
'use strict';
var workspaces=new Map(),session=null,SEQ=0,STORAGE='gis-map-studio-v1',MAX_LAYERS=16,MAX_FEATURES=500;
var glPromise=null;
function ensureMapLibre(){
 if(typeof L()?.maplibreGL==='function')return Promise.resolve();
 if(!glPromise){
  var css=document.createElement('link');css.rel='stylesheet';css.href='https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css';
  document.head.appendChild(css);
  function script(url){return new Promise((resolve,reject)=>{
   var tag=document.createElement('script');tag.src=url;tag.async=true;
   tag.onload=resolve;tag.onerror=()=>reject(Error('Unable to load MapLibre.'));
   document.head.appendChild(tag);
  });}
  glPromise=script('https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js')
   .then(()=>script('https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.1.4/dist/leaflet-maplibre-gl.js'))
   .then(()=>{if(typeof L()?.maplibreGL!=='function')throw Error('MapLibre Leaflet adapter was not available.');});
 }
 return glPromise;
}
var BASEMAPS={
 streets:{name:'Esri Streets',type:'tile',url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',attribution:'Tiles &copy; Esri'},
 satellite:{name:'Esri Imagery',type:'tile',url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',attribution:'Tiles &copy; Esri'},
 osm:{name:'OpenStreetMap',type:'tile',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attribution:'&copy; OpenStreetMap contributors',maxZoom:19},
 openfree:{name:'OpenFreeMap Liberty',type:'vector',style:'https://tiles.openfreemap.org/styles/liberty',attribution:'OpenFreeMap &copy; OpenMapTiles &copy; OpenStreetMap'}
};
function C(){return window.GISCore;}
function L(){return window.L;}
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function add(parent){for(var i=1;i<arguments.length;i++)if(arguments[i])parent.appendChild(arguments[i]);return parent;}
function btn(label,cls,fn,title){var b=el('button',cls,label);b.type='button';if(fn)b.addEventListener('click',fn);if(title)b.title=title;return b;}
function fmt(n){return Number(n).toLocaleString();}
function safeColor(value,fallback){return /^#[0-9a-f]{6}$/i.test(String(value))?String(value):fallback;}
function baseService(url){var u;try{u=new URL(url);}catch(e){return null;}
 if(u.protocol!=='https:')return null;
 var p=u.pathname.replace(/\/+$/,'');var m=p.match(/^(.*\/(?:MapServer|FeatureServer))(?:\/(\d+))?$/i);
 if(!m||!(/\/rest\/services\//i.test(p)))return null;
 return {root:u.origin+m[1],url:u.origin+p,layerId:m[2]===undefined?null:Number(m[2]),serviceType:/\/FeatureServer$/i.test(m[1])?'FeatureServer':'MapServer'};
}
function isRoot(url){try{return /^https:\/\//.test(url)&&/\/rest\/services(?:\/.*)?$/i.test(new URL(url).pathname)}catch(e){return false;}}
function sameRoot(a,b){try{
 var x=new URL(a),y=new URL(b);
 var prefix=p=>p.pathname.replace(/\/rest\/services(?:\/.*)?$/i,'/rest/services');
 return x.origin===y.origin&&prefix(x)===prefix(y);
}catch(e){return false;}}
function labelFor(field){return field.alias||field.name;}
function validStyle(raw){
 var d=raw||{};
 return {color:safeColor(d.color,'#1976b9'),fill:safeColor(d.fill,'#40a0db'),
  weight:Math.max(1,Math.min(12,Number(d.weight)||2)),radius:Math.max(3,Math.min(16,Number(d.radius)||6)),
  opacity:Math.max(.1,Math.min(1,Number(d.opacity)||.85)),
  fillOpacity:Math.max(0,Math.min(.9,Number(d.fillOpacity)===0?0:Number(d.fillOpacity)||.25)),
  dash:['solid','dash','dot'].includes(d.dash)?d.dash:'solid'};
}
function makeLayer(url,meta,previous){
 return {id:++SEQ,url,name:meta.name||('Layer '+meta.id),geom:meta.geometryType||'',fields:meta.fields||[],
  extent:meta.extent||meta.fullExtent||null,where:String(previous?.where||'1=1').slice(0,500),visible:previous?.visible!==false,
  style:validStyle(previous?.style),pointMode:['points','clusters','heat'].includes(previous?.pointMode)?previous.pointMode:'points',
  labelField:previous?.labelField||'',labelVisible:!!previous?.labelVisible,
  count:0,partial:false,error:'',loaded:false,sequence:0,render:null,features:null,drawMode:'vector',
  imageUrl:null,opacity:previous?.opacity===undefined?1:Math.max(.1,Math.min(1,Number(previous.opacity)||1))};
}
function persistConfig(s){
 return {basemap:s.basemap,layers:s.layers.map(x=>({url:x.url,visible:x.visible,style:x.style,pointMode:x.pointMode,
 labelField:x.labelField,labelVisible:x.labelVisible,where:x.where,opacity:x.opacity})),zoom:s.map?.getZoom(),center:s.map?.getCenter()};
}
function readSaved(key){try{
 var obj=JSON.parse(localStorage.getItem(STORAGE)||'{}');return obj[key]||null;
}catch(e){return null;}}
function writeSaved(key,value){try{
 var obj=JSON.parse(localStorage.getItem(STORAGE)||'{}');obj[key]=value;
 localStorage.setItem(STORAGE,JSON.stringify(obj));return true;
}catch(e){return false;}}
function clearSaved(key){try{
 var obj=JSON.parse(localStorage.getItem(STORAGE)||'{}');delete obj[key];
 localStorage.setItem(STORAGE,JSON.stringify(obj));return true;
}catch(e){return false;}}
function hostError(e){return e?.message||String(e);}
function notice(s,msg,error){if(!s?.notice)return;s.notice.textContent=msg;s.notice.classList.toggle('ms-error',!!error);s.notice.hidden=!msg;}
function isCurrent(s){return session===s&&C().state.map===s.map&&s.host.isConnected;}
function normalizeUrl(input){var meta=baseService(String(input||'').trim());if(!meta)throw Error('Use an HTTPS ArcGIS REST FeatureServer or MapServer layer URL.');return meta;}
async function readMeta(s,url){
 var parsed=new URL(url);
 if(parsed.protocol!=='https:')throw Error('HTTPS is required.');
 var j=C().jsonUrl(parsed.href);
 return C().read(j);
}
async function queryServer(s,url,p){
 var meta=normalizeUrl(url);
 var endpoint=meta.url+'/query';
 if(sameRoot(endpoint,C().state.root||C().state.url))return C().post(endpoint,p);
 // Public external services are supported without sending the connected server's token.
 var form=new URLSearchParams();Object.keys(p).forEach(k=>{if(p[k]!==undefined&&p[k]!==null)form.set(k,String(p[k]));});
 form.set('f','json');
 var response=await fetch(endpoint,{method:'POST',mode:'cors',credentials:'omit',
   redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',body:form});
 if(!response.ok)throw Error('External layer HTTP '+response.status);
 var data=await response.json();
 if(data.error)throw Error(data.error.message||'ArcGIS query failed');
 return data;
}
async function getImage(s,layer,p){
 var service=normalizeUrl(layer.url).root,token=C().scopedToken(service+'/export');
 var form=new URLSearchParams();
 Object.entries(p).forEach(([k,v])=>form.set(k,String(v)));
 if(token)form.set('token',token);
 var result=await fetch(service+'/export',{method:'POST',mode:'cors',credentials:'omit',
  redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',body:form});
 if(!result.ok)throw Error('MapServer image HTTP '+result.status);
 if(!/^image\//i.test(result.headers.get('content-type')||''))throw Error('MapServer did not return an image');
 return URL.createObjectURL(await result.blob());
}
function setBasemap(s,name){
 if(!BASEMAPS[name])name='streets';
 if(BASEMAPS[name].type==='vector'&&typeof L().maplibreGL!=='function'){
   s.basemap=name;
   if(s.basemapControl)s.basemapControl.value=name;
   notice(s,'Loading OpenFreeMap vector basemap…');
   ensureMapLibre().then(()=>{
     if(isCurrent(s)&&s.basemap===name){notice(s,'');setBasemap(s,name);}
   }).catch(err=>{
     if(isCurrent(s)&&s.basemap===name){
       setBasemap(s,'streets');notice(s,'OpenFreeMap unavailable: '+hostError(err),true);
     }
   });
   return;
 }
 if(s.baseLayer)s.map.removeLayer(s.baseLayer);
 s.basemap=name;
 var spec=BASEMAPS[name];
 if(spec.type==='vector'){
  if(typeof L().maplibreGL==='function'){
   try{s.baseLayer=L().maplibreGL({style:spec.style}).addTo(s.map);}
   catch(e){notice(s,'OpenFreeMap could not start on this device; using Streets.',true);setBasemap(s,'streets');return;}
  }else{notice(s,'OpenFreeMap needs WebGL and its map adapter; switched to Streets.',true);setBasemap(s,'streets');return;}
 }else{s.baseLayer=L().tileLayer(spec.url,{maxZoom:spec.maxZoom||19,attribution:spec.attribution}).addTo(s.map);}
 if(s.basemapControl)s.basemapControl.value=s.basemap;
}
function viewBounds(s){var b=s.map.getBounds();return {west:b.getWest(),east:b.getEast(),south:b.getSouth(),north:b.getNorth()};}
function toEnvelope(b){return JSON.stringify({xmin:b.west,ymin:b.south,xmax:b.east,ymax:b.north,spatialReference:{wkid:4326}});}
function focusedLayer(s){
 return s.layers.find(l=>l.url===C().state.url)||s.layers[0]||null;
}
function applyArea(s,b){
 var current=focusedLayer(s);
 if(!current||current.url!==C().state.url||!window.GISEnhancements){
  notice(s,'Open the matching layer in Explore to use map-area selection for its table.',true);return;
 }
 var model=window.GISEnhancements.getModel();
 model.spatial={west:b.west,east:b.east,south:b.south,north:b.north};
 model.page=0;model.ids=null;model.count=null;
 notice(s,'Map area selected. The Explore table will use this area.');
 window.GISEnhancements.loadCount(model);
 refresh(s);
}
function clearArea(s){
 if(s.areaRect){s.map.removeLayer(s.areaRect);s.areaRect=null;}
 if(!window.GISEnhancements)return;
 var layer=focusedLayer(s);
 if(layer?.url!==C().state.url)return;
 var model=window.GISEnhancements.getModel();
 model.spatial=null;model.page=0;model.ids=null;model.count=null;
 window.GISEnhancements.loadCount(model);
 refresh(s);
}
function setDrawing(s,active){
 s.drawing=active;s.drawFirst=null;
 s.map.getContainer().style.cursor=active?'crosshair':'';
 if(s.drawButton)s.drawButton.textContent=active?'Cancel drawing':'Draw selection box';
 if(s.mapTools){
  var summary=s.mapTools.querySelector('summary');
  if(summary)summary.textContent=active?'Drawing…':'Tools';
 }
 if(active)notice(s,'Tap two opposite corners on the map to filter records.');
 else notice(s,'');
}
function startFocus(s){
 if(s.focusDone)return;
 var ids=C().state.focusOids?.slice(0,50)||null,where=C().state.focusWhere;
 var source=s.layers.find(l=>l.url===C().state.url);
 if(!source||(!ids?.length&&!where))return;
 s.focusDone=true;
 var p={outFields:'*',returnGeometry:'true',outSR:4326,resultRecordCount:ids?.length||250};
 if(ids?.length)p.objectIds=ids.join(',');
 else{
  p.where=where;
  if(C().state.focusBBox){
   var b=C().state.focusBBox;
   p.geometry=toEnvelope(b);p.geometryType='esriGeometryEnvelope';p.inSR=4326;
  }
 }
 queryServer(s,source.url,p).then(result=>{
  if(!isCurrent(s))return;
  var features=(result.features||[]).map(f=>{
   try{return {type:'Feature',geometry:C().esriToGeoGeometry(f.geometry),properties:f.attributes||{}};}catch(e){return null;}
  }).filter(Boolean);
  if(!features.length)return;
  s.focusLayer=L().geoJSON({type:'FeatureCollection',features},{
   style:{color:'#f18716',weight:4,fillOpacity:.15},
   pointToLayer:(f,ll)=>L().circleMarker(ll,{radius:10,color:'#f18716',weight:3,fillOpacity:.1})
  }).addTo(s.map);
  try{s.map.fitBounds(s.focusLayer.getBounds().pad(.22),{maxZoom:17});}catch(e){}
 }).catch(e=>{if(isCurrent(s))notice(s,'Selection highlight unavailable: '+hostError(e),true);});
}
function layerWhere(s,layer){
 var own=String(layer.where||'1=1').trim()||'1=1';
 if(layer.url===C().state.url&&window.GISEnhancements){
  try{
   var current=window.GISEnhancements.buildWhere(window.GISEnhancements.getModel());
   return current==='1=1'?own:'('+current+') AND ('+own+')';
  }catch(e){return own;}
 }
 return own;
}
function clearRender(s,layer){
 layer.sequence++;
 if(layer.render){try{s.map.removeLayer(layer.render);}catch(e){}layer.render=null;}
 if(layer.imageUrl){URL.revokeObjectURL(layer.imageUrl);layer.imageUrl=null;}
}
function paneName(layer){return 'ms-data-'+layer.id;}
function assignPanes(s){
 s.layers.forEach((layer,index)=>{
  var pane=s.map.getPane(paneName(layer))||s.map.createPane(paneName(layer));
  pane.style.zIndex=420+(s.layers.length-index)*10;pane.style.pointerEvents='auto';
 });
}
function rawGeometry(point){return point?.geometry&&point.geometry.type?point.geometry:null;}
function htmlValue(value){return value===null||value===undefined?'—':typeof value==='object'?JSON.stringify(value):String(value);}
function selectedProps(s,layer,feature){
 var attrs=feature.properties||{},panel=s.detail;
 panel.replaceChildren();
 var head=el('div','ms-detail-head');
 add(head,el('strong','',layer.name),btn('Close','ms-small',()=>{panel.hidden=true;s.mapwrap.classList.remove('ms-inspecting');}));
 panel.appendChild(head);
 var dl=el('dl','ms-detail-list');
 Object.entries(attrs).slice(0,80).forEach(([key,val])=>{
  var metadata=layer.fields.find(f=>f.name===key);
  var coded=metadata?.domain?.codedValues?.find(x=>String(x.code)===String(val));
  add(dl,el('dt','',metadata?labelFor(metadata):key),el('dd','',coded?coded.name:htmlValue(val)));
 });
 panel.appendChild(dl);
 add(panel,btn('Open attribute table','ms-primary',()=>C().navigate(layer.url)));
 panel.hidden=false;s.mapwrap.classList.add('ms-inspecting');
}
function featureTooltip(layer,feature,target){
 if(!layer.labelVisible||!layer.labelField)return;
 var value=(feature.properties||{})[layer.labelField];
 if(value===undefined||value===null||value==='')return;
 var span=el('span','',htmlValue(value).slice(0,120));
 target.bindTooltip(span,{permanent:true,direction:'center',className:'ms-feature-label',opacity:.9});
}
function vectorOpts(layer){
 var st=layer.style;
 return {pane:paneName(layer),color:st.color,fillColor:st.fill,weight:st.weight,
  opacity:st.opacity*layer.opacity,fillOpacity:st.fillOpacity*layer.opacity,
  dashArray:st.dash==='dash'?'8 5':st.dash==='dot'?'2 5':null};
}
function renderFeatures(s,layer){
 clearRender(s,layer);
 if(!layer.visible||!layer.features)return;
 var features=layer.features,geom=(layer.geom||'').toLowerCase(),opts=vectorOpts(layer);
 var pointLayer=geom==='esrigeometrypoint';
 if(pointLayer&&layer.pointMode==='heat'&&typeof L().heatLayer==='function'){
  var pts=[];
  features.forEach(f=>{var g=rawGeometry(f);if(g?.type==='Point')pts.push([g.coordinates[1],g.coordinates[0],.6]);});
  layer.render=L().heatLayer(pts,{pane:paneName(layer),radius:23,blur:16,maxZoom:15,minOpacity:.25}).addTo(s.map);
 }else if(pointLayer&&layer.pointMode==='clusters'&&typeof L().markerClusterGroup==='function'){
  var group=L().markerClusterGroup({chunkedLoading:true,showCoverageOnHover:false,maxClusterRadius:55,clusterPane:paneName(layer)});
  features.forEach(f=>{
   var g=rawGeometry(f);if(g?.type!=='Point')return;
   var icon=el('span','ms-cluster-symbol');icon.style.backgroundColor=layer.style.fill;
   icon.style.borderColor=layer.style.color;
   var marker=L().marker([g.coordinates[1],g.coordinates[0]],{
     icon:L().divIcon({html:icon,className:'ms-cluster-icon',iconSize:[20,20],iconAnchor:[10,10]}),
     pane:paneName(layer)});
   marker.on('click',()=>selectedProps(s,layer,f));featureTooltip(layer,f,marker);group.addLayer(marker);
  });
  layer.render=group.addTo(s.map);
 }else{
  layer.render=L().geoJSON({type:'FeatureCollection',features:features},{
   pane:paneName(layer),style:()=>vectorOpts(layer),
   pointToLayer:(f,latlng)=>L().circleMarker(latlng,Object.assign({},opts,{radius:layer.style.radius})),
   onEachFeature:(f,shape)=>{
    shape.on('click',ev=>{if(ev.originalEvent)L().DomEvent.stopPropagation(ev);selectedProps(s,layer,f);});
    featureTooltip(layer,f,shape);
   }
  }).addTo(s.map);
 }
 assignPanes(s);
}
function fitExtent(s,extent){
 if(!extent?.spatialReference)return false;
 var w=extent.spatialReference.latestWkid||extent.spatialReference.wkid;var a,b;
 try{
  if(w===4326||w===4269){a=L().latLng(extent.ymin,extent.xmin);b=L().latLng(extent.ymax,extent.xmax);}
  else if([3857,102100,102113].includes(w)){
   a=L().CRS.EPSG3857.unproject(L().point(extent.xmin,extent.ymin));
   b=L().CRS.EPSG3857.unproject(L().point(extent.xmax,extent.ymax));
  }else return false;
  if(!Number.isFinite(a.lat)||!Number.isFinite(b.lat))return false;
  s.map.fitBounds(L().latLngBounds(a,b),{padding:[25,25],maxZoom:14});return true;
 }catch(e){return false;}
}
async function renderImage(s,layer,version){
 var b=viewBounds(s),size=s.map.getSize(),sw=L().CRS.EPSG3857.project(L().latLng(b.south,b.west)),
  ne=L().CRS.EPSG3857.project(L().latLng(b.north,b.east));
 var p={bbox:[sw.x,sw.y,ne.x,ne.y].join(','),bboxSR:3857,imageSR:3857,
  size:Math.max(1,Math.round(size.x))+','+Math.max(1,Math.round(size.y)),
  layers:'show:'+normalizeUrl(layer.url).layerId,transparent:'true',format:'png32',f:'image'};
 var url=await getImage(s,layer,p);
 if(!isCurrent(s)||!layer.visible||version!==layer.sequence){URL.revokeObjectURL(url);return;}
 clearRender(s,layer);layer.sequence=version+1;
 layer.imageUrl=url;
 layer.render=L().imageOverlay(url,[[b.south,b.west],[b.north,b.east]],{
  pane:paneName(layer),opacity:layer.opacity}).addTo(s.map);
 layer.drawMode='image';
}
async function loadLayer(s,layer){
 if(!isCurrent(s)||!layer.visible)return;
 var version=++layer.sequence;
 if(!s.map.getPane(paneName(layer)))assignPanes(s);
 layer.error='';layer.loaded=false;
 if(!layer.tileRefresh)layer.tileRefresh=0;
 var bounds=viewBounds(s);
 if(layer.url===C().state.url&&window.GISEnhancements){
  var spatial=window.GISEnhancements.getModel().spatial;
  if(spatial){
   bounds={west:Math.max(bounds.west,spatial.west),east:Math.min(bounds.east,spatial.east),
    south:Math.max(bounds.south,spatial.south),north:Math.min(bounds.north,spatial.north)};
   if(bounds.west>=bounds.east||bounds.south>=bounds.north){
    clearRender(s,layer);layer.features=[];layer.loaded=true;layer.count=0;renderLayerList(s);return;
   }
  }
 }
 var params={where:layerWhere(s,layer),outFields:'*',returnGeometry:'true',outSR:4326,
  geometry:toEnvelope(bounds),geometryType:'esriGeometryEnvelope',inSR:4326,
  spatialRel:'esriSpatialRelIntersects',resultRecordCount:MAX_FEATURES};
 try{
  var data=await queryServer(s,layer.url,params);
  if(!isCurrent(s)||version!==layer.sequence)return;
  var good=[],failed=0;
  (data.features||[]).forEach(f=>{
   try{var geo=C().esriToGeoGeometry(f.geometry);
    if(geo)good.push({type:'Feature',geometry:geo,properties:f.attributes||{}});
   }catch(e){failed++;}
  });
  layer.features=good;layer.count=good.length;
  layer.partial=!!data.exceededTransferLimit||good.length>=MAX_FEATURES;
  layer.loaded=true;layer.drawMode='vector';
  renderFeatures(s,layer);
  if(failed)layer.error=failed+' geometries could not be rendered.';
 }catch(e){
  if(!isCurrent(s)||version!==layer.sequence)return;
  layer.features=null;layer.partial=false;layer.error=hostError(e);
  if(/\/MapServer\/\d+$/i.test(layer.url)){
   try{await renderImage(s,layer,version);layer.error='Image-only layer: editable symbols and labels require feature queries.';layer.loaded=true;}
   catch(err){if(isCurrent(s))layer.error='Unable to display: '+hostError(err);}
  }
 }
 if(isCurrent(s))renderLayerList(s);
}
function refresh(s){
 if(!isCurrent(s))return;
 s.layers.forEach(layer=>{if(layer.visible)loadLayer(s,layer);});
}
function removeLayer(s,layer){
 clearRender(s,layer);
 s.layers=s.layers.filter(x=>x!==layer);
 if(s.selected===layer)s.selected=null;
 assignPanes(s);renderLayerList(s);
}
async function addLayer(s,url,options){
 if(s.layers.length>=MAX_LAYERS)throw Error('Limit of '+MAX_LAYERS+' layers per map. Remove a layer first.');
 var target=normalizeUrl(url);
 if(target.layerId===null){await browse(s,target.root);return;}
 if(s.layers.some(x=>x.url===target.url)){s.selected=s.layers.find(x=>x.url===target.url);s.panel='style';renderPanel(s);return;}
 var meta=await readMeta(s,target.url);
 if(!meta.geometryType||meta.type==='Table'||meta.type==='Group Layer')throw Error('Choose a spatial ArcGIS feature layer, not a table or group layer.');
 if(!isCurrent(s))return;
 var layer=makeLayer(target.url,meta,options);
 s.layers.unshift(layer);s.selected=layer;
 assignPanes(s);renderLayerList(s);
 startFocus(s);
 s.panel='layers';renderPanel(s);
 loadLayer(s,layer);
 if(s.layers.length===1)fitExtent(s,layer.extent);
 return layer;
}
function closePanel(s,restoreFocus){
 if(!isCurrent(s))return;
 s.sidebar.hidden=true;s.shell.classList.remove('ms-panel-visible');
 if(s.layersButton)s.layersButton.setAttribute('aria-expanded','false');
 if(s.addButton)s.addButton.setAttribute('aria-expanded','false');
 if(restoreFocus&&s.layersButton)s.layersButton.focus?.({preventScroll:true});
 if(window.innerWidth>700)setTimeout(()=>{if(isCurrent(s))s.map.invalidateSize();},50);
}
function actionPane(s,tab){
 if(!isCurrent(s))return;
 s.panel=tab;s.sidebar.hidden=false;
 s.shell.classList.add('ms-panel-visible');
 if(s.layersButton)s.layersButton.setAttribute('aria-expanded','true');
 if(s.addButton)s.addButton.setAttribute('aria-expanded','true');
 renderPanel(s);
 if(window.innerWidth>700)setTimeout(()=>{if(isCurrent(s))s.map.invalidateSize();},50);
}
function fieldSelect(value,fields,cb,emptyLabel){
 var sel=el('select','ms-select');
 if(emptyLabel){var blank=el('option','',emptyLabel);blank.value='';sel.appendChild(blank);}
 fields.forEach(f=>{var op=el('option','',labelFor(f));op.value=f.name;sel.appendChild(op);});
 sel.value=value||'';sel.addEventListener('change',()=>cb(sel.value));return sel;
}
function renderLayerList(s){
 if(!isCurrent(s))return;
 s.layerCount.textContent=s.layers.length+' layer'+(s.layers.length===1?'':'s');
 if(s.panel!=='layers')return;
 renderPanel(s);
}
function renderPanel(s){
 if(!isCurrent(s))return;
 s.panelContent.replaceChildren();
 s.tabButtons.forEach(b=>{var on=b.dataset.panel===s.panel;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
 if(s.panelHeading)s.panelHeading.textContent=({layers:'Layers',add:'Add layers',style:'Style layer'})[s.panel]||'Layers';
 if(s.panel==='layers')showLayers(s);
 else if(s.panel==='add')showAdd(s);
 else if(s.panel==='style')showStyle(s);
}
function showLayers(s){
 var p=s.panelContent;
 var head=el('div','ms-panel-title');
 add(head,el('strong','','Active layers'),btn('+ Add','ms-primary',()=>actionPane(s,'add')));
 p.appendChild(head);
 p.appendChild(el('p','ms-hint','Top layers draw above lower layers. Use arrows to change order.'));
 if(!s.layers.length){p.appendChild(el('p','ms-empty','No layers yet. Add a layer from this server or paste a URL.'));return;}
 s.layers.forEach((layer,index)=>{
  var line=el('div','ms-layer-row'+(s.selected===layer?' is-selected':''));line.dataset.layer=String(layer.id);
  var main=el('div','ms-layer-main');
  var check=el('input');check.type='checkbox';check.checked=layer.visible;check.setAttribute('aria-label','Show '+layer.name);
  check.addEventListener('change',()=>{
    layer.visible=check.checked;
    if(!layer.visible)clearRender(s,layer);else loadLayer(s,layer);
    renderLayerList(s);
  });
  var swatch=el('span','ms-swatch');swatch.style.background=layer.style.fill;swatch.style.borderColor=layer.style.color;
  var names=el('div','ms-layer-names');
  add(names,el('strong','',layer.name),el('small','',layer.loaded?(fmt(layer.count)+(layer.partial?'+':'')+' in view'):'Not loaded'));
  add(main,check,swatch,names);
  main.appendChild(btn('Style','ms-small',()=>{s.selected=layer;actionPane(s,'style');}));
  line.appendChild(main);
  var toolbar=el('div','ms-layer-actions');
  var up=btn('↑','ms-icon',()=>{if(index>0){s.layers.splice(index,1);s.layers.splice(index-1,0,layer);assignPanes(s);renderLayerList(s);}},'Move up');
  var down=btn('↓','ms-icon',()=>{if(index<s.layers.length-1){s.layers.splice(index,1);s.layers.splice(index+1,0,layer);assignPanes(s);renderLayerList(s);}},'Move down');
  up.disabled=index===0;down.disabled=index===s.layers.length-1;
  add(toolbar,up,down,btn('Zoom','ms-small',()=>{
   if(!fitExtent(s,layer.extent))notice(s,'Layer extent is unavailable for this spatial reference.',true);
  }),btn('Table','ms-small',()=>C().navigate(layer.url)),btn('Remove','ms-small ms-danger',()=>removeLayer(s,layer)));
  line.appendChild(toolbar);
  if(layer.error)line.appendChild(el('p','ms-layer-warning',layer.error));
  if(layer.partial)line.appendChild(el('p','ms-layer-warning','Showing first '+MAX_FEATURES+' features in this view. Zoom in for more.'));
  p.appendChild(line);
 });
}
function control(s,parent,text,type,value,onChange,attrs){
 var lab=el('label','ms-control'),t=el('span','',text),input=el('input','ms-input');input.type=type;
 if(type==='checkbox')input.checked=!!value;else input.value=String(value);
 Object.entries(attrs||{}).forEach(([key,val])=>input.setAttribute(key,String(val)));
 input.addEventListener(type==='color'||type==='range'?'input':'change',()=>onChange(type==='checkbox'?input.checked:input.value));
 add(lab,t,input);parent.appendChild(lab);return input;
}
function showStyle(s){
 var p=s.panelContent,layer=s.selected;
 if(!layer||!s.layers.includes(layer)){
  add(p,el('p','ms-empty','Choose a layer, then select Style.'));return;
 }
 add(p,btn('← All layers','ms-small',()=>actionPane(s,'layers')),el('h3','',layer.name));
 p.appendChild(el('p','ms-hint','Changes apply only to the map view, not the source GIS service.'));
 var geom=layer.geom.toLowerCase(),point=geom==='esrigeometrypoint';
 if(point){
  var mode=el('div','ms-modes');
  [['points','Symbols'],['clusters','Clusters'],['heat','Density']].forEach(([value,label])=>{
   var b=btn(label,'ms-mode'+(layer.pointMode===value?' active':''),()=>{
    if(value==='clusters'&&typeof L().markerClusterGroup!=='function'){notice(s,'Clustering library unavailable.',true);return;}
    if(value==='heat'&&typeof L().heatLayer!=='function'){notice(s,'Density library unavailable.',true);return;}
    layer.pointMode=value;renderFeatures(s,layer);renderPanel(s);
   });mode.appendChild(b);
  });
  p.appendChild(mode);
 }
 if(layer.drawMode==='image'){
  p.appendChild(el('p','ms-layer-warning','This service only supplied a rendered image. Symbols and labels cannot be edited; opacity and layer order remain available.'));
  var imageOpacity=el('div','ms-style-grid');
  control(s,imageOpacity,'Layer opacity','range',layer.opacity,v=>{
   layer.opacity=Number(v);
   if(layer.render?.setOpacity)layer.render.setOpacity(layer.opacity);
  },{min:.1,max:1,step:.05});
  p.appendChild(imageOpacity);
  p.appendChild(btn('Retry editable features','ms-secondary',()=>loadLayer(s,layer)));
  return;
 }
 var controls=el('div','ms-style-grid');
 function styleSet(name,val){layer.style[name]=val;renderFeatures(s,layer);}
 control(s,controls,'Outline color','color',layer.style.color,v=>styleSet('color',safeColor(v,'#1976b9')));
 control(s,controls,'Fill color','color',layer.style.fill,v=>styleSet('fill',safeColor(v,'#40a0db')));
 if(point){
  control(s,controls,'Symbol size','range',layer.style.radius,v=>styleSet('radius',Number(v)),{min:3,max:16,step:1});
 }else{
  control(s,controls,'Stroke width','range',layer.style.weight,v=>styleSet('weight',Number(v)),{min:1,max:12,step:1});
  var dash=el('label','ms-control'),dselect=el('select','ms-select');
  dash.appendChild(el('span','','Line pattern'));
  [['solid','Solid'],['dash','Dashed'],['dot','Dotted']].forEach(([v,name])=>{var op=el('option','',name);op.value=v;dselect.appendChild(op);});
  dselect.value=layer.style.dash;dselect.addEventListener('change',()=>styleSet('dash',dselect.value));dash.appendChild(dselect);
  controls.appendChild(dash);
  if(geom.includes('polygon')){
   control(s,controls,'Fill opacity','range',layer.style.fillOpacity,v=>styleSet('fillOpacity',Number(v)),{min:0,max:.9,step:.05});
  }
 }
 control(s,controls,'Layer opacity','range',layer.opacity,v=>{
  layer.opacity=Number(v);
  if(layer.drawMode==='image'&&layer.render?.setOpacity)layer.render.setOpacity(layer.opacity);
  else renderFeatures(s,layer);
 },{min:.1,max:1,step:.05});
 p.appendChild(controls);
 var lab=el('section','ms-label-editor');
 var toggle=el('label','ms-toggle'),cb=el('input');cb.type='checkbox';cb.checked=layer.labelVisible;cb.disabled=layer.drawMode==='image'||layer.pointMode==='heat';
 cb.addEventListener('change',()=>{
  layer.labelVisible=cb.checked;
  if(layer.labelVisible&&!layer.labelField){
   var first=layer.fields.find(f=>/esriFieldType(?:String|Integer|SmallInteger|GUID)/i.test(f.type||''));
   if(first)layer.labelField=first.name;
  }
  renderFeatures(s,layer);renderPanel(s);
 });
 add(toggle,cb,el('span','','Show labels'));lab.appendChild(toggle);
 var strings=layer.fields.filter(f=>/esriFieldType(?:String|Integer|Double|SmallInteger|OID|GUID)/i.test(f.type||''));
 lab.appendChild(fieldSelect(layer.labelField,strings,val=>{
  layer.labelField=val;renderFeatures(s,layer);
 },'Choose label field'));
 p.appendChild(lab);
 var query=el('details','ms-query-controls'),summary=el('summary','','Advanced: layer WHERE filter');
 var form=el('form','ms-where-form'),input=el('input','ms-input');
 input.type='text';input.value=layer.where||'1=1';input.maxLength=500;
 input.setAttribute('aria-label','ArcGIS SQL WHERE expression');input.placeholder="e.g. STATUS = 'ACTIVE'";
 form.addEventListener('submit',e=>{
  e.preventDefault();layer.where=input.value.trim()||'1=1';
  loadLayer(s,layer);notice(s,'Applying attribute filter…');
 });
 var applyButton=btn('Apply','ms-primary');applyButton.type='submit';
 add(form,input,applyButton);add(query,summary,form);p.appendChild(query);
 p.appendChild(el('p','ms-hint','Filters run on the server. SQL syntax and supported fields vary by service.'));
 if(layer.drawMode==='image')p.appendChild(el('p','ms-layer-warning','Image-only layer: visual styling and labels require the feature query endpoint. Opacity and order still work.'));
 if(layer.partial)p.appendChild(el('p','ms-layer-warning','Styles and density use only the currently loaded preview features. Zoom in for greater detail.'));
}
function showAdd(s){
 var p=s.panelContent;
 p.appendChild(el('p','ms-hint','Browse this server or paste an HTTPS ArcGIS layer URL.'));
 var form=el('form','ms-add-form'),input=el('input','ms-input');input.type='url';
 input.required=true;input.placeholder='https://.../FeatureServer/0';input.setAttribute('aria-label','ArcGIS layer URL');
 form.addEventListener('submit',async event=>{
  event.preventDefault();var button=form.querySelector('button');button.disabled=true;
  try{await addLayer(s,input.value.trim());input.value='';}
  catch(err){notice(s,'Add layer: '+hostError(err),true);}
  finally{button.disabled=false;}
 });
 var submit=btn('Add URL','ms-primary');submit.type='submit';add(form,input,submit);p.appendChild(form);
 p.appendChild(el('div','ms-divider'));
 var browseBox=el('div','ms-browse');p.appendChild(browseBox);s.browseBox=browseBox;
 var current=baseService(C().state.url);
 var src=current?.root||C().state.root;
 add(browseBox,btn('Browse current server','ms-secondary',()=>browseServer(s,C().state.root)));
 if(current)add(browseBox,btn('Layers in this service','ms-secondary',()=>browse(s,current.root)));
 if(s.browseCache){
  var box=s.browseCache;drawBrowse(s,box.url,box.data,box.previous||null);
 }
}
function childPath(base,path){
 return base.replace(/\/+$/,'')+'/'+String(path).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}
async function browseServer(s,url){
 if(!isCurrent(s))return;
 var host=s.browseBox||s.panelContent;
 host.replaceChildren(el('p','ms-hint','Loading server directory…'));
 try{
  var data=await readMeta(s,url);
  if(!isCurrent(s)||s.panel!=='add')return;
  s.browseCache={url,data,previous:null};drawBrowse(s,url,data,null);
 }catch(e){if(host.isConnected)host.replaceChildren(el('p','ms-layer-warning','Cannot browse server: '+hostError(e)));}
}
async function browse(s,url){
 if(!isCurrent(s))return;
 var host=s.browseBox||s.panelContent;
 host.replaceChildren(el('p','ms-hint','Loading service layers…'));
 try{
  var data=await readMeta(s,url);
  if(!isCurrent(s)||s.panel!=='add')return;
  s.browseCache={url,data,previous:C().state.root};drawBrowse(s,url,data,C().state.root);
 }catch(e){if(host.isConnected)host.replaceChildren(el('p','ms-layer-warning','Cannot browse service: '+hostError(e)));}
}
function drawBrowse(s,url,data,previous){
 if(!s.browseBox||!s.browseBox.isConnected)return;
 var host=s.browseBox;host.replaceChildren();
 var head=el('div','ms-browse-heading');
 add(head,el('strong','','Browse server'),btn('Root','ms-small',()=>browseServer(s,C().state.root)));
 host.appendChild(head);
 var q=el('input','ms-input');q.type='search';q.placeholder='Find folders, services or layers…';
 q.setAttribute('aria-label','Filter available ArcGIS layers');
 host.appendChild(q);
 var list=el('div','ms-browser-list');host.appendChild(list);
 var items=[];
 (data.folders||[]).forEach(f=>items.push({name:f,type:'folder',url:childPath(url,f)}));
 (data.services||[]).filter(x=>/FeatureServer|MapServer/i.test(x.type||'')).forEach(x=>{
  var name=x.name||'';
  // Service names are relative to the server root, even when browsing a folder.
  var target=childPath(C().state.root,name)+'/'+x.type;
  items.push({name:name.split('/').pop()+' ('+x.type+')',type:'service',url:target});
 });
 (data.layers||[]).filter(x=>x.type!=='Group Layer'&&x.id!==undefined).forEach(x=>items.push({
  name:x.name||'Layer '+x.id,type:'layer',url:url.replace(/\/+$/,'')+'/'+x.id
 }));
 if(!items.length)host.appendChild(el('p','ms-empty','No published map layers found here.'));
 function draw(){
  list.replaceChildren();
  var match=items.filter(x=>x.name.toLowerCase().includes(q.value.trim().toLowerCase())).slice(0,120);
  match.forEach(item=>{
   var b=btn((item.type==='folder'?'▸ ':item.type==='service'?'▣ ':'＋ ')+item.name,'ms-browser-item',async()=>{
    if(item.type==='folder')await browseServer(s,item.url);
    else if(item.type==='service')await browse(s,item.url);
    else{
     try{await addLayer(s,item.url);}
     catch(err){notice(s,hostError(err),true);}
    }
   });
   list.appendChild(b);
  });
  if(items.length>120)list.appendChild(el('p','ms-hint','Showing first 120 names. Search to narrow the list.'));
 }
 q.addEventListener('input',draw);draw();
}
function cleanUp(){
 var s=session;
 if(!s)return;
 clearTimeout(s.timer);
 if(s.escapeHandler)document.removeEventListener?.('keydown',s.escapeHandler);
 s.layers.forEach(l=>clearRender(s,l));
 if(s.focusLayer){try{s.map.removeLayer(s.focusLayer);}catch(e){}}
 if(s.baseLayer&&s.map){try{s.map.removeLayer(s.baseLayer);}catch(e){}}
 if(s.rootKey)C().state.mapBasemap=s.basemap;
 if(s.rootKey)workspaces.set(s.rootKey,s.layers.map(l=>({url:l.url,visible:l.visible,style:l.style,
 pointMode:l.pointMode,labelField:l.labelField,labelVisible:l.labelVisible,where:l.where,opacity:l.opacity})));
 if(s.map){s.map.off();s.map.remove();}
 if(C().state.map===s.map){C().state.map=null;C().state.overlay=null;}
 session=null;
}
function mount(host){
 if(!window.L){host.appendChild(el('p','ms-empty','Leaflet failed to load. The data browser is still available.'));return;}
 cleanUp();
 var core=C(),key=core.state.root||new URL(core.state.url).origin;
 var s={host,rootKey:key,layers:[],panel:'layers',selected:null,basemap:'streets',timer:null,sidebar:null,baseLayer:null,map:null};
 session=s;
 var shell=el('section','ms-shell');s.shell=shell;
 var bar=el('div','ms-topbar');
 add(bar,el('div','ms-brand','Map Studio'),el('span','ms-badge','Read-only'));
 var controls=el('div','ms-top-controls');
 var basemap=el('select','ms-basemap');s.basemapControl=basemap;basemap.setAttribute('aria-label','Basemap');
 Object.entries(BASEMAPS).forEach(([k,v])=>{var op=el('option','',v.name);op.value=k;basemap.appendChild(op);});
 basemap.addEventListener('change',()=>setBasemap(s,basemap.value));
 controls.appendChild(basemap);
 var addButton=btn('+ Layer','ms-primary',()=>actionPane(s,'add'));
 addButton.setAttribute('aria-controls','ms-layer-panel');addButton.setAttribute('aria-expanded','false');
 s.addButton=addButton;controls.appendChild(addButton);
 var layersButton=btn('Layers','ms-secondary',()=>{
  if(s.shell.classList.contains('ms-panel-visible')&&s.panel==='layers')closePanel(s,false);
  else actionPane(s,'layers');
 });
 layersButton.setAttribute('aria-controls','ms-layer-panel');
 layersButton.setAttribute('aria-expanded','false');
 s.layersButton=layersButton;controls.appendChild(layersButton);
 var more=el('details','ms-more'),summary=el('summary','','More');
 var menu=el('div','ms-more-menu');
 add(menu,
  btn('Save map layout','ms-small',()=>{
   if(writeSaved(s.rootKey,persistConfig(s)))notice(s,'Map layout saved on this device. No features or tokens stored.');
   else notice(s,'Could not save locally (storage may be disabled).',true);
   more.open=false;
  }),
  btn('Restore saved layout','ms-small',()=>{more.open=false;restoreSaved(s);}),
  btn('Clear saved layout','ms-small ms-danger',()=>{
   if(clearSaved(s.rootKey))notice(s,'Saved layout removed from this browser.');
   more.open=false;
  }));
 add(more,summary,menu);controls.appendChild(more);
 bar.appendChild(controls);shell.appendChild(bar);
 var body=el('div','ms-body'),side=el('aside','ms-sidebar');
 s.sidebar=side;side.id='ms-layer-panel';side.setAttribute('aria-label','Map layer manager');
 var panelHeader=el('div','ms-panel-header'),panelHeading=el('strong','ms-panel-heading','Layers');
 s.panelHeading=panelHeading;
 var panelClose=btn('×','ms-panel-close',()=>closePanel(s,false),'Close layer panel');
 panelClose.setAttribute('aria-label','Close layer panel');
 add(panelHeader,panelHeading,panelClose);side.appendChild(panelHeader);
 var switcher=el('nav','ms-tabs');s.tabButtons=[];
 [['layers','Layers'],['add','Add'],['style','Style']].forEach(([k,label])=>{
  var t=btn(label,'ms-tab',()=>actionPane(s,k));t.dataset.panel=k;t.setAttribute('role','tab');s.tabButtons.push(t);switcher.appendChild(t);
 });side.appendChild(switcher);
 var panel=el('div','ms-panel');s.panelContent=panel;side.appendChild(panel);
 var mapwrap=el('div','ms-mapwrap');s.mapwrap=mapwrap;
 var mapEl=el('div','ms-canvas');s.mapEl=mapEl;
 var note=el('div','ms-notice');note.hidden=true;s.notice=note;
 var detail=el('aside','ms-detail');detail.hidden=true;s.detail=detail;
 var floating=el('div','ms-floating-tools');
 floating.appendChild(btn('Fit','ms-map-tool',()=>{
  var layer=focusedLayer(s),extent=layer?.extent||C().state.data?.fullExtent||C().state.data?.extent;
  if(!fitExtent(s,extent))notice(s,'No supported extent is available.',true);
 },'Fit selected layer extent'));
 var mapTools=el('details','ms-map-tools'),mapSummary=el('summary','','Tools');
 mapSummary.setAttribute('aria-label','Map selection tools');
 var mapMenu=el('div','ms-map-tools-menu');
 mapMenu.appendChild(btn('Use visible area','ms-tool-option',()=>{
  mapTools.open=false;applyArea(s,viewBounds(s));
 },'Filter Explore records to visible map'));
 var drawBtn=btn('Draw selection box','ms-tool-option',()=>{
  mapTools.open=false;setDrawing(s,!s.drawing);
 },'Tap two corners to select a map area');
 s.drawButton=drawBtn;mapMenu.appendChild(drawBtn);
 mapMenu.appendChild(btn('Clear map selection','ms-tool-option',()=>{
  mapTools.open=false;setDrawing(s,false);clearArea(s);
 }));
 add(mapTools,mapSummary,mapMenu);floating.appendChild(mapTools);s.mapTools=mapTools;
 var bottom=el('div','ms-map-footer');s.layerCount=el('span','','0 layers');
 var coord=el('span','','Pan to explore · zoom to load more detail');
 add(bottom,s.layerCount,coord);
 add(mapwrap,mapEl,note,floating,detail,bottom);
 add(body,side,mapwrap);shell.appendChild(body);host.appendChild(shell);
 s.map=L().map(mapEl,{zoomControl:true,attributionControl:true,minZoom:1,preferCanvas:true}).setView([29.76,-95.37],10);
 core.state.map=s.map;
 var historic=core.state.mapBasemap;
 if(BASEMAPS[historic])s.basemap=historic;
 setBasemap(s,s.basemap);
 var focus=core.state.data?.extent||core.state.data?.fullExtent||core.state.data?.initialExtent;
 fitExtent(s,focus);
 s.map.on('moveend',()=>{
  clearTimeout(s.timer);s.timer=setTimeout(()=>refresh(s),350);
 });
 s.map.on('click',event=>{
  if(!s.drawing)return;
  if(!s.drawFirst){s.drawFirst=event.latlng;return;}
  var a=s.drawFirst,b=event.latlng;
  if(s.areaRect)s.map.removeLayer(s.areaRect);
  s.areaRect=L().rectangle([[Math.min(a.lat,b.lat),Math.min(a.lng,b.lng)],
   [Math.max(a.lat,b.lat),Math.max(a.lng,b.lng)]],{color:'#ef8c24',weight:2,fillOpacity:.08}).addTo(s.map);
  setDrawing(s,false);
  applyArea(s,{west:Math.min(a.lng,b.lng),east:Math.max(a.lng,b.lng),
   south:Math.min(a.lat,b.lat),north:Math.max(a.lat,b.lat)});
 });
 s.map.on('mousemove',event=>{if(!s.mapwrap.isConnected)return;
  coord.textContent=event.latlng.lat.toFixed(5)+', '+event.latlng.lng.toFixed(5)+' · Zoom '+s.map.getZoom();
 });
 var desktop=window.innerWidth>700;
 s.sidebar.hidden=!desktop;s.shell.classList.toggle('ms-panel-visible',desktop);
 s.layersButton.setAttribute('aria-expanded',String(desktop));
 s.addButton.setAttribute('aria-expanded',String(desktop));
 s.escapeHandler=event=>{
  if(event.key==='Escape'&&isCurrent(s)){
   if(s.mapTools?.open){s.mapTools.open=false;event.preventDefault();return;}
   if(s.sidebar&&!s.sidebar.hidden){closePanel(s,true);event.preventDefault();}
  }
 };
 document.addEventListener?.('keydown',s.escapeHandler);
 renderPanel(s);
 var remembered=workspaces.get(key);
 var current=baseService(core.state.url);
 if(remembered?.length){
  (async()=>{
   for(var i=remembered.slice(0,MAX_LAYERS).length-1;i>=0;i--){
    if(!isCurrent(s))return;
    var x=remembered[i];
    try{await addLayer(s,x.url,x);}catch(e){notice(s,hostError(e),true);}
   }
  })();
 }else if(current?.layerId!==null){
  addLayer(s,current.url).catch(e=>notice(s,hostError(e),true));
 }else if(current?.root){
  browseServiceInitial(s,current.root);
 }
 setTimeout(()=>{if(isCurrent(s)){s.map.invalidateSize();refresh(s);}},200);
}
async function browseServiceInitial(s,url){
 try{
  var meta=await readMeta(s,url);
  if(!isCurrent(s))return;
  var children=(meta.layers||[]).filter(x=>x.type!=='Group Layer'&&x.defaultVisibility).slice(0,4);
  if(!children.length){actionPane(s,'add');await browse(s,url);return;}
  for(var i=children.length-1;i>=0;i--){
   if(!isCurrent(s))return;
   try{await addLayer(s,url+'/'+children[i].id);}catch(e){notice(s,hostError(e),true);}
  }
 }catch(e){if(isCurrent(s))notice(s,'Choose a layer in Add: '+hostError(e),true);}
}
async function restoreSaved(s){
 var conf=readSaved(s.rootKey);
 if(!conf?.layers?.length){notice(s,'No saved map on this device. Use Save map after arranging layers.');return;}
 if(!isCurrent(s))return;
 s.layers.forEach(l=>clearRender(s,l));s.layers=[];s.selected=null;
 s.basemap=BASEMAPS[conf.basemap]?conf.basemap:'streets';setBasemap(s,s.basemap);
 for(var i=conf.layers.length-1;i>=0;i--){
  if(!isCurrent(s))return;
  var info=conf.layers[i];try{await addLayer(s,info.url,info);}catch(e){notice(s,'Could not restore '+info.url+': '+hostError(e),true);}
 }
 if(isCurrent(s)&&conf.center&&Number.isFinite(Number(conf.center.lat))&&Number.isFinite(Number(conf.center.lng))&&Number.isFinite(Number(conf.zoom)))
  s.map.setView([conf.center.lat,conf.center.lng],Math.min(19,Math.max(1,conf.zoom)));
 renderPanel(s);
}
window.GISMapStudio={mount,cleanup:cleanUp,refresh:()=>{if(session)refresh(session);},
 utils:{baseService,validStyle,makeLayer,BASEMAPS},getState:()=>session};
})();
