/* Safe point-symbol presets for GIS Map Studio: circle, emoji, and trusted Lucide-style SVG icons.
   This module never evaluates user-provided SVG/HTML. */
(function(){
'use strict';
const ICONS={
 'map-pin':[['path','M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z'],['circle','12','10','2.5']],
 'droplets':[['path','M12 22a8 8 0 0 0 8-8c0-4-8-12-8-12S4 10 4 14a8 8 0 0 0 8 8Z']],
 'wrench':[['path','M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4L14 12l-2-2 2.7-3.7Z']],
 'factory':[['path','M2 22V9l6 4V9l6 4V4h8v18Z'],['path','M2 22h20']],
 'triangle-alert':[['path','m10.3 3.2-8.5 15A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.8l-8.5-15a2 2 0 0 0-3.4 0Z'],['line','12','9','12','13'],['line','12','17','12','17.01']],
 'house':[['path','m3 10 9-7 9 7v11H3V10Z'],['path','M9 21v-7h6v7']],
 'waves':[['path','M2 7c3 0 3-3 6-3s3 3 6 3 3-3 6-3h2'],['path','M2 14c3 0 3-3 6-3s3 3 6 3 3-3 6-3h2'],['path','M2 21c3 0 3-3 6-3s3 3 6 3 3-3 6-3h2']],
 'flame':[['path','M12 22c5 0 8-3.3 8-8 0-4-4-7-5-11-2 3-3 3-4 7-2-1-3-3-3-4-2 2-4 5-4 8 0 4.7 3 8 8 8Z']],
 'tree-pine':[['path','m12 2-6 8h3l-5 7h16l-5-7h3l-6-8Z'],['line','12','17','12','22']],
 'gauge':[['path','M12 14l4-4'],['path','M3 20a9 9 0 1 1 18 0Z'],['circle','12','14','1']],
 'circle-dot':[['circle','12','12','9'],['circle','12','12','3']],
 'locate-fixed':[['circle','12','12','3'],['line','12','2','12','5'],['line','12','19','12','22'],['line','2','12','5','12'],['line','19','12','22','12']]
};
const EMOJIS=['📍','💧','🚰','🏭','⚠️','🔥','🌳','🏠','🛠️','🚧','🌊','🚒','🔧','📡','🟢','⭐','🚩','🧭'];
function validSymbol(raw){
 const s=raw&&typeof raw==='object'?raw:{};
 const type=['circle','emoji','lucide'].includes(s.type)?s.type:'circle';
 const icon=Object.hasOwn(ICONS,s.icon)?s.icon:'map-pin';
 const clean=String(s.emoji||'📍').replace(/[\u0000-\u001f\u007f<>]/g,'').trim();
 const emoji=Array.from(clean).slice(0,8).join('')||'📍';
 return {type,icon,emoji};
}
function glyphSvg(name,color){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','76%');svg.setAttribute('height','76%');
 svg.setAttribute('fill','none');svg.setAttribute('stroke',color||'#fff');
 svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
 svg.setAttribute('aria-hidden','true');
 for(const shape of ICONS[name]||ICONS['map-pin']){
  const el=document.createElementNS('http://www.w3.org/2000/svg',shape[0]);
  if(shape[0]==='path')el.setAttribute('d',shape[1]);
  if(shape[0]==='circle'){el.setAttribute('cx',shape[1]);el.setAttribute('cy',shape[2]);el.setAttribute('r',shape[3]);}
  if(shape[0]==='line')for(let i=1;i<5;i++)el.setAttribute(['x1','y1','x2','y2'][i-1],shape[i]);
  svg.appendChild(el);
 }
 return svg;
}
function symbolNode(layer,feature,compact=false){
 const sym=validSymbol(layer?.style?.symbol),holder=document.createElement('span');
 const themed=window.GISPowerTools?.themedColor(layer,feature);
 const size=Math.round((Number(layer.style.radius)||6)*2+12);
 const px=compact?20:Math.max(20,Math.min(50,size));
 holder.className='ms-point-symbol ms-point-symbol-'+sym.type;
 holder.style.width=px+'px';holder.style.height=px+'px';
 holder.style.backgroundColor=themed||layer.style.fill||'#2178af';
 holder.style.borderColor=layer.style.color||'#185e91';
 if(sym.type==='emoji'){
  holder.textContent=sym.emoji;
  holder.style.fontSize=Math.max(13,Math.round(px*.56))+'px';
 }else if(sym.type==='lucide'){
  holder.appendChild(glyphSvg(sym.icon,'#ffffff'));
 }
 return holder;
}
function marker(leaflet,layer,feature,latlng){
 const sym=validSymbol(layer.style?.symbol);
 if(sym.type==='circle')return leaflet.circleMarker(latlng,{
  pane:'ms-data-'+layer.id,color:window.GISPowerTools?.themedColor(layer,feature)||layer.style.color,
  fillColor:window.GISPowerTools?.themedColor(layer,feature)||layer.style.fill,
  radius:layer.style.radius,weight:layer.style.weight,
  fillOpacity:layer.style.fillOpacity*layer.opacity,opacity:layer.style.opacity*layer.opacity
 });
 const node=symbolNode(layer,feature);
 const size=parseInt(node.style.width,10);
 return leaflet.marker(latlng,{pane:'ms-data-'+layer.id,
  icon:leaflet.divIcon({html:node,className:'ms-symbol-marker',iconSize:[size,size],iconAnchor:[size/2,size/2]})});
}
function picker(s,p,layer,onChange){
 const section=document.createElement('section');section.className='ms-symbol-picker';
 const heading=document.createElement('h3');heading.textContent='Point symbol';section.appendChild(heading);
 const modes=document.createElement('div');modes.className='ms-symbol-types';
 const sym=validSymbol(layer.style.symbol);layer.style.symbol=sym;
 function update(rebuild=false){
  onChange();
  if(rebuild&&s.panel==='style'){window.GISMapStudio.api.renderPanel(s);return;}
  const gallery=section.querySelector('.ms-symbol-grid');
  if(gallery)Array.from(gallery.children).forEach(button=>{
   button.classList.toggle('is-selected',button.title===(sym.type==='emoji'?sym.emoji:sym.icon));
  });
  const preview=section.querySelector('.ms-symbol-preview');
  if(preview)preview.replaceChildren(preview.firstChild,symbolNode(layer,null));
 }
 for(const [type,label] of [['circle','Circle'],['emoji','Emoji'],['lucide','SVG icons']]){
  const b=document.createElement('button');b.type='button';b.textContent=label;
  b.className='ms-mode'+(sym.type===type?' active':'');
  b.setAttribute('aria-pressed',String(sym.type===type));
  b.addEventListener('click',()=>{sym.type=type;update(true);});
  modes.appendChild(b);
 }
 section.appendChild(modes);
 if(sym.type==='emoji'){
  const grid=document.createElement('div');grid.className='ms-symbol-grid';
  for(const emoji of EMOJIS){
   const b=document.createElement('button');b.type='button';b.textContent=emoji;b.title=emoji;
   b.className='ms-symbol-choice'+(sym.emoji===emoji?' is-selected':'');
   b.addEventListener('click',()=>{sym.emoji=emoji;update();});grid.appendChild(b);
  }
  section.appendChild(grid);
  const label=document.createElement('label');label.className='ms-symbol-custom';
  label.textContent='Custom emoji';const input=document.createElement('input');input.type='text';input.maxLength=24;
  input.className='ms-input';input.value=sym.emoji;input.setAttribute('aria-label','Custom emoji point symbol');
  input.addEventListener('change',()=>{sym.emoji=validSymbol({type:'emoji',emoji:input.value}).emoji;update();});
  label.appendChild(input);section.appendChild(label);
 }else if(sym.type==='lucide'){
  const grid=document.createElement('div');grid.className='ms-symbol-grid';
  for(const name of Object.keys(ICONS)){
   const b=document.createElement('button');b.type='button';b.title=name;
   b.className='ms-symbol-choice'+(sym.icon===name?' is-selected':'');
   b.setAttribute('aria-label','Use '+name+' SVG icon');b.appendChild(glyphSvg(name,'#245d8c'));
   b.addEventListener('click',()=>{sym.icon=name;update();});grid.appendChild(b);
  }
  section.appendChild(grid);
 }
 const preview=document.createElement('div');preview.className='ms-symbol-preview';
 const note=document.createElement('span');note.textContent='Preview';
 preview.appendChild(note);preview.appendChild(symbolNode(layer,null));section.appendChild(preview);
 p.appendChild(section);
}
window.GISPointSymbols={validSymbol,marker,picker,symbolNode,iconNames:Object.keys(ICONS),emojis:EMOJIS};
})();
