/* Direct public ArcGIS service import. A FeatureServer URL points to a service, not necessarily a layer.
   Pick sublayers next to the search result; never silently treat "browse" as "added". */
(function(){
'use strict';
function el(tag,cls,text){let e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;}
function button(text,cls,click){let b=el('button',cls,text);b.type='button';if(click)b.addEventListener('click',click);return b;}
function api(){return window.GISMapStudio.api;}
function error(host,msg){let n=host.querySelector('.ms-import-status');if(!n){n=el('p','ms-import-status');host.prepend(n);}n.textContent=msg;n.classList.add('is-error');}
function say(host,msg){let n=host.querySelector('.ms-import-status');if(!n){n=el('p','ms-import-status');host.prepend(n);}n.textContent=msg;n.classList.remove('is-error');}
function layerChoices(meta){
 return (Array.isArray(meta?.layers)?meta.layers:[]).filter(x=>x&&Number.isInteger(Number(x.id))&&Number(x.id)>=0
  &&x.type!=='Group Layer'&&x.type!=='Table'&&x.type!=='Annotation Layer'&&!x.subLayerIds?.length);
}
async function pick(s,url,host,opts={}){
 if(!host)return {status:'no-container'};
 const target=api().baseService(url);
 if(!target)throw Error('Invalid ArcGIS HTTPS FeatureServer or MapServer URL.');
 host.replaceChildren();say(host,'Checking the public GIS service…');
 if(target.layerId!==null){
  try{
   const l=await api().addLayer(s,target.url);
   say(host,l?'Added '+l.name:'Layer is already on the map.');
   return {status:'added',count:l?1:0};
  }catch(e){error(host,'Unable to add this layer: '+e.message);return {status:'error',reason:e.message};}
 }
 let info;
 try{info=await api().readMeta(s,target.url);}
 catch(e){
  error(host,'Cannot read the service: '+e.message+'. This service may restrict cross-origin requests or require its own login.');
  return {status:'error',reason:e.message};
 }
 const all=layerChoices(info);
 if(!all.length){
  error(host,'This service has no directly selectable spatial sublayers. It may contain tables or group layers only.');
  return {status:'empty'};
 }
 const available=Math.max(0,16-s.layers.length);
 if(!available){error(host,'Map is full (16 layers). Remove a layer before importing.');return {status:'full'};}
 if(all.length===1&&!opts.forceChoose){
  try{
   const l=await api().addLayer(s,target.root+'/'+all[0].id);
   say(host,l?'Added '+l.name:'Layer already added.');
   return {status:'added',count:l?1:0};
  }catch(e){error(host,'Could not add '+all[0].name+': '+e.message);return {status:'error',reason:e.message};}
 }
 host.replaceChildren();
 const title=el('div','ms-import-title');
 const h=el('strong','',String(info.serviceDescription||info.mapName||info.name||'Choose sublayers').slice(0,100));
 const close=button('×','ms-import-close',()=>host.replaceChildren());
 close.setAttribute('aria-label','Close layer choices');title.appendChild(h);title.appendChild(close);host.appendChild(title);
 const note=el('p','ms-import-hint',all.length+' sublayers found. Select up to '+available+' to add.');host.appendChild(note);
 const search=el('input','ms-input');search.type='search';search.placeholder='Find a sublayer…';
 search.setAttribute('aria-label','Search service sublayers');host.appendChild(search);
 const list=el('div','ms-import-list');host.appendChild(list);
 const selected=new Set(all.filter(x=>x.defaultVisibility).slice(0,Math.min(available,3)).map(x=>Number(x.id)));
 if(!selected.size)selected.add(Number(all[0].id));
 const actions=el('div','ms-import-actions');
 let submit=button('Add selected','ms-primary',()=>addSelected());
 let selectAll=button('Select visible','ms-small',()=>{
  selected.clear();all.filter(x=>x.defaultVisibility).slice(0,available).forEach(x=>selected.add(Number(x.id)));
  if(!selected.size)selected.add(Number(all[0].id));draw();
 });
 let cancel=button('Cancel','ms-small',()=>host.replaceChildren());
 actions.appendChild(submit);actions.appendChild(selectAll);actions.appendChild(cancel);host.appendChild(actions);
 const statusBox=el('p','ms-import-status');statusBox.setAttribute('role','status');host.appendChild(statusBox);
 function draw(){
  list.replaceChildren();
  const term=search.value.trim().toLowerCase();
  const matches=all.filter(x=>(x.name||('Layer '+x.id)).toLowerCase().includes(term));
  matches.slice(0,120).forEach(l=>{
   const id=Number(l.id),row=el('label','ms-import-item'),input=el('input');
   input.type='checkbox';input.checked=selected.has(id);input.value=String(id);
   input.addEventListener('change',()=>{
    if(input.checked){
     if(selected.size>=available){input.checked=false;error(host,'You can add up to '+available+' more layers.');return;}
     selected.add(id);
    }else selected.delete(id);
    submit.textContent='Add '+selected.size+' selected';
   });
   row.appendChild(input);
   let text=el('span','ms-import-item-label',l.name||('Layer '+id));row.appendChild(text);
   if(l.defaultVisibility)row.appendChild(el('small','ms-import-default','Default'));
   list.appendChild(row);
  });
  if(matches.length>120)list.appendChild(el('p','ms-import-hint','Showing first 120 matches. Narrow the search.'));
  if(!matches.length)list.appendChild(el('p','ms-import-hint','No matching sublayers.'));
  submit.textContent='Add '+selected.size+' selected';submit.disabled=selected.size===0;
 }
 async function addSelected(){
  if(!selected.size)return;
  const ids=[...selected],total=ids.length;submit.disabled=true;selectAll.disabled=true;
  const imported=[],failed=[];
  for(const id of ids){
   statusBox.classList.remove('is-error');
   statusBox.textContent='Adding '+(imported.length+failed.length+1)+' of '+total+'…';
   try{
    const layer=await api().addLayer(s,target.root+'/'+id);
    if(layer)imported.push(layer.name);
   }catch(e){failed.push('Layer '+id+': '+e.message);}
  }
  if(failed.length){
   statusBox.classList.add('is-error');
   statusBox.textContent=imported.length+' added; '+failed.length+' failed. '+failed.slice(0,2).join(' | ');
  }else statusBox.textContent=imported.length+' layer'+(imported.length===1?'':'s')+' added to map.';
  submit.disabled=false;selectAll.disabled=false;
  // The layer manager may rerender during addLayer; always report in persistent map notice too.
  const state=window.GISMapStudio.getState();
  if(state?.notice){state.notice.hidden=false;state.notice.textContent=statusBox.textContent;state.notice.classList.toggle('ms-error',!!failed.length);}
 }
 search.addEventListener('input',draw);draw();
 return {status:'choices',count:all.length};
}
window.GISServiceImport={pick,layerChoices};
})();
