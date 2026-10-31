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
   m.join=x.join==='OR'?'OR':'AND';m.search=x.search||'';m.searchField=x.searchField||'';
   m.advanced=x.advanced||'';m.sort=x.sort||'';m.descending=!!x.descending;
   m.hiddenFields=new Set(x.hiddenFields||[]);m.pageSize=x.pageSize||50;
   m.spatial=x.spatial||null;m.filtersOpen=false;m.selected.clear();
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
   join:m.join,advanced:m.advanced,search:m.search,searchField:m.searchField,sort:m.sort,
   descending:m.descending,hiddenFields:Array.from(m.hiddenFields),pageSize:m.pageSize,spatial:m.spatial};
  if(!store([entry,...stored().filter(x=>!(x.url===entry.url&&x.name===entry.name))]))
    C().showAlert('Could not save view','Browser storage may be disabled.',true);
  rerender();
 }));
 box.appendChild(contents);host.appendChild(box);
}
function decorate(host,m){
 var outer=host.querySelector('#geData');if(!outer)return;
 outer.classList.add('gx-workspace');
 var cards=Array.from(outer.children).filter(x=>x.classList.contains('ge-card'));
 var filters=cards[0],results=cards[1],inspector=document.getElementById('geRecordDetails'),summary=cards.find(x=>x!==filters&&x!==results&&x!==inspector);
 if(!filters||!results)return;
 var bar=el('div','gx-explore-header');
 var title=el('div','gx-heading');add(title,el('h2','','Explore records'),el('span','gx-sub','Read-only · server queries'));bar.appendChild(title);
 var tools=el('div','gx-toolbar');
 var fieldList=fields().filter(f=>/^esriFieldType(?:String|GUID|GlobalID|SmallInteger|Integer|BigInteger|Double|Single)$/i.test(f.type||''));
 var field=el('select','gx-search-field');
 field.setAttribute('aria-label','Search field');
 fieldList.forEach(f=>{var op=el('option','',fieldLabel(f));op.value=f.name;field.appendChild(op);});
 if(!m.searchField||!fieldList.some(f=>f.name===m.searchField)){
  var preferred=fieldList.find(f=>f.name===C().state.data.displayField)||fieldList.find(f=>/name|asset|ufid|id/i.test(f.name))||fieldList[0];
  m.searchField=preferred?.name||'';
 }
 field.value=m.searchField;
 var search=el('input','gx-search-input');search.type='search';search.placeholder='Search this field…';
 search.value=m.search||'';search.setAttribute('aria-label','Search records in selected field');
 var searchBox=el('div','gx-search-box');add(searchBox,field,search);
 if(!fieldList.length)searchBox.hidden=true;
 function executeSearch(){
   var previous=m.search,previousField=m.searchField;
   m.search=search.value.trim();m.searchField=field.value;
   try{m.where=G().buildWhere(m);apply(m);}
   catch(error){m.search=previous;m.searchField=previousField;C().showAlert('Search unavailable',error.message,true);}
 }
 search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();executeSearch();}});
 field.addEventListener('change',()=>{m.searchField=field.value;});
 add(searchBox,button('Search','gx-search-run',executeSearch));
 tools.appendChild(searchBox);
 tools.appendChild(button('Filters'+(m.filters.length?' · '+m.filters.length:''),'gx-tool-button',()=>{
  m.filtersOpen=!m.filtersOpen;rerender();
 }));
 tools.appendChild(button('Analyze','gx-tool-button',()=>C().setTab('analyze')));
 viewsPopup(tools,m);bar.appendChild(tools);outer.insertBefore(bar,filters);
 var chips=el('div','gx-active-chips');
 if(m.search)chips.appendChild(button('Search: '+m.search+' ×','gx-chip',()=>{
   m.search='';m.where=G().buildWhere(m);rerender();apply(m);
 }));
 m.filters.forEach((f,i)=>chips.appendChild(button(f.field+' '+f.op+' '+(f.value||'')+' ×','gx-chip',()=>{
  m.filters.splice(i,1);m.where=G().buildWhere(m);rerender();apply(m);
 })));
 if(m.spatial)chips.appendChild(button('Map area ×','gx-chip',()=>{
  m.spatial=null;rerender();apply(m);
 }));
 if(chips.childNodes.length)outer.insertBefore(chips,filters);
 filters.classList.add('gx-filter-pane');filters.hidden=!m.filtersOpen;
 results.classList.add('gx-results');
 var settings=results.querySelector('.ge-table-settings');
 if(settings)settings.open=Boolean(m.settingsOpen);
 var actionMenu=results.querySelector('.ge-action-menu');
 if(actionMenu)actionMenu.open=Boolean(m.actionsOpen);
 if(summary)summary.hidden=true;
 if(inspector){
  inspector.classList.add('gx-inspector');
  if(m.detailId===null)inspector.hidden=true;
 }
 if(m.detailId!==null)openInspector(m);
 // Automatically populate one bounded page. Never download an entire layer implicitly.
 if(!m.hasLoaded){
  m.hasLoaded=true;
  Promise.resolve().then(()=>{if(C().state.url===m.url){G().loadRows(m);G().loadCount(m);}});
 }
}
function clearInspector(){
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
 document.body.appendChild(shade);document.body.classList.add('gx-inspector-visible');
 var top=el('div','gx-inspector-top');
 add(top,el('strong','','Record details'),button('Close ×','gx-tool-button',close));
 panel.insertBefore(top,panel.firstChild);
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
      m.filters.push({field:f.name,op:row.raw===null?'IS NULL':'=',value:row.raw===null?'':String(row.raw)});
      m.page=0;m.count=null;m.ids=null;m.filtersOpen=false;m.where=G().buildWhere(m);
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
window.GISWorkspace={decorate:decorate,openInspector:openInspector,clearInspector:clearInspector,renderAnalyze:renderAnalyze};
})();
