'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function harness(post){
 const state={
  url:'https://example.org/arcgis/rest/services/Water/FeatureServer/0',
  tab:'data',
  data:{type:'Feature Layer',objectIdField:'OBJECTID',advancedQueryCapabilities:{supportsPagination:true},
   fields:[
    {name:'STATUS',type:'esriFieldTypeString'},
    {name:'NAME',type:'esriFieldTypeString'},
    {name:'DIAMETER',type:'esriFieldTypeInteger'},
    {name:'MATERIAL',type:'esriFieldTypeString'},
    {name:'OBJECTID',type:'esriFieldTypeOID'}
   ]}
 };
 const window={innerWidth:1280,GISFields:{isDate:()=>false},GISCore:{
  state,post:post||(()=>Promise.resolve({count:0})),renderStats:()=>{}
 }};
 const context=vm.createContext({window,document:{},localStorage:{}});
 const source=fs.readFileSync(path.join(__dirname,'..','gis-enhancements.js'),'utf8');
 vm.runInContext(source,context,{filename:'gis-enhancements.js'});
 return {model:window.GISEnhancements.getModel(),api:window.GISEnhancements,state};
}

test('quick value filters remain AND constraints when advanced conditions use OR',()=>{
 const {model,api}=harness();
 model.filters=[{field:'STATUS',op:'=',value:'A'},{field:'STATUS',op:'=',value:'B'}];
 model.join='OR';
 model.quickFilters=[{field:'MATERIAL',op:'=',value:"O'Reilly"}];
 model.search='Main';model.searchField='NAME';
 model.advanced='DIAMETER >= 8';
 const where=api.buildWhere(model);
 assert.match(where,/\(STATUS = 'A' OR STATUS = 'B'\)/);
 assert.match(where,/MATERIAL = 'O''Reilly'/);
 assert.match(where,/NAME LIKE '%Main%'/);
 assert.match(where,/AND \(DIAMETER >= 8\)/);
 assert.doesNotMatch(where,/ OR MATERIAL /);
});

test('integer search is numeric and unfiltered query defaults to 1=1',()=>{
 const {model,api}=harness();
 assert.equal(api.buildWhere(model),'1=1');
 model.searchField='DIAMETER';
 model.search='48';
 assert.match(api.buildWhere(model),/DIAMETER = 48/);
 assert.throws(()=>{model.search='not a number';api.buildWhere(model);},/requires a number/);
});

test('quick null filter produces IS NULL rather than string equality',()=>{
 const {model,api}=harness();
 model.quickFilters=[{field:'STATUS',op:'IS NULL',value:''}];
 assert.match(api.buildWhere(model),/STATUS IS NULL/);
});

test('late server count cannot overwrite a newer filtered count',async()=>{
 const pending=[];
 const {model,api}=harness((url,params)=>new Promise(resolve=>pending.push({params,resolve})));
 model.quickFilters=[{field:'MATERIAL',op:'=',value:'PVC'}];
 const old=api.loadCount(model);
 model.quickFilters=[{field:'MATERIAL',op:'=',value:'DUCTILE'}];
 const latest=api.loadCount(model);
 assert.equal(pending.length,2);
 assert.match(pending[0].params.where,/PVC/);
 assert.match(pending[1].params.where,/DUCTILE/);
 pending[1].resolve({count:12});
 await latest;
 pending[0].resolve({count:1200});
 await old;
 assert.equal(model.count,12);
 assert.equal(model.countError,'');
});

test('count failure does not hide successfully retrieved table records',async()=>{
 const {model,api}=harness(async()=>{throw Error('Statistics endpoint unavailable');});
 model.records=[{attributes:{OBJECTID:1,STATUS:'Open'}}];
 model.error='';
 await api.loadCount(model);
 assert.equal(model.count,null);
 assert.match(model.countError,/Statistics endpoint unavailable/);
 assert.equal(model.error,'');
 assert.equal(model.records.length,1);
});
