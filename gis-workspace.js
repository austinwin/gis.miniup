/* GIS Explorer workspace: presentation and server-side field analysis.
   No credentials, query results, or tokens are persisted. */
(function () {
'use strict';
var STORAGE_KEY='gis-explorer-workspace-views-v1';
function C(){return window.GISCore;}
function G(){return window.GISEnhancements;}
function el(tag,cls,label){var x=document.createElement(tag);if(cls)x.className=cls;if(label!==undefined)x.textContent=String(label);return x;}
function button(label,cls,handler){var x=el('button',cls,label);x.type='button';x.addEventListener('click',handler);return x;}
function add(parent){for(var i=1;i<arguments.length;i++)if(arguments[i])parent.appendChild(arguments[i]);return parent;}
function fieldLabel(f){return f.alias||f.name;}
function fields(){return C().state.data?.fields||[];}
function choice(f){return /^esriFieldType(String|GUID|GlobalID|SmallInteger|Integer)$/i.test(f.type||'')||Boolean(f.domain?.codedValues);}
function numbers(f){return /esriFieldType(?:SmallInteger|Integer|BigInteger|Double|Single)$/i.test(f.type||'')&&!/OBJECTID|\bOID\b/i.test(f.name);}
function stored(){try{var a=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');return Array.isArray(a)?a:[]}catch(e){return [];}}
function store(a){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(a.slice(0,40)));return true}catch(e){return false;}}
function active(){var st=C()?.state;return st?.data&&Array.isArray(st.data.fields)&&st.data.type!=='Group Layer';}
function rerender(){var host=document.getElementById('content');if(host&&active())G().renderData(host);}
function apply(m){m.page=0;m.ids=null;m.count=null;m.tableScrollTop=0;G().loadRows(m);G().loadCount(m);}
function viewsPopup(host,m){
 var box=el('details','gx-view-menu'),head=el('summary','','Saved views');box.appendChild(head);
 var contents=el('div','gx-view-pop'),list=stored().filter(x=>x.url===m.url);
 if(!list.length)contents.appendChild(el('p','gx-muted','No saved views for this layer.'));
 list.forEach(x=>{
  var row=el('div','gx-saved-row');
  row.appendChild(button(x.name,'gx-quiet',()=>{
   m.filters=(x.filters||[]).map(f=>({field:f.field,op:f.op,value:f.value}));
   m.quickFilters=(x.quickFilters||[]).map(f=>({field:f.field,op:f.op,value:f.value}));
   m.join=x.join==='OR'?'OR':'AND';m.search=x.search||'';m.searchField=x.searchField||'';
   m.advanced=x.advanced||'';m.sort=x.sort||'';m.descending=!!x.descending;
   m.hiddenFields=new Set(x.hiddenFields||[]);m.pageSize=x.pageSize||50;
   m.spatial=x.spatial||null;m.quickOpen=false;m.advancedMode=false;m.searchDraft=m.search;m.selected.clear();m.facetCache=new Map();
   try{m.where=G().buildWhere(m);}catch(error){C().showAlert('Saved view unavailable',error.message,true);return;}
   box.open=false;rerender();apply(m);
  }));
  row.appendChild(button('×','gx-quiet gx-delete',()=>{
    store(stored().filter(v=>!(v.url===x.url&&v.name===x.name)));rerender();
  }));contents.appendChild(row);
 });
 contents.appendChild(button('+ Save current view','gx-small-primary',()=>{
  var name=window.prompt('Name this view (saved in this browser):','My view');
  if(!name||!name.trim())return;
  var entry={url:m.url,name:name.trim().slice(0,60),filters:m.filters.map(f=>({field:f.field,op:f.op,value:f.value})),
   quickFilters:(m.quickFilters||[]).map(f=>({field:f.field,op:f.op,value:f.value})),
   join:m.join,advanced:m.advanced,search:m.search,searchField:m.searchField,sort:m.sort,
   descending:m.descending,hiddenFields:Array.from(m.hiddenFields),pageSize:m.pageSize,spatial:m.spatial};
  if(!store([entry,...stored().filter(x=>!(x.url===entry.url&&x.name===entry.name))]))
    C().showAlert('Could not save view','Browser storage may be disabled.',true);
  rerender();
 }));
 box.appendChild(contents);host.appendChild(box);
}

function removeQuick(m,field){
 m.quickFilters=(m.quickFilters||[]).filter(f=>f.field!==field);
}
function fieldValueLabel(f,value){
 if(value===null||value===undefined)return '(Empty / null)';
 var found=f.domain?.codedValues?.find(x=>String(x.code)===String(value));
 return String(found?.name??(window.GISFields?.format?window.GISFields.format(f,value):value));
}
function quickFacetPane(m){
 var pane=el('section','gx-quick-filters');
 var head=el('div','gx-quick-head');
 add(head,el('div','', ''),button('Close ×','gx-quiet',()=>{m.quickOpen=false;rerender();}));
 head.firstChild.appendChild(el('h3','','Filter by a value'));
 head.firstChild.appendChild(el('p','gx-muted','Pick a field, then a value. Counts come from the ArcGIS server when supported.'));
 pane.appendChild(head);
 var candidates=fields().filter(f=>/esriFieldType(?:String|GUID|GlobalID|SmallInteger|Integer|BigInteger)/i.test(f.type||'')||f.domain?.codedValues?.length);
 var selection=m.quickField;
 if(!candidates.some(f=>f.name===selection)){
  selection=(candidates.find(f=>/status|material|condition|type|category|district|area|owner/i.test(f.name+' '+fieldLabel(f)))||
    candidates.find(f=>f.domain?.codedValues?.length)||candidates[0])?.name||'';
  m.quickField=selection;
 }
 var row=el('div','gx-quick-controls');
 var label=el('label','gx-quick-select-label','Field');
 var select=el('select','gx-select');
 candidates.forEach(f=>{var op=el('option','',fieldLabel(f));op.value=f.name;select.appendChild(op);});
 select.value=selection;
 select.addEventListener('change',()=>{m.quickField=select.value;m.facetSearch='';rerender();});
 label.appendChild(select);row.appendChild(label);
 if(selection&&(m.quickFilters||[]).some(f=>f.field===selection)){
  row.appendChild(button('Remove this filter','gx-tool-button',()=>{removeQuick(m,selection);rerender();apply(m);}));
 }
 pane.appendChild(row);
 var output=el('div','gx-facet-list');
 pane.appendChild(output);
 if(!selection){
  output.appendChild(el('p','gx-muted','No categorical fields are available. Use Advanced filters for other field types.'));
  return pane;
 }
 var f=candidates.find(x=>x.name===selection);
 var filtered=Object.assign({},m,{quickFilters:(m.quickFilters||[]).filter(x=>x.field!==selection)});
 var where;
 try{where=G().buildWhere(filtered);}catch(error){output.textContent=error.message;return pane;}
 var key=JSON.stringify([selection,where,m.spatial||null]);
 m.facetCache=m.facetCache||new Map();
 var cached=m.facetCache.get(key);
 m.facetVersion=(m.facetVersion||0)+1;
 var version=m.facetVersion;
 function draw(data){
  if(!output.isConnected||!m.quickOpen||m.quickField!==selection)return;
  output.replaceChildren();
  if(!data.rows.length){output.appendChild(el('p','gx-muted','No values found. Try a different field or clear other filters.'));return;}
  var items=el('div','gx-facet-items');
  if(data.rows.length>12){
   var search=el('input','gx-facet-search');
   search.type='search';search.placeholder='Find among these loaded values…';
   search.setAttribute('aria-label','Find within loaded filter values');
   search.value=m.facetSearch||'';
   search.addEventListener('input',()=>{
    m.facetSearch=search.value;
    var q=search.value.toLowerCase().trim();
    items.querySelectorAll('button').forEach(b=>{b.hidden=!!q&&!b.textContent.toLowerCase().includes(q);});
   });
   output.appendChild(search);
  }
  data.rows.forEach(v=>{
   var current=(m.quickFilters||[]).some(q=>q.field===f.name&&String(q.value)===String(v.value)&&
    (v.value===null?q.op==='IS NULL':q.op==='='));
   var opt=button('','gx-facet-option'+(current?' is-active':''),()=>{
    var previous=(m.quickFilters||[]).slice();
    removeQuick(m,f.name);
    if(!current)m.quickFilters.push({field:f.name,op:v.value===null?'IS NULL':'=',value:v.value===null?'':v.value});
    try{m.where=G().buildWhere(m);}
    catch(error){m.quickFilters=previous;C().showAlert('Cannot apply filter',error.message,true);return;}
    m.quickOpen=false;rerender();apply(m);
   });
   opt.setAttribute('aria-pressed',String(current));
   add(opt,el('span','',fieldValueLabel(f,v.value)),
     el('span','gx-facet-number',v.count===null?(current?'✓':''):v.count.toLocaleString()));
   items.appendChild(opt);
  });
  output.appendChild(items);
  if(m.facetSearch){
   var q=m.facetSearch.toLowerCase().trim();
   items.querySelectorAll('button').forEach(b=>{b.hidden=!!q&&!b.textContent.toLowerCase().includes(q);});
  }
  output.appendChild(el('p','gx-muted',data.limited?
   'Showing a limited set of values, not every category. Use Advanced filters to enter a value not shown.':
   data.counts?'Counts are calculated across matching server records.':'Available distinct values; counts are not provided by this service.'));
 }
 if(cached){draw(cached);return pane;}
 output.appendChild(el('p','gx-muted','Loading values from the server…'));
 (async()=>{
  var limit=Math.min(100,Math.max(20,Number(C().state.data.maxRecordCount)||100));
  var base=Object.assign({where,returnGeometry:'false'},G().spatialParams(m));
  var data,result;
  try{
   if(C().state.data.advancedQueryCapabilities?.supportsStatistics===false||C().state.data.supportsStatistics===false)
    throw Error('Statistics unavailable');
   data=await C().post(m.url+'/query',Object.assign({},base,{outFields:f.name,
     groupByFieldsForStatistics:f.name,
     outStatistics:JSON.stringify([{statisticType:'count',onStatisticField:G().oidField(),outStatisticFieldName:'GX_QUICK_COUNT'}]),
     resultRecordCount:limit}));
   var features=data.features||[];
   result={rows:features.map(q=>({value:q.attributes?.[f.name]??null,count:Number(q.attributes?.GX_QUICK_COUNT)||0}))
     .sort((x,y)=>y.count-x.count),limited:!!data.exceededTransferLimit||features.length>=limit,counts:true};
  }catch(error){
   try{
    data=await C().post(m.url+'/query',Object.assign({},base,{outFields:f.name,returnDistinctValues:'true',
     resultRecordCount:limit,orderByFields:f.name+' ASC'}));
    var features=data.features||[];
    result={rows:features.map(q=>({value:q.attributes?.[f.name]??null,count:null})),
      limited:!!data.exceededTransferLimit||features.length>=limit,counts:false};
   }catch(fallback){
    if(f.domain?.codedValues?.length){
     result={rows:f.domain.codedValues.slice(0,limit).map(v=>({value:v.code,count:null})),
       limited:f.domain.codedValues.length>limit,counts:false};
    }else{
     if(output.isConnected&&m.quickField===selection)output.replaceChildren(el('p','gx-error',
       'This server cannot list values for this field. Use Advanced filters to enter a condition.'));
     return;
    }
   }
  }
  if(!output.isConnected||!m.quickOpen||m.quickField!==selection)return;
  if(version!==m.facetVersion)return;
  // Bounded cache only; no persistence of records or tokens.
  m.facetCache.set(key,result);
  if(m.facetCache.size>12)m.facetCache.delete(m.facetCache.keys().next().value);
  draw(result);
 })();
 return pane;
}
function decorate(host,m){
 var outer=host.querySelector('#geData');if(!outer)return;
 outer.classList.add('gx-workspace');
 var cards=Array.from(outer.children).filter(x=>x.classList.contains('ge-card'));
 var filters=cards[0],results=cards[1],inspector=document.getElementById('geRecordDetails'),summary=cards.find(x=>x!==filters&&x!==results&&x!==inspector);
 if(!filters||!results)return;
 var bar=el('div','gx-explore-header');
 var top=el('div','gx-topline');
 var heading=el('div','gx-heading');
 add(heading,el('h2','','Records'),el('span','gx-sub','Search, filter, and select records. Read-only.'));
 top.appendChild(heading);
 var description=el('div','gx-record-summary');
 description.appendChild(el('span','gx-record-pill',m.count===null?(m.countError?'Count unavailable':'Counting…'):m.count.toLocaleString()+' matching'));
 description.appendChild(el('span','gx-sub',fields().length+' fields'));
 top.appendChild(description);bar.appendChild(top);
 var toolbar=el('div','gx-toolbar');
 var fieldList=fields().filter(f=>/^esriFieldType(?:String|GUID|GlobalID|SmallInteger|Integer|BigInteger|Double|Single)$/i.test(f.type||''));
 if(!m.searchField||!fieldList.some(f=>f.name===m.searchField)){
  var preferred=fieldList.find(f=>f.name===C().state.data.displayField)||
   fieldList.find(f=>/name|asset|ufid|id/i.test(f.name))||fieldList[0];
  m.searchField=preferred?.name||'';
 }
 var searchBox=el('form','gx-search-box');
 searchBox.setAttribute('role','search');
 var search=el('input','gx-search-input');
 search.type='search';search.placeholder='Search records…';
 search.value=m.searchDraft===undefined?(m.search||''):m.searchDraft;
 search.setAttribute('aria-label','Search records');
 search.addEventListener('input',()=>{
  m.searchDraft=search.value;
  // Clearing the search control should clear the applied search too.
  if(!search.value&&m.search){m.search='';apply(m);}
 });
 var field=el('select','gx-search-field');field.setAttribute('aria-label','Search in field');
 fieldList.forEach(f=>{var op=el('option','',fieldLabel(f));op.value=f.name;field.appendChild(op);});
 field.value=m.searchField;
 field.addEventListener('change',()=>{m.searchField=field.value;});
 function executeSearch(e){
  if(e)e.preventDefault();
  var previous=m.search,previousField=m.searchField;
  m.search=search.value.trim();m.searchField=field.value;m.searchDraft=search.value;
  try{m.where=G().buildWhere(m);apply(m);}
  catch(error){m.search=previous;m.searchField=previousField;C().showAlert('Invalid search',error.message,true);}
 }
 searchBox.addEventListener('submit',executeSearch);
 var run=button('Search','gx-search-run',executeSearch);run.type='submit';
 add(searchBox,search,field,run);
 if(!fieldList.length)searchBox.hidden=true;
 toolbar.appendChild(searchBox);
 toolbar.appendChild(button('＋ Filter'+((m.quickFilters||[]).length?' · '+m.quickFilters.length:''),'gx-tool-button'+(m.quickOpen?' is-active':''),()=>{
  m.quickOpen=!m.quickOpen;m.advancedMode=false;rerender();
 }));
 var column=results.querySelector('.ge-column-config');
 if(column){
  column.remove();column.classList.add('gx-column-direct');
  column.open=Boolean(m.columnsOpen);
  toolbar.appendChild(column);
 }
 var actions=results.querySelector('.ge-action-menu');
 if(actions){
  actions.remove();actions.classList.add('gx-action-direct');
  actions.querySelector('summary').textContent='Actions';
  toolbar.appendChild(actions);
  viewsPopup(actions.querySelector('.ge-actions')||actions,m);
 }
 toolbar.appendChild(button('Advanced'+(m.filters.length||m.advanced?' •':''),'gx-tool-button'+(m.advancedMode?' is-active':''),()=>{
   m.advancedMode=!m.advancedMode;m.quickOpen=false;rerender();
 }));
 var help=button('?','gx-tool-button gx-help-button',()=>{
  m.helpOpen=!m.helpOpen;rerender();
 });help.setAttribute('aria-label','How to use this table');help.title='How to use';
 toolbar.appendChild(help);
 bar.appendChild(toolbar);
 outer.insertBefore(bar,filters);
 if(m.helpOpen){
  var tip=el('p','gx-help-copy','Choose a field to search and press Enter. Use + Filter to pick a value, click column headings to sort, or select a row to inspect details. Advanced opens precise conditions and SQL.');
  outer.insertBefore(tip,filters);
 }
 var chips=el('div','gx-active-chips');
 function chip(label,fn){chips.appendChild(button(label+' ×','gx-chip',fn));}
 if(m.search)chip('Search: '+m.search,()=>{m.search='';m.searchDraft='';rerender();apply(m);});
 (m.quickFilters||[]).forEach(f=>chip(fieldLabel(fields().find(x=>x.name===f.field)||{name:f.field})+': '+
   (f.op==='IS NULL'?'Empty':fieldValueLabel(fields().find(x=>x.name===f.field)||{name:f.field},f.value)),
   ()=>{removeQuick(m,f.field);rerender();apply(m);}));
 m.filters.forEach((f,i)=>chip(fieldLabel(fields().find(x=>x.name===f.field)||{name:f.field})+' '+f.op+' '+(f.value||''),()=>{
  m.filters.splice(i,1);rerender();apply(m);
 }));
 if(m.advanced?.trim())chip('SQL active',()=>{m.advanced='';rerender();apply(m);});
 if(m.spatial)chip('Map area',()=>{m.spatial=null;rerender();apply(m);});
 if(chips.childNodes.length){
  chips.appendChild(button('Clear all','gx-clear-all',()=>{
    m.quickFilters=[];m.filters=[];m.advanced='';m.search='';m.searchDraft='';m.spatial=null;
    m.selected.clear();m.quickOpen=false;rerender();apply(m);
  }));
  outer.insertBefore(chips,filters);
 }
 if(m.quickOpen)outer.insertBefore(quickFacetPane(m),filters);
 filters.classList.add('gx-filter-pane');
 filters.hidden=!m.advancedMode;
 filters.querySelector('.ge-header .ge-h-title')?.replaceChildren(document.createTextNode('Advanced filters'));
 var settings=results.querySelector('.ge-table-settings');
 if(settings)settings.open=Boolean(m.settingsOpen);
 results.classList.add('gx-results');
 var countLabel=results.querySelector('.ge-count');
 if(countLabel){countLabel.classList.add('gx-results-count');countLabel.textContent=
  m.count===null?(m.countError?'Count unavailable':'Counting…'):m.count.toLocaleString()+' matching records';}
 var head=results.querySelector('.ge-results-head');
 if(head){
  head.querySelector('h3')?.replaceChildren(document.createTextNode('Attribute table'));
  head.appendChild(el('span','gx-selection',m.selected.size?m.selected.size+' selected':'Select rows for actions'));
 }
 if(summary)summary.hidden=true;
 if(inspector){inspector.classList.add('gx-inspector');if(m.detailId===null)inspector.hidden=true;}
 if(m.detailId!==null)openInspector(m);
 else clearInspector();
 if(!m.hasLoaded){
  m.hasLoaded=true;
  Promise.resolve().then(()=>{if(C().state.url===m.url&&C().state.tab==='data'){
    G().loadRows(m);G().loadCount(m);
  }});
 }
}
function updateCount(m){
 if(C().state.url!==m.url)return;
 var label=m.count===null?(m.countError?'Count unavailable':'Counting…'):m.count.toLocaleString()+' matching';
 document.querySelectorAll('.gx-record-pill').forEach(x=>{x.textContent=label;x.title=m.countError||'Count of matching records from ArcGIS';});
 document.querySelectorAll('.gx-results-count').forEach(x=>{x.textContent=m.count===null?(m.countError?'Count unavailable':'Counting…'):m.count.toLocaleString()+' matching records';x.title=m.countError||'Count of matching records from ArcGIS';});
 var refresh=document.querySelector('.gx-results .ge-results-head>button');
 if(refresh)refresh.disabled=Boolean(m.counting);
}
function updateSelection(m){
 var node=document.querySelector('.gx-selection');
 if(node)node.textContent=m.selected.size?m.selected.size+' selected':'Select rows for actions';
}
var inspectorKeyHandler=null;
function clearInspector(){
 if(inspectorKeyHandler){document.removeEventListener('keydown',inspectorKeyHandler);inspectorKeyHandler=null;}
 document.getElementById('gx-inspector-shade')?.remove();
 document.body.classList.remove('gx-inspector-visible');
}
function openInspector(m){
 var panel=document.getElementById('geRecordDetails');if(!panel||m.detailId===null)return;
 clearInspector();
 panel.hidden=false;panel.classList.add('gx-inspector');
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
 panel.setAttribute('aria-label','Feature details');
 var shade=el('div','gx-inspector-shade');shade.id='gx-inspector-shade';
 function close(){m.detailId=null;clearInspector();rerender();}
 shade.addEventListener('click',close);
 inspectorKeyHandler=event=>{if(event.key==='Escape'){event.preventDefault();close();}};
 document.addEventListener('keydown',inspectorKeyHandler);
 document.body.appendChild(shade);document.body.classList.add('gx-inspector-visible');
 var top=el('div','gx-inspector-top');
 add(top,el('strong','','Record details'),button('Close ×','gx-tool-button',close));
 panel.insertBefore(top,panel.firstChild);
 top.querySelector('button')?.focus({preventScroll:true});
}
function selectField(parent,list,value,onChange){
 var s=el('select','gx-select');list.forEach(f=>{var o=el('option','',fieldLabel(f));o.value=f.name;s.appendChild(o);});
 if(value)s.value=value;s.addEventListener('change',()=>onChange(s.value));parent.appendChild(s);return s;
}
function metric(label,value,subtitle){
 var card=el('div','gx-metric');add(card,el('span','',label),el('strong','',String(value)),el('small','',subtitle||''));return card;
}
function empty(container,message){container.replaceChildren(el('p','gx-muted',message));}
function renderAnalyze(host){
 if(!active()){host.appendChild(el('p','gx-muted','Select a queryable feature layer or table.'));return;}
 var m=G().getModel(),d=C().state.data,all=fields(),categorical=all.filter(choice),numeric=all.filter(numbers);
 var root=el('section','gx-analysis');
 var heading=el('div','gx-analysis-title');
 add(heading,el('div','',''),button('← Explore records','gx-tool-button',()=>C().setTab('data')));
 heading.firstChild.appendChild(el('h2','','Understand this layer'));
 heading.firstChild.appendChild(el('p','gx-muted','Calculated on the ArcGIS server for the active attribute and map-area filters.'));
 root.appendChild(heading);
 var control=el('div','gx-analysis-controls'),categoryLabel=el('label','','Group records by'),numberLabel=el('label','','Summarize a number');
 var categoryPref=categorical.find(f=>/status|material|type|category|condition|district/i.test(f.name+' '+fieldLabel(f)))||categorical[0];
 var catValue=m.analysisCategory||categoryPref?.name||'';
 var numValue=m.analysisNumeric||numeric[0]?.name||'';
 selectField(categoryLabel,categorical,catValue,v=>{m.analysisCategory=v;run();});
 selectField(numberLabel,numeric,numValue,v=>{m.analysisNumeric=v;run();});
 control.appendChild(categoryLabel);control.appendChild(numberLabel);
 control.appendChild(button('Refresh analysis','gx-small-primary',()=>run()));
 root.appendChild(control);
 var context=el('p','gx-muted gx-scope','Scope: '+(m.where||G().buildWhere(m))+(m.spatial?' · Map area active':'')+'.');
 root.appendChild(context);
 var metrics=el('div','gx-metrics'),panels=el('div','gx-analysis-grid'),distribution=el('section','gx-analytic-card'),
  numericCard=el('section','gx-analytic-card');
 add(distribution,el('h3','','Category distribution'),el('div','gx-analysis-body','Loading…'));
 add(numericCard,el('h3','','Numeric summary'),el('div','gx-analysis-body','Loading…'));
 add(panels,distribution,numericCard);root.appendChild(metrics);root.appendChild(panels);
 host.appendChild(root);
 var request=0;
 async function run(){
  var runId=++request,url=m.url,chosen=categoryLabel.querySelector('select')?.value||'',selected=numberLabel.querySelector('select')?.value||'';
  var f=all.find(x=>x.name===chosen),num=all.find(x=>x.name===selected);
  var where;
  try{where=G().buildWhere(m);}catch(e){empty(metrics,e.message);return;}
  context.textContent='Scope: WHERE '+where+(m.spatial?' · Map area active':'');
  empty(distribution.querySelector('.gx-analysis-body'),f?'Loading server-side categories…':'No category fields.');
  empty(numericCard.querySelector('.gx-analysis-body'),num?'Loading server-side statistics…':'No numeric fields.');
  metrics.replaceChildren(metric('Matching records','…','Server count'),metric('Fields',all.length,'Layer schema'),metric('Map area',m.spatial?'Active':'None','Spatial filter'));
  var shared=G().spatialParams(m);
  var post=(params)=>C().post(url+'/query',Object.assign({where,returnGeometry:'false'},params,shared));
  var limit=Math.min(500,Math.max(20,Number(d.maxRecordCount)||100));
  var countPromise=post({returnCountOnly:'true'});
  var groupPromise=f?post({groupByFieldsForStatistics:f.name,
   outStatistics:JSON.stringify([{statisticType:'count',onStatisticField:G().oidField(),outStatisticFieldName:'GX_COUNT'}]),
   outFields:f.name,resultRecordCount:limit}):Promise.resolve(null);
  var numPromise=num?post({outStatistics:JSON.stringify(['min','max','avg','sum','count'].map(type=>({
   statisticType:type,onStatisticField:num.name,outStatisticFieldName:'GX_'+type.toUpperCase()})))}):Promise.resolve(null);
  var [total,groups,stats]=await Promise.allSettled([countPromise,groupPromise,numPromise]);
  if(runId!==request||C().state.url!==url||!root.isConnected)return;
  var totalCount=total.status==='fulfilled'?Number(total.value.count):null;
  metrics.replaceChildren(metric('Matching records',totalCount===null?'Unavailable':totalCount.toLocaleString(),'Full filter scope'),
   metric('Fields',all.length,'Layer schema'),metric('Map area',m.spatial?'Active':'None','Spatial filter'));
  if(total.status!=='fulfilled')metrics.appendChild(el('p','gx-error','Count unavailable: '+total.reason.message));
  var body=distribution.querySelector('.gx-analysis-body');body.replaceChildren();
  if(!f)body.appendChild(el('p','gx-muted','This layer has no compatible grouping fields.'));
  else if(groups.status==='rejected')body.appendChild(el('p','gx-error','Grouped statistics are unavailable: '+groups.reason.message));
  else {
   var features=groups.value?.features||[],rows=features.map(r=>({
      raw:r.attributes?.[f.name]??null,count:Number(r.attributes?.GX_COUNT)||0
    })).sort((a,b)=>b.count-a.count);
   var limited=Boolean(groups.value?.exceededTransferLimit)||features.length>=limit;
   var displayed=rows.slice(0,12),max=Math.max(1,...displayed.map(r=>r.count));
   var domain=f.domain?.codedValues||[];
   displayed.forEach(row=>{
    var label=row.raw===null?'(Null)':String(domain.find(x=>String(x.code)===String(row.raw))?.name??row.raw);
    var b=button('','gx-category',()=>{
      removeQuick(m,f.name);
      m.quickFilters=m.quickFilters||[];
      m.quickFilters.push({field:f.name,op:row.raw===null?'IS NULL':'=',value:row.raw===null?'':row.raw});
      m.page=0;m.count=null;m.ids=null;m.quickOpen=false;m.where=G().buildWhere(m);
      C().setTab('data');apply(m);
    });
    var line=el('div','gx-category-line');
    add(line,el('span','',label),el('strong','',row.count.toLocaleString()));
    var track=el('div','gx-category-track'),fill=el('div','gx-category-fill');
    fill.style.width=(100*row.count/max).toFixed(1)+'%';track.appendChild(fill);add(b,line,track);body.appendChild(b);
   });
   if(!rows.length)body.appendChild(el('p','gx-muted','No categories returned for this filter.'));
   body.appendChild(el('p','gx-muted',limited?
    'Only a bounded set of groups was returned. Rankings may be incomplete. Narrow the filter for reliable comparison.':
    'Counts cover the full matching dataset. Select a category to filter records.'));
  }
  var nbody=numericCard.querySelector('.gx-analysis-body');nbody.replaceChildren();
  if(!num)nbody.appendChild(el('p','gx-muted','No numeric fields to summarize.'));
  else if(stats.status==='rejected')nbody.appendChild(el('p','gx-error','Numeric statistics unavailable: '+stats.reason.message));
  else {
   var vals=stats.value?.features?.[0]?.attributes||{},grid=el('div','gx-numeric-grid');
   ['MIN','MAX','AVG','SUM','COUNT'].forEach(key=>{
    var raw=vals['GX_'+key],v=raw===null||raw===undefined?'—':Number(raw).toLocaleString(undefined,{maximumFractionDigits:2});
    grid.appendChild(metric(key==='AVG'?'Average':key==='COUNT'?'Non-null values':key==='MIN'?'Minimum':key==='MAX'?'Maximum':'Sum',v,''));
   });
   nbody.appendChild(grid);
   if(totalCount!==null&&Number.isFinite(Number(vals.GX_COUNT)))
    nbody.appendChild(el('p','gx-muted',(totalCount-Number(vals.GX_COUNT)).toLocaleString()+' records have no value for '+fieldLabel(num)+'.'));
   nbody.appendChild(el('p','gx-muted','Server-computed aggregates; current table page is not used.'));
  }
 }
 run();
}
window.GISWorkspace={decorate:decorate,openInspector:openInspector,clearInspector:clearInspector,renderAnalyze:renderAnalyze,updateCount:updateCount,updateSelection:updateSelection};
})();
