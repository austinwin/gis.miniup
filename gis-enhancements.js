/* GIS Explorer connected workflows. Read-only UI module; auth remains in GISCore. */
(function(){
'use strict';
var models=new Map(), currentUrl='', favoritesKey='gis-explorer-favorites-v2', recentKey='gis-explorer-recents-v2';
var searchWired=false, comparing=false;
function C(){return window.GISCore;}
function E(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function B(label,cls,fn){var x=E('button',cls,label);x.type='button';x.addEventListener('click',fn);return x;}
function add(p,...els){els.forEach(x=>{if(x)p.appendChild(x)});return p;}
function safeStorageRead(key){try{var v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v:[]}catch(e){return []}}
function safeStorageWrite(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch(e){}}
function current(){var c=C();return c?c.state:null}
function metadata(){return current()?.data||{}}
function layerUrl(){return current()?.url||''}
function layerName(){return C().titleFor(metadata(),layerUrl())}
function isLayer(){return C()?.resourceType(layerUrl())==='layer' && Array.isArray(metadata().fields) && metadata().type!=='Group Layer'}
function nameOfField(field){return field?.alias || field?.name || ''}
function fieldType(field){return String(field?.type||'')}
function oidField(){var d=metadata();return d.objectIdField||d.objectIdFieldName||(d.fields||[]).find(f=>f.type==='esriFieldTypeOID')?.name||'OBJECTID'}
function getModel(){
 var url=layerUrl();if(!models.has(url))models.set(url,{url,filters:[],join:'AND',where:'1=1',advanced:'',page:0,pageSize:100,sort:'',descending:false,records:[],selected:new Set(),count:null,busy:false,error:'',warning:'',requestId:0,counting:false,lastQuery:'',spatial:null,ids:null,hasLoaded:false,detailId:null,stats:null});
 return models.get(url);
}
function textSafe(value){if(value===null || value===undefined)return '—';if(typeof value==='object')return JSON.stringify(value);return String(value)}
function val(field,obj){if(obj[field]!==undefined)return obj[field];var k=Object.keys(obj).find(x=>x.toLowerCase()===field.toLowerCase());return k?obj[k]:undefined}
function cleanName(v){return String(v||'layer').replace(/[^\w .-]/g,'').trim().slice(0,80)||'layer'}
function showStatus(target,message,isError){target.replaceChildren();var p=E('p',isError?'ge-error':'ge-muted',message);target.appendChild(p)}
function codeWhere(field,op,value){
 if(!field)return '';
 var safe='"'+field.replace(/"/g,'""')+'"';
 // ArcGIS field names generally do not require quoting, but the metadata is authoritative.
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field))safe='"'+field.replace(/"/g,'""')+'"';else safe=field;
 if(op==='IS NULL'||op==='IS NOT NULL')return safe+' '+op;
 if(value===null||value===undefined||String(value).trim()==='')throw new Error('Enter a value for '+field+'.');
 var f=(metadata().fields||[]).find(x=>x.name===field),type=fieldType(f);
 var numeric=/Integer|SmallInteger|Double|Single|OID|BigInteger/i.test(type);
 var literal;
 if(numeric){
   var n=Number(value);
   if(!Number.isFinite(n))throw new Error('The selected numeric field requires a number.');
   literal=String(n);
 }else{
   literal="'"+String(value).replace(/'/g,"''")+"'";
 }
 if(op==='CONTAINS'||op==='STARTS WITH'){
   if(numeric)throw new Error('Text search is not available for numeric fields.');
   literal="'"+(op==='CONTAINS'?'%':'')+String(value).replace(/'/g,"''")+'%'+ "'";
   return safe+' LIKE '+literal;
 }
 return safe+' '+op+' '+literal;
}
function buildWhere(model){
 var clauses=model.filters.map(f=>codeWhere(f.field,f.op,f.value)).filter(Boolean);
 if(model.advanced?.trim())clauses.push('('+model.advanced.trim()+')');
 return clauses.length?'('+clauses.join(' '+model.join+' ')+')':'1=1';
}
function currentWhere(){
 var m=getModel();
 try{m.where=buildWhere(m);return m.where}catch(e){throw e}
}
function commonParams(model,extras){var where=currentWhere();return Object.assign({where,returnGeometry:'false',outFields:'*'},extras||{});}
function fieldPick(value,change){
 var select=E('select','ge-select');select.setAttribute('aria-label','Field');
 (metadata().fields||[]).forEach(f=>{var o=E('option','',nameOfField(f));o.value=f.name;select.appendChild(o)});
 select.value=value||select.options[0]?.value||'';select.addEventListener('change',()=>change(select.value));return select;
}
function createFieldRow(m,f,index,host){
 var row=E('div','ge-filter-row');
 add(row,fieldPick(f.field,next=>{f.field=next;f.value='';redraw();}));
 var ops=E('select','ge-select');ops.setAttribute('aria-label','Condition');
 ['=','!=','>','>=','<','<=','CONTAINS','STARTS WITH','IS NULL','IS NOT NULL'].forEach(o=>{var x=E('option','',o);x.value=o;ops.appendChild(x)});
 ops.value=f.op;ops.addEventListener('change',()=>{f.op=ops.value;redraw()});row.appendChild(ops);
 var field=metadata().fields.find(x=>x.name===f.field)||{},domain=field.domain;
 if(domain?.type==='codedValue' && domain.codedValues?.length && !['CONTAINS','STARTS WITH','IS NULL','IS NOT NULL'].includes(f.op)){
   var input=E('select','ge-select');input.setAttribute('aria-label','Value');
   var blank=E('option','','Choose a value');blank.value='';input.appendChild(blank);
   domain.codedValues.forEach(v=>{var o=E('option','',textSafe(v.name));o.value=v.code;input.appendChild(o)});
   input.value=f.value;input.addEventListener('change',()=>{f.value=input.value});row.appendChild(input);
 }else{
   var input=E('input','ge-input');input.setAttribute('aria-label','Value');input.placeholder='Value';
   if(/Integer|Double|Single|SmallInteger|OID|BigInteger/.test(field.type||''))input.type='number';
   input.value=f.value;input.disabled=f.op.startsWith('IS ');
   input.addEventListener('input',()=>{f.value=input.value});row.appendChild(input);
 }
 row.appendChild(B('×','ge-quiet',()=>{m.filters.splice(index,1);redraw()}));host.appendChild(row);
 function redraw(){var box=document.getElementById('geData');if(box)renderData(box.parentNode);}
}
function renderData(host){
 host.replaceChildren();
 if(!isLayer()){host.appendChild(E('p','ge-muted','Select a queryable feature layer or table.'));return;}
 var m=getModel(),outer=E('div','ge-workspace'),filter=E('section','ge-card');
 outer.id='geData';
 var top=E('div','ge-header');add(top,E('div','ge-h-title','Explore records'),E('div','ge-muted','Query data without writing SQL'));filter.appendChild(top);
 var rows=E('div','ge-filter-list');
 m.filters.forEach((f,i)=>createFieldRow(m,f,i,rows));filter.appendChild(rows);
 var actions=E('div','ge-flex ge-controls'),join=E('select','ge-select ge-small');
 ['AND','OR'].forEach(x=>{var o=E('option','',x);o.value=x;join.appendChild(o)});join.value=m.join;join.title='Combine filter conditions';
 join.addEventListener('change',()=>{m.join=join.value});
 add(actions,B('+ Add condition','ge-secondary',()=>{m.filters.push({field:metadata().fields[0]?.name||'',op:'=',value:''});renderData(host)}),
   E('span','ge-inline','Match'),join,
   B('Apply filters','ge-primary',()=>{m.page=0;m.count=null;m.ids=null;loadRows(m);}),
   B('Clear','ge-secondary',()=>{m.filters=[];m.advanced='';m.page=0;m.count=null;m.ids=null;m.spatial=null;C().state.exportContext=null;renderData(host);loadRows(m)}));
 filter.appendChild(actions);
 var preview=E('div','ge-preview');
 try{m.where=buildWhere(m);preview.textContent='WHERE '+m.where+(m.spatial?'  ·  Spatial extent filter active':'');}
 catch(e){preview.textContent=e.message;preview.classList.add('ge-error');}
 filter.appendChild(preview);
 var advanced=E('details','ge-disclosure');
 add(advanced,E('summary','','Advanced WHERE expression (optional)'));
 var free=E('textarea','ge-input ge-textarea');free.value=m.advanced;free.placeholder='e.g. DIAMETER >= 24';free.rows=2;
 free.addEventListener('input',()=>{m.advanced=free.value});
 advanced.appendChild(free);advanced.appendChild(E('p','ge-muted','Server-side SQL syntax varies by ArcGIS version; use the visual filters when possible.'));filter.appendChild(advanced);
 outer.appendChild(filter);
 var results=E('section','ge-card'),info=E('div','ge-flex ge-results-head');
 add(info,E('h3','','Attribute table'),E('span','ge-count',m.count===null?'Count not loaded':m.count.toLocaleString()+' matching records'));
 var countButton=B('Count','ge-secondary',()=>loadCount(m));countButton.disabled=m.counting;info.appendChild(countButton);
 var rowActions=E('div','ge-flex ge-actions');
 if(metadata().type!=='Table' && metadata().geometryType){
   rowActions.appendChild(B('Show selected on map','ge-secondary',()=>showSelectedOnMap(m)));
   rowActions.appendChild(B('Map filtered (max 300)','ge-secondary',()=>showFilteredOnMap(m)));
 }
 add(rowActions,B('Export filtered','ge-secondary',()=>startFilteredExport(m)),
    B('Export selected','ge-secondary',()=>startSelectedExport(m)));
 results.appendChild(info);results.appendChild(rowActions);
 var config=E('div','ge-flex ge-controls');
 var sizes=E('select','ge-select ge-small');[50,100,200,500].forEach(n=>{var o=E('option','',n+' rows / page');o.value=n;sizes.appendChild(o)});
 sizes.value=m.pageSize;
 sizes.addEventListener('change',()=>{m.pageSize=Number(sizes.value);m.page=0;loadRows(m)});
 var sorting=fieldPick(m.sort,(field)=>{m.sort=field;m.page=0;loadRows(m)});
 var order=E('select','ge-select ge-small');[['ASC','Ascending'],['DESC','Descending']].forEach(x=>{var o=E('option','',x[1]);o.value=x[0];order.appendChild(o)});
 order.value=m.descending?'DESC':'ASC';order.addEventListener('change',()=>{m.descending=order.value==='DESC';m.page=0;loadRows(m)});
 add(config,sizes,E('span','ge-inline','Sort by'),sorting,order);results.appendChild(config);
 var body=E('div','ge-table-scroll');body.id='geTable';
 if(m.busy)body.appendChild(E('p','ge-muted','Loading records…'));
 else if(m.error)body.appendChild(E('p','ge-error',m.error));
 else if(!m.hasLoaded)body.appendChild(E('p','ge-muted','Click Apply filters to retrieve the first page.'));
 else if(!m.records.length)body.appendChild(E('p','ge-muted','No matching records.'));
 else renderRows(body,m);
 results.appendChild(body);
 if(m.warning)results.appendChild(E('p','ge-muted',m.warning));
 var pager=E('div','ge-flex ge-pagination');
 var prev=B('← Previous','ge-secondary',()=>{m.page--;loadRows(m)});prev.disabled=m.page<=0||m.busy;
 var next=B('Next →','ge-secondary',()=>{m.page++;loadRows(m)});
 next.disabled=m.busy || m.records.length<m.pageSize || (m.count!==null && (m.page+1)*m.pageSize>=m.count);
 add(pager,prev,E('span','ge-muted','Page '+(m.page+1)),next);
 results.appendChild(pager);outer.appendChild(results);
 // On-demand server-side summaries; never compute global statistics from one page.
 var summary=E('section','ge-card');
 summary.appendChild(E('h3','','Field statistics'));
 var statRow=E('div','ge-flex ge-controls'),statField=E('select','ge-select ge-small');
 (metadata().fields||[]).filter(f=>/Integer|SmallInteger|Double|Single|OID|BigInteger/i.test(f.type||'')).forEach(f=>{
   var o=E('option','',nameOfField(f));o.value=f.name;statField.appendChild(o);
 });
 var statResults=E('div','ge-stat-result');
 add(statRow,statField,B('Calculate','ge-secondary',async()=>{
   if(!statField.value){showStatus(statResults,'No numeric fields are available.');return;}
   showStatus(statResults,'Calculating statistics on the server…');
   try{
     var aggregates=[['MIN','min'],['MAX','max'],['AVG','avg'],['SUM','sum']]
       .map(([name,func])=>({statisticType:func,onStatisticField:statField.value,outStatisticFieldName:name}));
     var params={where:buildWhere(m),outStatistics:JSON.stringify(aggregates),returnGeometry:'false'};
     Object.assign(params,spatialParams(m));
     var data=await C().post(m.url+'/query',params);
     var attrs=data.features?.[0]?.attributes;
     if(!attrs)throw Error('The server returned no statistics.');
     statResults.replaceChildren();
     var layout=E('div','ge-stat-grid');
     ['MIN','MAX','AVG','SUM'].forEach(k=>{
       var cell=E('div','ge-stat-cell');
       add(cell,E('span','',k),E('strong','',attrs[k]===undefined||attrs[k]===null?'—':Number(attrs[k]).toLocaleString(undefined,{maximumFractionDigits:2})));
       layout.appendChild(cell);
     });
     statResults.appendChild(layout);
   }catch(e){showStatus(statResults,'Statistics unavailable: '+e.message,true);}
 }));
 summary.appendChild(statRow);summary.appendChild(statResults);outer.appendChild(summary);
 var details=E('section','ge-card ge-detail');
 details.id='geRecordDetails';outer.appendChild(details);
 host.appendChild(outer);
 if(m.detailId!==null)renderRecordDetail(m);
 else showStatus(details,'Select a row to inspect its fields, related records, and attachments.',false);
}
function renderRows(root,m){
 var fields=metadata().fields||[],table=E('table','ge-data-table');
 var thead=E('thead'),head=E('tr');
 var th=E('th','','Select');head.appendChild(th);
 fields.forEach(f=>{
   var h=E('th','ge-sortable-header',nameOfField(f)+(m.sort===f.name?(m.descending?' ↓':' ↑'):''));h.title='Sort by '+f.name+' · '+(f.type||'');
   h.tabIndex=0;h.setAttribute('role','button');h.setAttribute('aria-label','Sort table by '+f.name);
   var sortColumn=function(){m.descending=m.sort===f.name?!m.descending:false;m.sort=f.name;m.page=0;loadRows(m);};
   h.addEventListener('click',sortColumn);
   h.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();sortColumn();}});
   head.appendChild(h);
 });
 thead.appendChild(head);table.appendChild(thead);
 var tbody=E('tbody');
 m.records.forEach(feature=>{
   var attrs=feature.attributes||{},oid=val(oidField(),attrs),tr=E('tr',m.selected.has(String(oid))?'ge-row-selected':'');
   var cell=E('td'),input=E('input');input.type='checkbox';input.checked=m.selected.has(String(oid));
   input.setAttribute('aria-label','Select record '+textSafe(oid));
   input.addEventListener('click',e=>e.stopPropagation());
   input.addEventListener('change',()=>{if(input.checked)m.selected.add(String(oid));else m.selected.delete(String(oid));tr.classList.toggle('ge-row-selected',input.checked)});
   cell.appendChild(input);tr.appendChild(cell);
   fields.forEach(f=>{
     var td=E('td','',textSafe(val(f.name,attrs))),value=val(f.name,attrs);
     var cv=f.domain?.codedValues?.find(v=>String(v.code)===String(value));
     if(cv)td.title='Code '+textSafe(value)+' · '+cv.name; else td.title=textSafe(value);
     tr.appendChild(td);
   });
   tr.addEventListener('click',()=>{m.detailId=oid;renderRecordDetail(m);});
   tbody.appendChild(tr);
 });
 table.appendChild(tbody);root.appendChild(table);
}
async function loadCount(m){
 m.counting=true;if(m===models.get(layerUrl())&&current()?.tab==='data')renderData(document.getElementById('content'));
 try{
   var where=buildWhere(m),p={where,returnCountOnly:'true'};
   Object.assign(p,spatialParams(m));
   var data=await C().post(m.url+'/query',p);
   m.count=Number(data.count)||0;m.error='';
 }catch(e){m.error='Count: '+e.message;}
 finally{m.counting=false;if(m.url===layerUrl()&&current()?.tab==='data')renderData(document.getElementById('content'));}
}
function spatialParams(m){
 if(!m.spatial)return {};
 var b=m.spatial;
 return {geometry:JSON.stringify({xmin:b.west,ymin:b.south,xmax:b.east,ymax:b.north,spatialReference:{wkid:4326}}),
  geometryType:'esriGeometryEnvelope',inSR:4326,spatialRel:'esriSpatialRelIntersects'};
}
async function loadRows(m){
 var rid=++m.requestId;m.busy=true;m.error='';m.warning='';m.detailId=null;m.hasLoaded=true;
 if(m.url===layerUrl()&&current()?.tab==='data')renderData(document.getElementById('content'));
 try{
   var args={where:buildWhere(m),outFields:'*',returnGeometry:'false',resultRecordCount:m.pageSize,
    resultOffset:m.page*m.pageSize};
   Object.assign(args,spatialParams(m));
   // Use pagination where the service advertises support; otherwise select
   // the current OID slice from an authoritative ID list.
   var supported=metadata().advancedQueryCapabilities?.supportsPagination!==false;
   var data;
   if(supported){
     if(m.sort)args.orderByFields=m.sort+(m.descending?' DESC':' ASC');
     try{
       data=await C().post(m.url+'/query',args);
       if(data.exceededTransferLimit && (!data.features?.length || data.features.length<m.pageSize))
         throw Error('The server pagination/transfer limit truncated the page.');
     }catch(e){
       if(!/pagination|offset|orderBy|sort|record count|invalid|transfer limit|truncat/i.test(e.message))throw e;
       data=await pageByIds(m);
     }
   }else data=await pageByIds(m);
   if(m.requestId!==rid)return;
   m.records=data.features||[];
   if(m.url===layerUrl()&&current()?.tab==='data')renderData(document.getElementById('content'));
 }catch(e){if(m.requestId!==rid)return;m.error=e.message;if(m.url===layerUrl()&&current()?.tab==='data')renderData(document.getElementById('content'));}
 finally{if(m.requestId===rid){m.busy=false;if(m.url===layerUrl()&&current()?.tab==='data')renderData(document.getElementById('content'));}}
}
async function pageByIds(m){
 var where=buildWhere(m),sp=spatialParams(m),key=JSON.stringify([where,sp]);
 if(!m.ids || m.ids.key!==key){
   var info=await C().post(m.url+'/query',Object.assign({where,returnIdsOnly:'true'},sp));
   if(!Array.isArray(info.objectIds))throw Error('This service supports neither pagination nor ID-based paging.');
   m.ids={key,values:info.objectIds.slice().sort((a,b)=>Number(a)-Number(b))};
   m.count=info.objectIds.length;
 }
 var ids=m.ids.values.slice(m.page*m.pageSize,(m.page+1)*m.pageSize);
 if(!ids.length)return {features:[]};
 var result=await C().post(m.url+'/query',{objectIds:ids.join(','),outFields:'*',returnGeometry:'false'});
 var byId=new Map((result.features||[]).map(x=>[String(val(oidField(),x.attributes||{})),x]));
 var records=ids.map(id=>byId.get(String(id))).filter(Boolean);
 if(records.length!==ids.length)throw Error('The ArcGIS server returned an incomplete page.');
 if(m.sort){
   records.sort((a,b)=>String(val(m.sort,a.attributes)||'').localeCompare(String(val(m.sort,b.attributes)||''),undefined,{numeric:true})*(m.descending?-1:1));
   m.warning='This server does not support full-table sorting; only this page is sorted.';
 }
 return {features:records};
}
function showSelectedOnMap(m){
 if(!m.selected.size){C().showAlert('Select a record','Select at least one table row first.',false);return;}
 C().state.focusOids=Array.from(m.selected).slice(0,50);
 C().state.focusWhere=null;
 C().state.focusBBox=null;
 C().setTab('map');
}
function showFilteredOnMap(m){
 try {
   C().state.focusOids=null;
   C().state.focusWhere=buildWhere(m);
   C().state.focusBBox=m.spatial;
   C().setTab('map');
 }catch(e){C().showAlert('Invalid filter',e.message,true)}
}
function startFilteredExport(m){
 try{C().state.exportContext={where:buildWhere(m),bbox:m.spatial,ids:null};C().setTab('export')}
 catch(e){C().showAlert('Invalid filter',e.message,true)}
}
function startSelectedExport(m){
 if(!m.selected.size){C().showAlert('Select a record','Select one or more records first.',false);return;}
 C().state.exportContext={where:'1=1',bbox:null,ids:Array.from(m.selected)};C().setTab('export');
}
function downloadResource(url,fileName){
 var token=C().scopedToken(url),u=new URL(url);
 if(token)u.searchParams.set('token',token);
 return fetch(u.href,{mode:'cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:token?'error':'follow'})
   .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.blob()})
   .then(blob=>{
     var href=URL.createObjectURL(blob),a=E('a');a.href=href;a.download=fileName||'attachment';
     document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);
   });
}
async function renderRecordDetail(m){
 var host=document.getElementById('geRecordDetails');
 if(!host||m.detailId===null)return;
 var oid=m.detailId,row=m.records.find(x=>String(val(oidField(),x.attributes||{}))===String(oid));
 if(!row)return;
 host.replaceChildren();
 var line=E('div','ge-flex ge-between');
 line.appendChild(E('h3','','Record '+oid));
 if(metadata().type!=='Table' && metadata().geometryType)
   line.appendChild(B('Show on map','ge-secondary',()=>{C().state.focusOids=[String(oid)];C().setTab('map')}));
 host.appendChild(line);
 var dl=E('dl','ge-attribute-grid');
 (metadata().fields||[]).forEach(f=>{
   add(dl,E('dt','',nameOfField(f)),E('dd','',textSafe(val(f.name,row.attributes||{}))));
 });
 var scroll=E('div','ge-detail-scroll');scroll.appendChild(dl);host.appendChild(scroll);
 var more=E('div','ge-flex ge-controls');
 if(metadata().hasAttachments){
   more.appendChild(B('Attachments','ge-secondary',async()=>{
     var dest=E('div','ge-related');host.querySelector('.ge-related')?.remove();host.appendChild(dest);
     showStatus(dest,'Loading attachments…');
     try{
       var items=[];
       try{
         var response=await C().post(m.url+'/queryAttachments',{objectIds:String(oid),returnUrl:'false'});
         items=(response.attachmentGroups||[]).flatMap(g=>g.attachmentInfos||[]);
       }catch(primaryError){
         // Older ArcGIS layers may expose per-feature attachment listings
         // even when the bulk queryAttachments operation is unavailable.
         var detail=await C().read(C().jsonUrl(m.url+'/'+encodeURIComponent(String(oid))+'/attachments'));
         items=detail.attachmentInfos||[];
       }
       dest.replaceChildren();
       if(!items.length){showStatus(dest,'No attachments for this record.');return;}
       items.forEach(a=>{
         var b=B((a.name||('Attachment '+a.id))+' ('+Math.round((a.size||0)/1024)+' KB)','ge-secondary',()=>{
           downloadResource(m.url+'/'+oid+'/attachments/'+a.id,a.name||'attachment').catch(e=>C().showAlert('Attachment download failed',e.message,true));
         });
         dest.appendChild(b);
       });
     }catch(e){showStatus(dest,e.message,true)}
   }));
 }
 (metadata().relationships||[]).forEach(rel=>{
   more.appendChild(B('Related: '+(rel.name||rel.id),'ge-secondary',async()=>{
     var dest=E('div','ge-related');host.querySelector('.ge-related')?.remove();host.appendChild(dest);
     showStatus(dest,'Loading related records…');
     try{
       var response=await C().post(m.url+'/queryRelatedRecords',{objectIds:String(oid),relationshipId:rel.id,outFields:'*',returnGeometry:'false'});
       dest.replaceChildren();
       var rows=(response.relatedRecordGroups||[]).flatMap(g=>g.relatedRecords||[]);
       if(!rows.length){showStatus(dest,'No related records found.');return;}
       var pre=E('pre','ge-code',JSON.stringify(rows.map(x=>x.attributes||{}),null,2));dest.appendChild(pre);
     }catch(e){showStatus(dest,e.message,true)}
   }));
 });
 host.appendChild(more);
}
function renderIntro(host){
 var u=layerUrl();
 if(!u)return;
 var favorites=safeStorageRead(favoritesKey);
 var active=favorites.includes(u);
 host.appendChild(B(active?'★ Saved':'☆ Save','action-button',()=>{
   var list=safeStorageRead(favoritesKey);
   list=list.includes(u)?list.filter(x=>x!==u):[u,...list].slice(0,30);
   safeStorageWrite(favoritesKey,list);C().navigate(u,{noHistory:true});
 }));
}
function renderOverviewAddon(host){
 if(!isLayer())return;
 var card=C().createCard('Layer diagnostics','Supported operations and data quality checks');
 card.card.classList.add('ge-diagnostics');
 var d=metadata(),features=[
   ['Geometry',d.geometryType||d.type||'Not provided'],
   ['Spatial reference',(d.extent?.spatialReference||d.sourceSpatialReference||d.spatialReference||{}).latestWkid||
     (d.extent?.spatialReference||d.sourceSpatialReference||d.spatialReference||{}).wkid||'Not provided'],
   ['Last edit',(d.editingInfo?.lastEditDate?new Date(d.editingInfo.lastEditDate).toLocaleString():'Not provided')],
   ['Query',d.capabilities||'Not provided'],
   ['Attachments',d.hasAttachments?'Available':'Not advertised'],
   ['Relationships',(d.relationships||[]).length],
   ['Domains',(d.fields||[]).filter(f=>Boolean(f.domain)).length],
   ['Max records per query',d.maxRecordCount||'Not provided']
 ];
 var table=E('dl','ge-diag-grid');features.forEach(pair=>add(table,E('dt','',pair[0]),E('dd','',textSafe(pair[1]))));
 card.card.appendChild(table);
 var bar=E('div','ge-flex ge-controls');
 var countLabel=E('span','ge-count','Count not loaded');bar.appendChild(countLabel);
 bar.appendChild(B('Count records','ge-secondary',async()=>{
   countLabel.textContent='Checking…';
   try{var result=await C().post(layerUrl()+'/query',{where:'1=1',returnCountOnly:'true'});
       countLabel.textContent=Number(result.count||0).toLocaleString()+' total records';
   }catch(e){countLabel.textContent='Count unavailable: '+e.message;}
 }));
 bar.appendChild(B('Explore data','ge-primary',()=>C().setTab('data')));
 card.card.appendChild(bar);host.appendChild(card.card);
}

function refreshVectorOverlay(map){
 var c=C(),s=current(),url=layerUrl();
 if(!map||s.map!==map||!/\/FeatureServer\/\d+$/i.test(url))return;
 var id=Number(url.split('/').pop());
 s.vectorSeq=(s.vectorSeq||0)+1;
 var number=s.vectorSeq;
 if(s.vectorLayer){map.removeLayer(s.vectorLayer);s.vectorLayer=null;}
 if(Array.isArray(s.visibleMapLayers) && !s.visibleMapLayers.includes(id))return;
 var bounds=map.getBounds(),m=getModel(),bbox={xmin:bounds.getWest(),ymin:bounds.getSouth(),
   xmax:bounds.getEast(),ymax:bounds.getNorth(),spatialReference:{wkid:4326}};
 var p={where:m.where||'1=1',geometry:JSON.stringify(bbox),geometryType:'esriGeometryEnvelope',
   spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:'true',outSR:4326,
   resultRecordCount:500};
 c.post(url+'/query',p).then(data=>{
   if(s.map!==map||number!==s.vectorSeq)return;
   var features=(data.features||[]).map(f=>{
     try{return {type:'Feature',properties:f.attributes||{},geometry:c.esriToGeoGeometry(f.geometry)};}
     catch(e){return null}
   }).filter(Boolean);
   if(!features.length)return;
   var layer=L.geoJSON({type:'FeatureCollection',features},{
     style:{color:'#216aa0',weight:2,fillOpacity:.12,opacity:s.mapOpacity??.8},
     pointToLayer:(feature,latlng)=>L.circleMarker(latlng,{radius:5,color:'#216aa0',weight:2,fillOpacity:.55})
   }).addTo(map);
   s.vectorLayer=layer;
   var note=document.getElementById('mapAuthWarning');
   if(note && (data.exceededTransferLimit||features.length>=500))
     note.textContent='FeatureServer preview is limited to 500 features per map view. Zoom in to see more, or use Export for the full dataset.';
 }).catch(e=>{
   var note=document.getElementById('mapAuthWarning');
   if(note && s.map===map && number===s.vectorSeq)
     note.textContent='FeatureServer preview unavailable: '+e.message;
 });
}

function onMap(map,card,frame){
 var c=C(),s=current(),d=metadata(),contextUrl=layerUrl(),layerMode=isLayer();
 var toolbar=E('div','ge-maptools ge-flex');
 toolbar.appendChild(B('Fit extent','ge-secondary',()=>{
   var extent=d.fullExtent||d.extent||d.initialExtent;
   if(!extent?.spatialReference){c.showAlert('No extent','No supported extent metadata is available.',false);return;}
   var wkid=extent.spatialReference.latestWkid||extent.spatialReference.wkid;
   if(wkid===4326)map.fitBounds([[extent.ymin,extent.xmin],[extent.ymax,extent.xmax]]);
   else if([3857,102100,102113].includes(wkid)){
      var sw=L.CRS.EPSG3857.unproject(L.point(extent.xmin,extent.ymin)),
       ne=L.CRS.EPSG3857.unproject(L.point(extent.xmax,extent.ymax));
      map.fitBounds(L.latLngBounds(sw,ne));
   }else c.showAlert('Unknown spatial reference','Fit extent does not support WKID '+wkid,false);
 }));
 if(layerMode)toolbar.appendChild(B('Use visible extent','ge-secondary',()=>{
   var b=map.getBounds(),m=getModel();
   m.spatial={west:b.getWest(),east:b.getEast(),south:b.getSouth(),north:b.getNorth()};
   m.page=0;m.ids=null;s.exportContext={where:m.where||'1=1',bbox:m.spatial,ids:null};
   c.setTab('data');loadRows(m);
 }));
 var first=null,rectangle=null,drawBtn=B('Draw selection area','ge-secondary',()=>{
   s.spatialDrawing=!s.spatialDrawing;first=null;
   drawBtn.textContent=s.spatialDrawing?'Cancel drawing':'Draw selection area';
   if(!s.spatialDrawing&&rectangle){map.removeLayer(rectangle);rectangle=null;}
 });
 if(layerMode)toolbar.appendChild(drawBtn);
 var opacity=E('input');opacity.type='range';opacity.min='0';opacity.max='1';opacity.step='.1';opacity.value=s.mapOpacity??.8;
 opacity.setAttribute('aria-label','Map overlay opacity');
 opacity.addEventListener('input',()=>{
   s.mapOpacity=Number(opacity.value);
   if(s.overlay)s.overlay.setOpacity(s.mapOpacity);
   if(s.vectorLayer)s.vectorLayer.setStyle({opacity:s.mapOpacity,fillOpacity:s.mapOpacity*.2});
 });
 add(toolbar,E('span','ge-muted','Opacity'),opacity);
 card.insertBefore(toolbar,frame);
 map.on('click',function(e){
   if(!layerMode || !s.spatialDrawing)return;
   if(!first){first=e.latlng;rectangle=L.rectangle(L.latLngBounds(first,first),{color:'#245e9b',fillOpacity:.08}).addTo(map);return;}
   var bounds=L.latLngBounds(first,e.latlng);
   if(rectangle)rectangle.setBounds(bounds);
   var m=getModel();m.spatial={west:bounds.getWest(),east:bounds.getEast(),south:bounds.getSouth(),north:bounds.getNorth()};
   s.exportContext={where:m.where||'1=1',bbox:m.spatial,ids:null};s.spatialDrawing=false;
   drawBtn.textContent='Draw selection area';first=null;
   c.showAlert('Area selected','The selected rectangle will be used in Data and Export.',false);
 });
 var control=E('details','ge-disclosure ge-map-layers'),summary=E('summary','','Map layers and legend');
 control.appendChild(summary);var area=E('div','ge-layer-controls');control.appendChild(area);
 toolbar.after(control);
 var match=contextUrl.match(/^(.*\/(?:MapServer|FeatureServer))(?:\/\d+)?$/i);
 if(match){
   c.read(c.jsonUrl(match[1])).then(meta=>{
     if(!area.isConnected)return;
     var layerList=meta.layers||[];
     if(/\/FeatureServer\/\d+$/i.test(contextUrl))layerList=layerList.filter(x=>x.id===Number(contextUrl.split('/').pop()));
     var ids=Array.isArray(s.visibleMapLayers)?s.visibleMapLayers.slice():
       (/\/\d+$/.test(contextUrl)?[Number(contextUrl.split('/').pop())]:layerList.filter(l=>l.defaultVisibility).map(l=>l.id));
     s.visibleMapLayers=ids;
     if(!layerList.length){area.appendChild(E('span','ge-muted','No map layer list available.'));return;}
     layerList.forEach(l=>{
       var label=E('label','ge-check'),input=E('input');input.type='checkbox';input.checked=ids.includes(l.id);
       input.addEventListener('change',()=>{
         if(input.checked){if(!s.visibleMapLayers.includes(l.id))s.visibleMapLayers.push(l.id);}
         else s.visibleMapLayers=s.visibleMapLayers.filter(id=>id!==l.id);
         c.refreshOverlay();
       });
       add(label,input,E('span','',l.name||('Layer '+l.id)));area.appendChild(label);
     });
     c.read(c.jsonUrl(match[1]+'/legend')).then(legend=>{
       var rows=(legend.layers||[]).filter(l=>layerList.some(x=>x.id===l.layerId));
       rows.forEach(l=>{
         var section=E('div','ge-legend-group');section.appendChild(E('strong','',layerList.find(x=>x.id===l.layerId)?.name||'Layer '+l.layerId));
         (l.legend||[]).slice(0,40).forEach(item=>{
           var div=E('div','ge-legend-row');
           if(item.imageData && /^image\/(png|jpeg|gif)$/i.test(item.contentType||'')){
             var image=E('img');image.alt='';image.src='data:'+item.contentType+';base64,'+item.imageData;
             div.appendChild(image);
           }
           div.appendChild(E('span','',item.label||'Symbol'));section.appendChild(div);
         });
         area.appendChild(section);
       });
     }).catch(()=>{});
   }).catch(e=>{showStatus(area,'Layer controls unavailable: '+e.message,true);});
 }
 // Highlight a table selection on the map; cap at 50 features for responsiveness.
 var focus=s.focusOids?.slice(0,50),focusWhere=s.focusWhere;
 if((focus?.length||focusWhere)&&/\/\d+$/.test(contextUrl)){
   var params={outFields:'*',outSR:4326,returnGeometry:'true',resultRecordCount:300};
   if(focus?.length)params.objectIds=focus.join(',');
   else{
     params.where=focusWhere;
     if(s.focusBBox){
       var b=s.focusBBox;
       Object.assign(params,{geometry:JSON.stringify({xmin:b.west,ymin:b.south,xmax:b.east,ymax:b.north,
         spatialReference:{wkid:4326}}),geometryType:'esriGeometryEnvelope',inSR:4326,
         spatialRel:'esriSpatialRelIntersects'});
     }
   }
   c.post(contextUrl+'/query',params).then(data=>{
     if(s.map!==map||!data.features?.length)return;
     var layer=L.featureGroup().addTo(map);
     data.features.forEach(f=>{
       var geometry=f.geometry,shape;
       if(!geometry)return;
       if(geometry.x!==undefined&&geometry.y!==undefined)shape=L.circleMarker([geometry.y,geometry.x],{radius:8,color:'#ff8d00',weight:3});
       else if(geometry.paths)shape=L.polyline(geometry.paths.map(p=>p.map(pt=>[pt[1],pt[0]])),{color:'#ff8d00',weight:4});
       else if(geometry.rings)shape=L.polygon(geometry.rings.map(r=>r.map(pt=>[pt[1],pt[0]])),{color:'#ff8d00',weight:3,fillOpacity:.12});
       if(shape)layer.addLayer(shape);
     });
     if(layer.getLayers().length)map.fitBounds(layer.getBounds().pad(.3),{maxZoom:17});
   }).catch(e=>c.showAlert('Map highlight unavailable',e.message,true));
 }
}
function renderCompare(host){
 var card=C().createCard('Compare layer schemas','Compare this layer with another ArcGIS REST layer (no data is modified).');
 var info=E('p','ge-muted','Enter a second layer URL. Cross-server comparisons require the other server to permit browser access.');
 var input=E('input','ge-input');input.type='url';input.placeholder='https://server.example.com/arcgis/rest/services/.../MapServer/0';
 var result=E('div','ge-compare-result');
 var btnCompare=B('Compare schemas','ge-primary',async()=>{
   var u;
   try{
     u=new URL(input.value.trim());
     if(u.protocol!=='https:'||!u.pathname.includes('/rest/services/')||!/\/(?:MapServer|FeatureServer)\/\d+$/i.test(u.pathname))throw Error('Enter a layer REST URL ending in /MapServer/ID or /FeatureServer/ID.');
   }catch(e){showStatus(result,'Invalid comparison URL: '+e.message,true);return;}
   showStatus(result,'Comparing fields…');
   try{
     // If another host, core.read does not apply a credential from the current host.
     var other=await C().read(C().jsonUrl(u.href)),a=metadata(),aFields=new Map((a.fields||[]).map(f=>[f.name.toLowerCase(),f])),
     bFields=new Map((other.fields||[]).map(f=>[f.name.toLowerCase(),f]));
     var rows=[];
     aFields.forEach((v,k)=>{
       var b=bFields.get(k);
       if(!b)rows.push([v.name,'Only in current layer','']);
       else{
         var changes=[];
         ['type','length','nullable','editable'].forEach(p=>{if(v[p]!==b[p])changes.push(p+': '+textSafe(v[p])+' → '+textSafe(b[p]));});
         if(changes.length)rows.push([v.name,'Changed',changes.join('; ')]);
       }
     });
     bFields.forEach((v,k)=>{if(!aFields.has(k))rows.push([v.name,'Only in comparison layer',''])});
     result.replaceChildren();
     result.appendChild(E('p','ge-muted','Current: '+aFields.size+' fields · Comparison: '+bFields.size+' fields · '+rows.length+' differences'));
     var table=E('table','ge-data-table'),head=E('tr');
     ['Field','Difference','Details'].forEach(t=>head.appendChild(E('th','',t)));
     var thead=E('thead');thead.appendChild(head);table.appendChild(thead);
     var tbody=E('tbody');rows.forEach(parts=>{var tr=E('tr');parts.forEach(p=>tr.appendChild(E('td','',p)));tbody.appendChild(tr)});
     table.appendChild(tbody);var scroll=E('div','ge-table-scroll');scroll.appendChild(table);result.appendChild(scroll);
     if(!rows.length)result.appendChild(E('p','ge-muted','No field-definition differences found.'));
     if(a.geometryType!==other.geometryType)result.appendChild(E('p','ge-error','Geometry type differs: '+textSafe(a.geometryType)+' vs '+textSafe(other.geometryType)));
     var counts=E('div','ge-compare-counts');result.appendChild(counts);
     var currentApi=C().post(layerUrl()+'/query',{where:'1=1',returnCountOnly:'true'});
     var otherApi=C().read(C().buildUrl(u.href+'/query',{where:'1=1',returnCountOnly:'true',f:'json'}));
     var pair=await Promise.allSettled([currentApi,otherApi]);
     counts.appendChild(E('p','ge-muted','Record counts: current '+
       (pair[0].status==='fulfilled'?Number(pair[0].value.count||0).toLocaleString():'unavailable')+
       ' · comparison '+(pair[1].status==='fulfilled'?Number(pair[1].value.count||0).toLocaleString():'unavailable')+
       '. Counts reflect the server at the time of this check.'));
   }catch(e){showStatus(result,'Comparison failed: '+e.message,true);}
 });
 add(card.card,info,input,btnCompare,result);host.appendChild(card.card);
}
function renderConnections(host){
 var d=C().createCard('Use this service elsewhere','Copy REST connection details without embedding credentials.');
 var actions=E('div','ge-flex ge-controls'),url=layerUrl();
 function copy(s){navigator.clipboard.writeText(s).then(()=>C().showAlert('Copied','Connection details copied.',false)).catch(e=>C().showAlert('Copy failed',e.message,true))}
 actions.appendChild(B('Copy REST URL','ge-secondary',()=>copy(url)));
 actions.appendChild(B('Python example','ge-secondary',()=>copy('import requests\nurl = '+JSON.stringify(url+'/query')+'\nparams = {"where":"1=1","outFields":"*","returnGeometry":"false","f":"json"}\nresponse = requests.get(url,params=params,timeout=30)\nresponse.raise_for_status()\ndata = response.json()\nprint(len(data.get("features",[])))\n# Add your organization-approved authentication if required.')));
 actions.appendChild(B('Power Query example','ge-secondary',()=>copy('let\n  Source = Json.Document(Web.Contents('+JSON.stringify(url+'/query')+', [Query=[where="1=1", outFields="*", returnGeometry="false", f="json"]])),\n  Features = Source[features]\nin\n  Features')));
 d.card.appendChild(actions);d.card.appendChild(E('p','ge-muted','ArcGIS Pro and QGIS can use the REST service URL through their ArcGIS REST connections when the service supports it.'));host.appendChild(d.card);
}
function beforeNavigate(url){
 var m=models.get(currentUrl);
 if(m)m.requestId++;
 currentUrl=url;
}
function afterNavigate(url,data){
 currentUrl=url;
 // Only store URL paths, never tokens, responses, or sensitive records.
 var recent=safeStorageRead(recentKey).filter(x=>x!==url);
 safeStorageWrite(recentKey,[url,...recent].slice(0,12));
 setupExtras();
}
function setupExtras(){
 if(searchWired)return;
 var fav=document.getElementById('gisFavoritesBtn'),field=document.getElementById('gisFieldSearch'),
     panel=document.getElementById('gisFavoritePanel');
 if(!fav||!field||!panel)return;
 searchWired=true;
 panel.setAttribute('role','region');
 panel.setAttribute('aria-label','Saved and recently viewed ArcGIS resources');

 field.addEventListener('change',()=>{
   var c=current();if(!c)return;c.searchFieldNames=field.checked;
   if(c.tree.query.trim()){
     c.tree.token++;
     document.getElementById('filterInput').dispatchEvent(new Event('input'));
   }
 });
 function close(focus){
   panel.hidden=true;
   fav.setAttribute('aria-expanded','false');
   if(focus)fav.focus();
 }
 function renderSaved(){
   panel.replaceChildren();
   var head=E('div','ge-favorite-head');
   head.appendChild(E('strong','','Saved resources'));
   var closeButton=B('×','ge-favorite-close',()=>close(true));
   closeButton.setAttribute('aria-label','Close saved resources');
   head.appendChild(closeButton);
   panel.appendChild(head);
   var saved=safeStorageRead(favoritesKey),recent=safeStorageRead(recentKey);
   [['Favorites',saved],['Recent',recent]].forEach(([label,items])=>{
     var section=E('section','ge-favorite-section');
     section.appendChild(E('h4','',label+' ('+items.length+')'));
     if(!items.length)section.appendChild(E('p','ge-muted',label==='Favorites'?'No saved layers yet.':'No recently viewed layers.'));
     items.forEach(url=>{
       var row=E('div','ge-favorite-row');
       var link=B(url.split('/').filter(Boolean).slice(-2).join('/')||url,'ge-favorite-link',()=>{
         close(false);C().navigate(url);
       });
       link.title=url;
       row.appendChild(link);
       if(label==='Favorites'){
         var remove=B('×','ge-favorite-remove',()=>{
           safeStorageWrite(favoritesKey,safeStorageRead(favoritesKey).filter(x=>x!==url));
           renderSaved();
         });
         remove.setAttribute('aria-label','Remove saved layer '+url);
         remove.title='Remove favorite';
         row.appendChild(remove);
       }
       section.appendChild(row);
     });
     panel.appendChild(section);
   });
 }
 fav.addEventListener('click',()=>{
   if(!panel.hidden){close(false);return;}
   var options=document.getElementById('gisSearchOptionsPanel'),
       optsButton=document.getElementById('gisSearchOptionsBtn');
   if(options)options.hidden=true;
   if(optsButton)optsButton.setAttribute('aria-expanded','false');
   renderSaved();
   panel.hidden=false;
   fav.setAttribute('aria-expanded','true');
 });
 document.addEventListener('pointerdown',e=>{
   if(!panel.hidden && !panel.contains(e.target) && !fav.contains(e.target))close(false);
 });
 document.addEventListener('keydown',e=>{
   if(e.key==='Escape'&&!panel.hidden){e.preventDefault();close(true);}
 });
}
function resetSensitive(){
 models.forEach(x=>{x.requestId++;x.records=[];x.selected.clear();x.count=null;x.hasLoaded=false;x.ids=null;x.detailId=null;x.spatial=null;});
 models.clear();currentUrl='';
 var s=current();if(s){s.exportContext=null;s.focusOids=null;s.focusWhere=null;s.focusBBox=null;s.visibleMapLayers=null;}
}
window.GISEnhancements={renderData,renderIntro,renderOverviewAddon,onMap,refreshVectorOverlay,renderCompare,renderConnections,beforeNavigate,afterNavigate,
 getModel,currentWhere,spatialParams,setupExtras,resetSensitive};
})();
