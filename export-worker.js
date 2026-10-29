/* Local shapefile packaging worker. Does not access Miniup or store tokens. */
self.onmessage=async function(event){
  try{
    var data=event.data||{}, features=Array.isArray(data.features)?data.features:[];
    if(!features.length)throw new Error('No features to package.');
    importScripts('https://unpkg.com/@mapbox/shp-write@0.4.3/shpwrite.js');
    if(!self.shpwrite || typeof self.shpwrite.zip!=='function')
      throw new Error('Shapefile writer was not available. Check network access to unpkg.com.');
    var geo={type:'FeatureCollection',features:features};
    var label=String(data.name||'layer').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,60);
    var bytes=await Promise.resolve(self.shpwrite.zip(geo,{
      folder:label,types:{point:label+'_points',line:label+'_lines',polygon:label+'_polygons'}
    }));
    var array=bytes instanceof ArrayBuffer?bytes:
      bytes && bytes.buffer instanceof ArrayBuffer
        ?bytes.buffer.slice(bytes.byteOffset||0,(bytes.byteOffset||0)+bytes.byteLength)
        :null;
    if(!array)throw new Error('Shapefile writer returned an unsupported ZIP format.');
    self.postMessage({ok:true,bytes:array},[array]);
  }catch(e){
    self.postMessage({ok:false,error:String(e&&e.message||e)});
  }
};
