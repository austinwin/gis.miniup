/* Central ArcGIS field display utilities. Raw API responses and exports are unchanged. */
(function(){
'use strict';
var zone='UTC';
function find(name,fields){
 return Array.isArray(fields)?fields.find(function(f){return f.name && f.name.toLowerCase()===String(name).toLowerCase();}):null;
}
function isDate(field){return /^esriFieldType(?:Date|DateOnly|TimeOnly|TimestampOffset|TimeStampOffset)$/i.test(field?.type||'');}
function dateValue(value){
 if(value instanceof Date)return value;
 if(typeof value==='number' || (typeof value==='string' && /^\d{13}$/.test(value.trim())))return new Date(Number(value));
 return new Date(String(value));
}
function format(field,value){
 if(value===null || value===undefined || value==='')return '—';
 if(!isDate(field)){
   if(typeof value==='object')return JSON.stringify(value);
   return String(value);
 }
 var type=String(field.type).toLowerCase();
 if(type.includes('timeonly')){
   if(typeof value==='number' && value>=0 && value<86400000)return new Date(value).toISOString().slice(11,19);
   return String(value);
 }
 if(type.includes('dateonly') && typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value))return value;
 var d=dateValue(value);
 if(!Number.isFinite(d.getTime()))return String(value);
 if(type.includes('dateonly'))return d.toISOString().slice(0,10);
 try{
   var date=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone==='UTC'?'UTC':undefined}).format(d);
   return date+(zone==='UTC'?' UTC':' (local)');
 }catch(e){return d.toISOString();}
}
function formatNamed(name,value,fields){
 var field=find(name,fields);
 if(field)return format(field,value);
 // Identify responses sometimes omit field metadata. Infer only for obvious date
 // names and 13-digit epoch values, never for ordinary numeric identifiers.
 if(/(?:^|_)(?:date|datetime|timestamp|created|modified|edited)(?:_|$)/i.test(name) &&
    (typeof value==='number'||typeof value==='string') && /^\d{13}$/.test(String(value)))
   return format({type:'esriFieldTypeDate'},value);
 return format(null,value);
}
function dateLiteral(field,value){
 if(!isDate(field))return null;
 if(/TimeOnly/i.test(field.type))return "TIME '"+String(value).replace(/'/g,"''")+"'";
 var input=String(value).trim(),d;
 if(/^\d{13}$/.test(input)){d=new Date(Number(input));if(!Number.isFinite(d.getTime()))throw Error('Invalid date value.');input=d.toISOString();}
 if(!/^\d{4}-\d{2}-\d{2}/.test(input))throw Error('Enter a date as YYYY-MM-DD or YYYY-MM-DD HH:mm:ss (UTC).');
 var m=input.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?)?/);
 if(!m || !Number.isFinite(Date.parse(m[1]+'T00:00:00Z')))throw Error('Invalid date.');
 return "DATE '"+m[1]+(m[2]?' '+m[2]+':'+(m[3]||'00'):'')+"'";
}
function filterValue(field,value){
 if(isDate(field) && !/TimeOnly/i.test(field.type)){
   var d=dateValue(value);
   if(Number.isFinite(d.getTime()))return d.toISOString().slice(0,19).replace('T',' ');
 }
 return String(value);
}
window.GISFields={
 find:find,isDate:isDate,format:format,formatNamed:formatNamed,
 dateLiteral:dateLiteral,filterValue:filterValue,
 getZone:function(){return zone;},setZone:function(value){zone=value==='local'?'local':'UTC';}
};
})();