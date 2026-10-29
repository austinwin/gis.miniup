/* GIS REST Explorer: read-only, browser-direct ArcGIS REST JSON client. */
(function () {
  'use strict';
  var EXAMPLE = 'https://geogimstest.houstontx.gov/arcgis/rest/services';
  var $ = function (id) { return document.getElementById(id); };
  var state = {root: EXAMPLE, url: '', data: null, children: [], sidebar: [], tab: 'overview', busy: false, request: 0, result: null, offset: 0, lastQuery: null, map: null, overlay: null, mapTimer: null, mapUrl: '', tree: {root:null, scope:'', nodes:new Map(), query:'', token:0, timer:null, busy:false, scanned:0, failed:0, limited:false}};
  function el(tag, className, value) { var n = document.createElement(tag); if (className) n.className = className; if (value !== undefined && value !== null) n.textContent = String(value); return n; }
  function append(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(node) { node.replaceChildren(); return node; }
  function btn(label, css, callback) { var b = el('button', css, label); b.type = 'button'; b.addEventListener('click', callback); return b; }
  function short(s, max) { s = String(s === undefined || s === null ? '—' : s); return s.length > (max || 65) ? s.slice(0, (max || 65) - 1) + '…' : s; }
  function textify(value) { if (value === undefined || value === null || value === '') return '—'; if (typeof value === 'object') return JSON.stringify(value); return String(value); }
  function formatNum(n) { return typeof n === 'number' ? n.toLocaleString() : textify(n); }
  function showAlert(title, message, isError, link) {
    var host = $('alert'); clear(host); host.hidden = false; host.className = 'alert' + (isError ? ' error' : '');
    append(host, el('strong', '', title), el('span', '', message));
    if (link) { var a = el('a', '', ' Open the JSON endpoint ↗'); a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; host.appendChild(a); }
  }
  function hideAlert() { $('alert').hidden = true; }
  function status(label, mode) { var b = $('connectionBadge'); b.className = 'connection ' + (mode || ''); b.querySelector('span').textContent = label; }

  // Authentication: a token is scoped to one ArcGIS REST services root.
  // Never store access tokens in localStorage, cookies, or the page URL.
  var auth={token:'',scope:'',expires:0,source:'',portal:'',pending:null,popup:null};
  var OAUTH_TEMP_KEY='gis-explorer-pkce-temp';
  var oauthRedirect=new URL('./oauth-callback.html',document.baseURI).href;
  function scopedToken(request) {
    if(!auth.token || !auth.scope)return '';
    if(auth.expires && Date.now()>auth.expires-15000)return '';
    var u,b;
    try{u=new URL(request);b=new URL(auth.scope);}catch(e){return '';}
    var base=b.pathname.replace(/\/+$/,'');
    if(u.protocol!=='https:' || u.origin!==b.origin)return '';
    return u.pathname===base || u.pathname.indexOf(base+'/')===0 ? auth.token : '';
  }
  function activeScope(){return rootOf(state.url || $('urlInput').value || EXAMPLE) || rootOf(EXAMPLE);}
  function authSessionLabel(){
    var scope=activeScope(),token=scopedToken(scope);
    return token ? 'Token set' : 'Sign in';
  }
  function updateAuthButton(){
    var button=$('authButton');
    if(!button)return;
    button.textContent=authSessionLabel();
    button.classList.toggle('is-active',authSessionLabel()==='Token set');
    button.title=auth.token && !scopedToken(activeScope())
      ? 'A token is active for another ArcGIS server or has expired.'
      : (auth.source==='oauth'?'ArcGIS OAuth connection': 'ArcGIS authentication options');
    if(!$('authModal').hidden){
      $('authCurrent').textContent=auth.token && scopedToken(activeScope())
        ? 'Token supplied for '+new URL(auth.scope).host+' (access checked by the server)'
        : (auth.token ? 'Token belongs to a different server or has expired.' : 'Not signed in');
      $('authHost').textContent=new URL(activeScope()).origin;
    }
  }
  function authMessage(msg,isError){
    var box=$('authMessage');
    box.textContent=msg||'';
    box.className='auth-message'+(isError?' is-error':'');
  }
  function openAuth(){
    $('authModal').hidden=false;
    $('authRedirect').value=oauthRedirect;
    updateAuthButton();
    authMessage('');
    $('authClose').focus();
  }
  function closeAuth(){$('authModal').hidden=true;$('authToken').value='';authMessage('');}
  function applyAuthToken(token,scope,source,expires,portal){
    cancelFullExport(true);
    if(window.GISEnhancements)window.GISEnhancements.resetSensitive();
    if(!token || !scope)throw new Error('Token and ArcGIS server URL are required.');
    var u=new URL(scope);
    if(u.protocol!=='https:')throw new Error('Tokens can only be used with HTTPS ArcGIS services.');
    auth.token=token;auth.scope=scope;auth.expires=expires||0;
    auth.source=source||'manual';auth.portal=portal||'';
    // Do not keep metadata obtained under a previous credential set.
    newTree(state.root || scope);
    state.tree.query='';
    $('filterInput').value='';
    $('authToken').value='';
    updateAuthButton();
    closeAuth();
    navigate(state.url||scope,{noHistory:true});
  }
  function removeAuth(){
    cancelFullExport(true);
    if(window.GISEnhancements)window.GISEnhancements.resetSensitive();
    auth.token='';auth.scope='';auth.expires=0;auth.source='';auth.portal='';
    if(auth.popup && !auth.popup.closed)auth.popup.close();
    auth.pending=null;
    try{sessionStorage.removeItem(OAUTH_TEMP_KEY);}catch(e){}
    // Clear cached child metadata and search results from the prior identity.
    state.data=null;state.children=[];state.result=null;state.identifyContext=null;
    newTree(state.root || EXAMPLE);
    state.tree.query='';
    $('filterInput').value='';
    $('authToken').value='';
    authMessage('Token cleared for this browser tab.');
    updateAuthButton();
    navigate(state.url||EXAMPLE,{noHistory:true});
  }
  function portalRoot(value){
    var u;
    try{u=new URL(value.trim());}catch(e){throw new Error('Enter your ArcGIS Portal URL, such as https://portal.example.com/portal');}
    if(u.protocol!=='https:' || !u.hostname || u.username || u.password || u.search || u.hash)
      throw new Error('Use a trusted HTTPS ArcGIS Portal URL without a username, password, or query.');
    var path=u.pathname.replace(/\/+$/,'');
    path=path.replace(/\/sharing\/rest(?:\/oauth2(?:\/.*)?)?$/i,'');
    return u.origin+path;
  }
  function randomUrlSafe(n){
    if(!window.crypto || !crypto.getRandomValues)throw new Error('Secure random values are unavailable. Use HTTPS.');
    var b=new Uint8Array(n);crypto.getRandomValues(b);
    return Array.from(b,function(x){return String.fromCharCode(x);}).join('');
  }
  function base64url(str){return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function makeRandom(n){return base64url(randomUrlSafe(n));}
  async function challengeFor(verifier){
    if(!crypto.subtle)throw new Error('This browser does not support OAuth PKCE.');
    var bytes=new TextEncoder().encode(verifier);
    var hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    return base64url(String.fromCharCode.apply(null,Array.from(hash)));
  }
  async function postOAuthForm(endpoint,pairs){
    var p=new URLSearchParams();
    Object.keys(pairs).forEach(function(key){p.set(key,String(pairs[key]));});
    var resp;
    try{
      resp=await fetch(endpoint,{method:'POST',mode:'cors',credentials:'omit',
        redirect:'error',referrerPolicy:'no-referrer',
        headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded'},
        body:p.toString(),cache:'no-store'});
    }catch(e){throw new Error('ArcGIS Portal is unreachable from this browser or does not permit CORS from '+location.origin+'.');}
    if(!resp.ok)throw new Error('Portal returned HTTP '+resp.status+'.');
    var body;
    try{body=await resp.json();}catch(e){throw new Error('Portal token endpoint did not return JSON.');}
    if(body.error)throw new Error('ArcGIS sign-in error: '+(body.error.message || body.error_description || 'Authorization failed.'));
    return body;
  }
  async function beginOAuth(){
    var portal,clientId,scope=activeScope();
    try{
      portal=portalRoot($('authPortal').value);
      clientId=$('authClientId').value.trim();
      if(!clientId || !/^[A-Za-z0-9._~-]{3,256}$/.test(clientId))
        throw new Error('Enter a registered ArcGIS OAuth application Client ID.');
      var nonce=makeRandom(24),verifier=makeRandom(48);
      var info={state:nonce,verifier:verifier,portal:portal,clientId:clientId,
        scope:scope,createdAt:Date.now(),redirect:oauthRedirect};
      // Save PKCE state before opening: a mobile popup may start with a copy
      // of its opener's sessionStorage if it must complete in its own tab.
      auth.pending=info;
      try{sessionStorage.setItem(OAUTH_TEMP_KEY,JSON.stringify(info));}catch(e){}
      // Open synchronously within the user click, before awaiting SHA-256.
      var popup=window.open('about:blank','gis-arcgis-oauth',
        'popup=yes,width=560,height=700,resizable=yes,scrollbars=yes');
      if(!popup)throw new Error('Sign-in window was blocked. Allow popups for gis.miniup.app and try again.');
      auth.popup=popup;
      authMessage('Opening your ArcGIS organization sign-in page…');
      var challenge=await challengeFor(verifier);
      var authorize=new URL(portal+'/sharing/rest/oauth2/authorize');
      Object.entries({client_id:clientId,response_type:'code',redirect_uri:oauthRedirect,
        code_challenge:challenge,code_challenge_method:'S256',state:nonce}).forEach(function(pair){
        authorize.searchParams.set(pair[0],pair[1]);
      });
      popup.location.href=authorize.href;
    }catch(e){
      authMessage(e.message,true);
      if(auth.popup && !auth.popup.closed && auth.popup.location.href==='about:blank')auth.popup.close();
    }
  }
  async function completeOAuth(code,returnedState){
    var info=auth.pending;
    if(!info){
      try{info=JSON.parse(sessionStorage.getItem(OAUTH_TEMP_KEY)||'null');}catch(e){}
    }
    if(!info || !returnedState || returnedState!==info.state || Date.now()-info.createdAt>10*60*1000){
      authMessage('Sign-in expired or returned an invalid state. Please sign in again.',true);return;
    }
    auth.pending=null;
    try{sessionStorage.removeItem(OAUTH_TEMP_KEY);}catch(e){}
    authMessage('Completing ArcGIS sign-in…');
    try{
      var data=await postOAuthForm(info.portal+'/sharing/rest/oauth2/token',{
        grant_type:'authorization_code',client_id:info.clientId,code:code,
        redirect_uri:info.redirect,code_verifier:info.verifier,f:'json'
      });
      var access=data.access_token || data.token;
      if(!access)throw new Error('ArcGIS Portal did not return an access token.');
      var expiry=data.expires_in ? Date.now()+Number(data.expires_in)*1000 : 0;
      var serverUrl=info.scope.replace(/\/rest\/services(?:\/.*)?$/i,'');
      var chosen=access;
      // A federated server may share the portal hostname but use a separate
      // web adaptor path (/portal vs /arcgis). Compare actual service roots.
      if(serverUrl.replace(/\/+$/,'')!==info.portal.replace(/\/+$/,'')){
        // Federated ArcGIS Server requires a server-specific token.
        var server=await postOAuthForm(info.portal+'/sharing/rest/generateToken',{
          f:'json',token:access,serverUrl:serverUrl
        });
        if(!server.token)throw new Error('The portal could not exchange your login for a token accepted by this ArcGIS Server. Check federation or use an existing server token.');
        chosen=server.token;
        if(server.expires)expiry=Number(server.expires);
      }
      applyAuthToken(chosen,info.scope,'oauth',expiry,info.portal);
    }catch(e){openAuth();authMessage(e.message,true);}
  }
  window.addEventListener('message',function(event){
    var data=event.data;
    if(event.origin!==location.origin || !data || data.type!=='GIS_ARCGIS_OAUTH_CALLBACK')return;
    if(!auth.popup || event.source!==auth.popup)return;
    if(data.error){openAuth();authMessage('ArcGIS sign-in: '+data.error,true);return;}
    if(data.code && data.state)completeOAuth(data.code,data.state);
  });
  function attachAuthUI(){
    $('authButton').addEventListener('click',openAuth);
    $('authClose').addEventListener('click',closeAuth);
    $('authModal').addEventListener('click',function(e){if(e.target===$('authModal'))closeAuth();});
    window.addEventListener('keydown',function(e){if(e.key==='Escape' && !$('authModal').hidden)closeAuth();});
    $('authUseToken').addEventListener('click',function(){
      var token=$('authToken').value.trim();
      if(!token){authMessage('Paste a valid token to continue.',true);return;}
      applyAuthToken(token,activeScope(),'manual',0,'');
    });
    $('authSignOut').addEventListener('click',removeAuth);
    $('authOAuth').addEventListener('click',beginOAuth);
    $('authCopyRedirect').addEventListener('click',async function(){
      try{await navigator.clipboard.writeText(oauthRedirect);authMessage('Redirect URL copied. Register it in your ArcGIS OAuth application.',false);}
      catch(e){authMessage('Select and copy the redirect URL manually.',true);}
    });
    updateAuthButton();
  }

  function rootOf(url) { var u = new URL(url); var p = u.pathname; var idx = p.toLowerCase().indexOf('/rest/services'); return idx < 0 ? null : u.origin + p.slice(0, idx + '/rest/services'.length); }
  function normalize(raw) {
    var u; try { u = new URL(String(raw).trim()); } catch (e) { throw new Error('Enter an absolute URL beginning with https://'); }
    if (!/^https?:$/.test(u.protocol) || !u.hostname) throw new Error('Only HTTP(S) ArcGIS REST endpoints are supported.');
    if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) throw new Error('Use an HTTPS endpoint. Public HTTP endpoints will be blocked by the browser.');
    u.hash = ''; u.search = ''; u.pathname = u.pathname.replace(/\/+$/, '');
    if (!rootOf(u.href)) throw new Error('URL must contain /arcgis/rest/services (or an equivalent /rest/services path).');
    return u.href;
  }
  function buildUrl(base, pairs) { var url = new URL(base); Object.keys(pairs || {}).forEach(function (k) { url.searchParams.set(k, String(pairs[k])); }); return url.href; }
  function jsonUrl(url) { return buildUrl(url, {f: 'pjson'}); }
  function pathFor(path) { return state.root + '/' + path.split('/').filter(Boolean).map(encodeURIComponent).join('/'); }
  function urlParts(url) { var root = rootOf(url); var tail = decodeURIComponent(new URL(url).pathname.slice(new URL(root).pathname.length)).replace(/^\/+/, ''); return tail ? tail.split('/') : []; }
  function serviceIndex(parts) { return parts.findIndex(function (p) { return /^(MapServer|FeatureServer|ImageServer|GeocodeServer|GPServer|GeometryServer|SceneServer|VectorTileServer|NetworkServer|NAServer)$/i.test(p); }); }
  function resourceType(url) { var p = urlParts(url); var i = serviceIndex(p); return i === -1 ? (p.length ? 'folder' : 'root') : (p.length === i + 1 ? 'service' : 'layer'); }
  function parentUrl(url) {
    var p = urlParts(url); if (!p.length) return null;
    var i = serviceIndex(p); if (i !== -1 && p.length === i + 1) return p.length > 2 ? pathFor(p.slice(0, -2).join('/')) : state.root;
    return pathFor(p.slice(0, -1).join('/')) || state.root;
  }
  function leafName(url) { var p = urlParts(url); var i = serviceIndex(p); if (!p.length) return 'Services Directory'; if (i !== -1 && p.length === i + 1) return p[i - 1] || p[i]; return p[p.length - 1]; }
  function titleFor(data, url) { var p = urlParts(url); var i = serviceIndex(p); if (i !== -1 && p.length === i + 1) return (p[i - 1] || 'Unnamed Service'); return data.name || data.mapName || (i < 0 ? (p[p.length - 1] || 'Services Directory') : (p[p.length - 1] || 'Layer')); }
  function kindFor(data, url) { var type = resourceType(url); if (type === 'layer') return data.type === 'Table' ? 'Table' : 'Layer'; if (type === 'service') return urlParts(url).slice(-1)[0]; return type === 'folder' ? 'Folder' : 'Directory'; }
  function iconFor(kind) { if (kind === 'folder') return '▤'; if (kind === 'table') return '▦'; if (kind === 'layer') return '◫'; if (kind === 'service') return '▧'; return '◈'; }
  function childrenFor(d, url) {
    var out = [], type = resourceType(url);
    (d.folders || []).forEach(function (folder) { var s = String(folder); var full = s.indexOf('/') !== -1 ? pathFor(s) : url + '/' + encodeURIComponent(s); out.push({title: s.split('/').pop(), kind: 'folder', subtitle: 'Folder', url: full}); });
    (d.services || []).forEach(function (svc) { out.push({title: String(svc.name || '').split('/').pop(), kind: 'service', subtitle: svc.type || 'Service', url: pathFor(svc.name + '/' + svc.type)}); });
    (d.layers || []).forEach(function (l) { out.push({title: l.name || ('Layer ' + l.id), kind: 'layer', subtitle: 'Layer ' + l.id, url: url + '/' + l.id}); });
    (d.tables || []).forEach(function (l) { out.push({title: l.name || ('Table ' + l.id), kind: 'table', subtitle: 'Table ' + l.id, url: url + '/' + l.id}); });
    if (type === 'layer' && !out.length && Array.isArray(d.subLayers)) {
      var p = urlParts(url), i = serviceIndex(p), prefix = pathFor(p.slice(0, i + 1).join('/'));
      d.subLayers.forEach(function (l) { out.push({title: l.name || ('Layer ' + l.id), kind: 'layer', subtitle: 'Sub-layer ' + l.id, url: prefix + '/' + l.id}); });
    }
    return out;
  }

  // Explorer tree: folder/service metadata is loaded only when expanded or searched.
  // A service response already advertises its layer/table leaves, so full-depth
  // search does not need to request each feature layer separately.
  function treeExpandable(n) {
    return n && (n.kind === 'root' || n.kind === 'folder' || n.kind === 'service' || n.hasChildren);
  }
  function makeTreeNode(meta, parent) {
    var t = state.tree, node = t.nodes.get(meta.url);
    if (!node) {
      node = {url:meta.url, title:meta.title, kind:meta.kind, subtitle:meta.subtitle || '',
        parent:parent || null, children:[], loaded:false, loading:null, expanded:false,
        hasChildren:Boolean(meta.hasChildren), collapsedSearch:false, error:''};
      t.nodes.set(node.url,node);
    } else {
      // Keep a descriptive title when navigation supplies only a numeric layer ID.
      if (meta.title) {
        var incomingTitle=String(meta.title).trim();
        var existingTitle=String(node.title || '').trim();
        var isNumericFallback=/^\d+$/.test(incomingTitle);
        var hasDescriptiveTitle=Boolean(existingTitle) && !/^\d+$/.test(existingTitle);
        if (!isNumericFallback || !hasDescriptiveTitle) node.title=incomingTitle;
      }
      if (meta.kind) node.kind=meta.kind;
      if (meta.subtitle) node.subtitle=meta.subtitle;
      if (meta.hasChildren) node.hasChildren=true;
      if (parent && parent !== node && parent.url!==node.url) node.parent=parent;
    }
    return node;
  }
  function newTree(root) {
    var t=state.tree;
    clearTimeout(t.timer);
    t.token++;
    t.root=null; t.nodes=new Map(); t.scope=root; t.busy=false;
    t.scanned=0; t.failed=0; t.limited=false;
    t.root=makeTreeNode({url:root,title:'Services',kind:'root',subtitle:'ArcGIS REST root'},null);
    t.root.expanded=true;
    return t.root;
  }
  function fillTree(node,data) {
    // The ArcGIS root is already a node: never add a second root as its child.
    // Deduplicate equivalent REST URLs before creating tree children.
    var entries=childrenFor(data,node.url),seenChildren=new Set();
    node.children=entries.filter(function(entry){
      var key=canonicalTreeUrl(entry.url);
      if(!key || key===canonicalTreeUrl(node.url) || seenChildren.has(key))return false;
      if(resourceType(entry.url)==='root')return false;
      seenChildren.add(key);
      return true;
    }).map(function(entry){return makeTreeNode(entry,node);});
    node.loaded=true;
    node.error='';
    if(resourceType(node.url)==='layer' && Array.isArray(data.subLayers) && data.subLayers.length) node.hasChildren=true;
    return node.children;
  }
  async function treeLoad(node) {
    if(!treeExpandable(node)) return [];
    if(node.loaded) return node.children;
    if(node.loading) return node.loading;
    node.error='';
    node.loading=fetchData(jsonUrl(node.url)).then(function(data){
      fillTree(node,data);
      node.searchExtra=JSON.stringify({description:data.description||data.serviceDescription||'',
        fields:(data.fields||[]).map(function(f){return [f.name,f.alias].join(' ');})});
      return node.children;
    }).catch(function(e){
      node.error=e.message || 'Unable to load this branch';
      state.tree.failed++;
      return [];
    }).finally(function(){
      node.loading=null;
      renderSidebar();
    });
    renderSidebar();
    return node.loading;
  }
  function canonicalTreeUrl(url) {
    try {
      var u=new URL(url);
      return u.origin.toLowerCase()+decodeURIComponent(u.pathname).replace(/\/+$/,'').toLowerCase();
    } catch(e) { return String(url||'').replace(/\/+$/,'').toLowerCase(); }
  }
  function rootAlias(url){
    try{return canonicalTreeUrl(url)===canonicalTreeUrl(state.root);}catch(e){return false;}
  }
  // Build exactly one root and its actual ArcGIS hierarchy. Walking
  // parentUrl() could introduce a phantom second "Services Directory" node,
  // especially when the user navigated directly to a nested service/layer.
  async function revealTreePath(url,data,navigationId) {
    var root=state.root,t=state.tree;
    if(!t.root || canonicalTreeUrl(t.scope)!==canonicalTreeUrl(root))newTree(root);
    var parts=urlParts(url), servicePos=serviceIndex(parts), chain=[root];
    function addPath(path){
      if(!path)return;
      var u=pathFor(path),key=canonicalTreeUrl(u);
      if(key!==canonicalTreeUrl(root) &&
        !chain.some(function(existing){return canonicalTreeUrl(existing)===key;}))chain.push(u);
    }
    if(servicePos===-1){
      for(var j=0;j<parts.length;j++)addPath(parts.slice(0,j+1).join('/'));
    }else{
      for(var k=0;k<servicePos-1;k++)addPath(parts.slice(0,k+1).join('/'));
      addPath(parts.slice(0,servicePos+1).join('/'));
      for(var m=servicePos+1;m<parts.length;m++)addPath(parts.slice(0,m+1).join('/'));
    }
    var parent=null,current=null;
    for(var i=0;i<chain.length;i++){
      if(navigationId!==state.request)return;
      var itemUrl=chain[i],kind=resourceType(itemUrl);
      if(parent && !parent.loaded)await treeLoad(parent);
      if(navigationId!==state.request)return;
      var existingNode=t.nodes.get(itemUrl),isSelected=canonicalTreeUrl(itemUrl)===canonicalTreeUrl(url);
      var sourceTitle=isSelected && data && typeof data.name==='string' && data.name.trim()
        ? data.name.trim()
        : existingNode && existingNode.title ? existingNode.title : leafName(itemUrl);
      var meta={url:itemUrl,title:i===0?'Services':sourceTitle,kind:i===0?'root':kind,
        subtitle:existingNode && existingNode.subtitle ? existingNode.subtitle :
          (kind==='service'?urlParts(itemUrl).slice(-1)[0]:kind)};
      // Reuse the one authoritative tree root instead of registering an alias.
      current=i===0?t.root:makeTreeNode(meta,parent);
      if(i===0){current.title='Services';current.kind='root';current.parent=null;}
      if(parent && canonicalTreeUrl(parent.url)!==canonicalTreeUrl(itemUrl) &&
        !parent.children.some(function(x){return canonicalTreeUrl(x.url)===canonicalTreeUrl(itemUrl);}))
        parent.children.push(current);
      if(isSelected)fillTree(current,data);
      if(parent)parent.expanded=true;
      parent=current;
    }
    if(t.root){
      t.root.expanded=true;
      t.root.children=t.root.children.filter(function(child){
        return child!==t.root && !rootAlias(child.url) && child.kind!=='root';
      });
    }
  }
  function treeMatch(node,word) {
    return (node.title+' '+node.subtitle+' '+node.url+' '+(node.searchExtra||'')).toLowerCase().includes(word);
  }
  function treeHasMatch(node,word) {
    if(!word || treeMatch(node,word))return true;
    return node.children.some(function(c){return treeHasMatch(c,word);});
  }
  function treeMatches(node,word) {
    return (treeMatch(node,word)?1:0)+node.children.reduce(function(n,c){return n+treeMatches(c,word);},0);
  }
  function treeVisibleCount(node) {
    return 1+(node.expanded?node.children.reduce(function(n,c){return n+treeVisibleCount(c);},0):0);
  }
  function markTreeLabel(text,word) {
    var span=el('span','tree-text'),low=text.toLowerCase(),i=word?low.indexOf(word):-1;
    if(i<0){span.textContent=text;return span;}
    span.appendChild(document.createTextNode(text.slice(0,i)));
    span.appendChild(el('mark','',text.slice(i,i+word.length)));
    span.appendChild(document.createTextNode(text.slice(i+word.length)));
    return span;
  }
  function treeRow(node,depth,word){
    if(word && !treeHasMatch(node,word))return null;
    var container=el('div','tree-branch'), line=el('div','tree-line');
    line.style.paddingLeft=(Math.min(depth,15)*17+3)+'px';
    var exp=treeExpandable(node);
    var open=word ? (treeHasMatch(node,word) && !node.collapsedSearch)
                  : node.expanded;
    if(exp){
      var toggle=btn('', 'tree-caret'+(open?' open':''),function(){
        if(word)node.collapsedSearch=!node.collapsedSearch;
        else node.expanded=!node.expanded;
        if((word?!node.collapsedSearch:node.expanded)&&!node.loaded)treeLoad(node);
        renderSidebar();
      });
      toggle.title=open?'Collapse '+node.title:'Expand '+node.title;
      toggle.setAttribute('aria-label',toggle.title);
      toggle.setAttribute('aria-expanded',String(Boolean(open)));
      line.appendChild(toggle);
    }else line.appendChild(el('span','tree-caret-spacer'));
    var item=btn('', 'tree-item'+(node.url===state.url?' active':''),function(){
      if(treeExpandable(node)){
        node.expanded=true;
        if(!node.loaded)treeLoad(node);
      }
      navigate(node.url);
    });
    item.title=node.title+' · '+node.subtitle;
    item.setAttribute('role','treeitem');
    item.setAttribute('aria-selected',String(node.url===state.url));
    if(exp)item.setAttribute('aria-expanded',String(Boolean(open)));
    append(item,el('span','tree-glyph '+(node.kind==='root'?'folder':node.kind)));
    var copy=el('span','tree-copy');
    copy.appendChild(markTreeLabel(node.title,word));
    if(node.kind==='service'||node.kind==='layer'||node.kind==='table')
      copy.appendChild(el('span','tree-sub',node.subtitle));
    item.appendChild(copy);
    line.appendChild(item);
    container.appendChild(line);
    if(open && exp){
      var kids=el('div','tree-children');
      kids.setAttribute('role','group');
      if(node.loading)kids.appendChild(el('div','tree-loading','Loading nested items…'));
      if(node.error)kids.appendChild(el('div','tree-error','Could not load: '+short(node.error,90)));
      node.children.forEach(function(child){
        var childRow=treeRow(child,depth+1,word);
        if(childRow)kids.appendChild(childRow);
      });
      container.appendChild(kids);
    }
    return container;
  }
  var renderedTreeScope='';
  function renderSidebar() {
    var host=$('navItems'),t=state.tree,word=t.query.trim().toLowerCase();
    // Rebuilding a branch must not jump users back to the top of long directories.
    var sameScope=renderedTreeScope===t.scope, top=sameScope?host.scrollTop:0,
        left=sameScope?host.scrollLeft:0;
    renderedTreeScope=t.scope;
    clear(host);
    $('sideHeading').textContent=word?'Search results':'Directory';
    if(!t.root){
      $('itemCount').textContent='0';
      host.appendChild(el('div','nav-placeholder','Connecting to ArcGIS services…'));
      return;
    }
    $('itemCount').textContent=word?String(treeMatches(t.root,word)):String(treeVisibleCount(t.root));
    var info=$('treeMeta');
    if(info){
      // Show only actionable search status; permanent instructions waste tree space.
      if(t.busy)info.textContent='Searching… '+t.scanned+' branches checked';
      else if(word && (t.failed || t.limited))
        info.textContent=(t.failed ? t.failed+' branches unavailable' : '')+
          (t.failed && t.limited ? ' · ' : '')+
          (t.limited ? 'Search limit reached' : '');
      else info.textContent='';
      info.hidden=!info.textContent;
      info.classList.toggle('scanning',t.busy);
    }
    if(!word || treeHasMatch(t.root,word)){
      var view=treeRow(t.root,0,word);
      if(view)host.appendChild(view);
    }
    if(!host.children.length)
      host.appendChild(el('div','nav-placeholder',t.busy?'Searching deeper…':'No matches in the accessible subtree.'));
    host.scrollTop=top;
    host.scrollLeft=left;
  }
  function requestTreeSearch() {
    var t=state.tree;
    clearTimeout(t.timer);
    t.token++;
    t.busy=false;
    if(!t.query.trim()){renderSidebar();return;}
    t.busy=true;
    renderSidebar();
    var token=t.token;
    t.timer=setTimeout(function(){searchTree(token);},300);
  }
  async function searchTree(token) {
    var t=state.tree;
    if(!t.root||token!==t.token)return;
    t.scanned=0; t.failed=0; t.limited=false;
    var queue=[t.root], seen=new Set(), LIMIT=1600, BATCH=4;
    try{
      while(queue.length && token===t.token && seen.size<LIMIT){
        var batch=[];
        while(queue.length && batch.length<BATCH && seen.size<LIMIT){
          var node=queue.shift();
          if(!node||seen.has(node.url)||!treeExpandable(node))continue;
          seen.add(node.url);
          batch.push(node);
        }
        if(!batch.length)continue;
        await Promise.all(batch.map(async function(n){
          await treeLoad(n);
          if(token!==t.token)return;
          n.children.forEach(function(child){
            if(treeExpandable(child)&&!seen.has(child.url))queue.push(child);
          });
          t.scanned++;
        }));
        if(token!==t.token)return;
        renderSidebar();
      }
      if(t.token===token && state.searchFieldNames) {
        var leaves=Array.from(t.nodes.values()).filter(function(n){return n.kind==='layer'||n.kind==='table';})
          .filter(function(n){return !n.searchExtra;}).slice(0,250);
        var at=0;
        await Promise.all([0,1,2,3].map(async function(){
          while(at<leaves.length && t.token===token){
            var node=leaves[at++];
            try{
              var info=await fetchData(jsonUrl(node.url));
              node.searchExtra=JSON.stringify({description:info.description||'',fields:(info.fields||[]).map(function(f){return [f.name,f.alias].join(' ');})});
            }catch(e){node.searchExtra='';t.failed++;}
            t.scanned++;
            if(t.scanned%12===0)renderSidebar();
          }
        }));
        if(t.nodes.size>250)t.limited=true;
      }
    } finally {
      if(token===t.token){
        t.limited=queue.length>0 || t.limited;
        t.busy=false;
        renderSidebar();
      }
    }
  }
  function renderCrumbs() {
    var host = clear($('crumbs'));
    var p = urlParts(state.url), nodes = [{label: 'Services', url: state.root}], i = serviceIndex(p);
    if (i < 0) p.forEach(function (v, j) { nodes.push({label: v, url: pathFor(p.slice(0, j + 1).join('/'))}); });
    else {
      p.slice(0, i - 1).forEach(function (v, j) { nodes.push({label: v, url: pathFor(p.slice(0, j + 1).join('/'))}); });
      nodes.push({label: p[i - 1], url: pathFor(p.slice(0, i + 1).join('/'))});
      p.slice(i + 1).forEach(function (v, j) { nodes.push({label: v, url: pathFor(p.slice(0, i + 2 + j).join('/'))}); });
    }
    nodes.forEach(function (node, j) {
      if (j) host.appendChild(el('span', 'crumb-separator', '/'));
      host.appendChild(btn(node.label, 'crumb' + (j === nodes.length - 1 ? ' current' : ''), function () { navigate(node.url); }));
    });
    $('upButton').disabled = !parentUrl(state.url);
  }
  function renderIntro() {
    var d = state.data || {}, type = resourceType(state.url);
    var resourceLabel=type==='root'?'Directory':type==='service'?'Service':kindFor(d,state.url);
    $('eyebrow').textContent=resourceLabel;
    $('pageTitle').textContent=titleFor(d,state.url);
    var description=String(d.description || d.serviceDescription || d.mapName || state.url || '');
    $('pageDescription').textContent=description;
    $('pageDescription').title=description;
    $('introIcon').textContent=iconFor(type==='root'?'service':type);
    var host=clear($('introTools'));
    // Data and Export remain in the tabs. Keep only the high-value shortcuts here.
    if(fullExportCapable())host.appendChild(btn('↓ Export','action-button',function(){setTab('export');}));
    if(window.GISEnhancements)window.GISEnhancements.renderIntro(host);
    var json=btn('↗ JSON','action-button',function(){window.open(jsonUrl(state.url),'_blank','noopener,noreferrer');});
    json.title='View ArcGIS REST JSON';
    var refresh=btn('⟳ Refresh','action-button',function(){navigate(state.url,{refresh:true,noHistory:true});});
    refresh.title='Reload this ArcGIS resource';
    append(host,json,refresh);
  }
  function stats() {
    var d = state.data || {}, type = resourceType(state.url);
    if (type === 'folder' || type === 'root') return [
      ['Folders', (d.folders || []).length, 'Available directories'],['Services', (d.services || []).length, 'Published endpoints'],['Version', d.currentVersion || '—', 'ArcGIS Server'],['Access', 'By server', 'Permissions determined by the ArcGIS server']
    ];
    if (type === 'service') return [['Layers', (d.layers || []).length, 'Map / feature layers'],['Tables', (d.tables || []).length, 'Nonspatial tables'],['Version', d.currentVersion || '—', 'ArcGIS Server'],['Capabilities', short(d.capabilities || '—', 23), 'Service operations']];
    return [['Layer ID', d.id === undefined ? '—' : d.id, 'Resource identifier'],['Fields', (d.fields || []).length, 'Schema columns'],['Geometry', short((d.geometryType || d.type || '—').replace('esriGeometry', ''), 18), 'Layer structure'],['Max records', d.maxRecordCount || '—', 'Server limit']];
  }
  function renderStats() {
    var host=clear($('statGrid'));
    stats().forEach(function(s){
      var c=el('div','stat'), value=formatNum(s[1]);
      c.title=s[2];
      c.setAttribute('aria-label',s[0]+': '+value+'. '+s[2]);
      append(c,el('span','stat-label',s[0]),el('strong','stat-value',value));
      host.appendChild(c);
    });
  }
  function mapCapable() { return /\/MapServer(\/\d+)?$/i.test(new URL(state.url).pathname) || /\/FeatureServer\/\d+$/i.test(new URL(state.url).pathname); }
  function queryCapable() { var d = state.data || {}; return resourceType(state.url) === 'layer' && d.type !== 'Group Layer' && (Array.isArray(d.fields) || Boolean(d.advancedQueryCapabilities)); }

  function availableTabs() {
    var arr=[['overview','Overview']];
    if(queryCapable())arr.push(['data','Data']);
    if(mapCapable())arr.push(['map','Map']);
    if(fullExportCapable())arr.push(['export','Export']);
    arr.push(['advanced','Advanced']);
    return arr;
  }
  function setTab(tab) {
    if(state.tab==='map')cleanupMap();
    state.tab=tab;renderTabs();renderContent();
  }
  function renderTabs() {
    var host=clear($('tabs')),tabs=availableTabs();
    if(!tabs.some(function(x){return x[0]===state.tab;}))state.tab='overview';
    tabs.forEach(function(t){
      host.appendChild(btn(t[1],'tab'+(state.tab===t[0]?' active':''),function(){setTab(t[0]);}));
    });
  }
  function card(title, subtitle) { var c = el('div', 'card'), head = el('div', 'card-head'), side = el('div'); append(side, el('h3', '', title)); if (subtitle) append(side, el('p', '', subtitle)); head.appendChild(side); c.appendChild(head); return {card: c, head: head}; }
  function detailList(items) { var dl = el('dl', 'details'); items.forEach(function (row) { append(dl, el('dt', '', row[0]), el('dd', '', textify(row[1]))); }); return dl; }
  function entriesCard(entries, title) {
    var c = card(title || 'Browse resources', entries.length + ' available entries');
    if (!entries.length) c.card.appendChild(el('div', 'empty', 'No child resources in this directory.'));
    else { var grid = el('div', 'entry-list'); entries.forEach(function (item) {
      var b = btn('', 'entry', function () { navigate(item.url); });
      var txt = el('span', 'entry-copy'); append(txt, el('strong', '', item.title), el('small', '', item.subtitle));
      append(b, el('span', 'entry-icon', iconFor(item.kind)), txt, el('span', '', '›')); grid.appendChild(b);
    }); c.card.appendChild(grid); }
    return c.card;
  }
  function metadataRows(d) {
    var keys = ['currentVersion','serviceItemId','type','geometryType','displayField','objectIdField','globalIdField','maxRecordCount','units','capabilities','supportedQueryFormats','supportedImageFormatTypes','copyrightText','minScale','maxScale','defaultVisibility','hasAttachments','supportsPagination','editingInfo'];
    var rows = keys.filter(function (k) { return d[k] !== undefined && d[k] !== null; }).map(function (k) { return [k, d[k]]; });
    if (d.spatialReference) rows.push(['spatialReference', d.spatialReference]);
    if (d.extent || d.fullExtent) { var ex = d.extent || d.fullExtent; rows.push(['Extent', [ex.xmin, ex.ymin, ex.xmax, ex.ymax].map(function (n) { return Number(n).toFixed(3); }).join(', ') + ' (WKID ' + (ex.spatialReference && (ex.spatialReference.latestWkid || ex.spatialReference.wkid) || '?') + ')']); }
    return rows;
  }
  function renderOverview(host) {
    var d = state.data || {}, type = resourceType(state.url);
    if(fullExportCapable()){
      var downloadCard=card('Download entire layer','All features, not just the current query page.');
      var quick=el('div','export-quick');
      append(quick,el('span','','GeoJSON · Shapefile ZIP · CSV without geometry'),
        btn('Export all features →','primary-button',function(){setTab('export');}));
      downloadCard.card.appendChild(quick);
      host.appendChild(downloadCard.card);
    }
    if(window.GISEnhancements)window.GISEnhancements.renderOverviewAddon(host);
    if (state.children.length) host.appendChild(entriesCard(state.children, type === 'service' ? 'Layers & tables' : type === 'layer' ? 'Sub-layers' : 'Folders & services'));
    var hasMeta = metadataRows(d).length;
    if (hasMeta || type !== 'root') { var c = card('Resource properties', 'Metadata returned by the live ArcGIS REST endpoint'); c.card.appendChild(detailList(metadataRows(d))); host.appendChild(c.card); }
    if (d.description || d.serviceDescription) { var dc = card('Description'); dc.card.appendChild(el('p', 'section-note', d.description || d.serviceDescription)); host.appendChild(dc.card); }
    var links = [], p = state.url;
    if (queryCapable()) links.push(['Query', p + '/query']);
    if (mapCapable()) { var b = p.replace(/\/\d+$/, ''); links.push(['Export map', b + '/export']); links.push(['Legend', b + '/legend']); }
    if (links.length) {
      var op = card('Common operations', 'REST operations exposed by this resource'); var tags = el('div', 'tag-list');
      links.forEach(function (item) { var a = el('a', 'tag', item[0] + ' ↗'); a.href = jsonUrl(item[1]); a.rel = 'noopener noreferrer'; a.target = '_blank'; tags.appendChild(a); });
      op.card.appendChild(tags); host.appendChild(op.card);
    }
    if (!state.children.length && !hasMeta && type === 'root') host.appendChild(el('div', 'empty', 'The response did not list any folders or services.'));
  }
  function table(headers, rows) {
    var wrap = el('div', 'table-scroll'), t = el('table', 'data-table'), thead = el('thead'), tr = el('tr'), tbody = el('tbody');
    headers.forEach(function (h) { tr.appendChild(el('th', '', h)); }); thead.appendChild(tr);
    rows.forEach(function (row) { var r = el('tr'); row.forEach(function (v) { var cell = el('td', '', typeof v === 'object' && v !== null ? JSON.stringify(v) : textify(v)); cell.title = textify(v); r.appendChild(cell); }); tbody.appendChild(r); });
    append(t, thead, tbody); wrap.appendChild(t); return wrap;
  }
  function renderFields(host) {
    var c = card('Field definitions', 'Schema exposed by the ArcGIS REST API');
    var fields = state.data.fields || [];
    c.card.appendChild(table(['Field name','Alias','Data type','Length','Nullable'], fields.map(function (f) { return [f.name, f.alias, String(f.type || '').replace('esriFieldType', ''), f.length === undefined ? '—' : f.length, f.nullable === undefined ? '—' : f.nullable ? 'Yes' : 'No']; })));
    host.appendChild(c.card);
  }
  function renderJson(host) {
    var c = card('Raw JSON response', 'Exact metadata returned by the source endpoint');
    c.head.appendChild(btn('⧉ Copy JSON', 'action-button', function () { copyText(JSON.stringify(state.data, null, 2)); }));
    c.card.appendChild(el('pre', 'code', JSON.stringify(state.data, null, 2))); host.appendChild(c.card);
  }
  function createField(label, value, type, id) { var box = el('label', 'field', label), ctrl = document.createElement(type === 'select' ? 'select' : 'input'); ctrl.id = id; if (type !== 'select') ctrl.type = type || 'text'; ctrl.value = value; box.appendChild(ctrl); return box; }
  function renderQuery(host) {
    var c = card('Query layer records', 'Read-only ArcGIS /query operation · defaults to a bounded sample');
    var grid = el('div', 'form-grid');
    append(grid, createField('WHERE clause', '1=1', 'text', 'queryWhere'), createField('Out fields (comma separated or *)', '*', 'text', 'queryFields'));
    var limit = createField('Rows per request (1–200)', '50', 'number', 'queryLimit');
    limit.querySelector('input').min = '1'; limit.querySelector('input').max = '200';
    var geom = createField('Include geometry', '', 'select', 'queryGeometry');
    [['false','No (faster)'],['true','Yes']].forEach(function (v) { var o = el('option', '', v[1]); o.value = v[0]; geom.querySelector('select').appendChild(o); });
    append(grid, limit, geom); c.card.appendChild(grid);
    var actions = el('div', 'form-actions');
    append(actions, btn('Run query →', 'primary-button', function () { queryRecords(0); }), btn('Count records', 'action-button', countRecords), el('span', 'copy-hint', 'Queries are executed by the source server.'));
    c.card.appendChild(actions); host.appendChild(c.card);
    if (state.result) renderQueryResult(host);
  }

  // FULL LAYER EXPORT
  // Query IDs first: ArcGIS returnIdsOnly avoids service maxRecordCount limits.
  // A bounded pool of independent asynchronous fetch workers downloads batches.
  // Entire export is withheld if any batch fails or returns incomplete data.
  function fullExportCapable(){
    var d=state.data||{},type=resourceType(state.url);
    if(type!=='layer' || !Array.isArray(d.fields) || !d.fields.length)return false;
    if(d.type==='Group Layer' || d.type==='Annotation Layer')return false;
    if(d.capabilities && typeof d.capabilities==='string' && !d.capabilities.toLowerCase().includes('query'))return false;
    return true;
  }
  function exportIsTable(){
    return (state.data||{}).type==='Table' || (state.data||{}).geometryType===undefined && (state.data||{}).type==='Table';
  }
  function safeExportName(value){
    return (String(value||'layer').normalize('NFKD').replace(/[^\w.-]+/g,'_').replace(/^[_\.]+|[_\.]+$/g,'').slice(0,70)||'layer');
  }
  function exportFileName(job,extension){
    return safeExportName(job.name)+'_'+job.total+'features.'+extension;
  }
  function exportRequestError(message,retry){
    var err=new Error(message);err.retryable=Boolean(retry);return err;
  }
  function exportCancelled(job){
    return !job || job.cancelled || job.signal.aborted;
  }
  function exportProgress(job,message){
    if(!job)return;
    job.message=message||job.message;
    var elapsed=Math.max(1,(Date.now()-job.started)/1000),
      rate=job.done/elapsed;
    var percent=job.total ? Math.min(100,Math.round(100*job.done/job.total)):(job.status==='ready'?100:0);
    var percentEl=$('exportPercent'),bar=$('exportProgressBar'),progress=$('exportProgressText');
    if(percentEl)percentEl.textContent=percent+'%';
    if(bar){bar.style.width=percent+'%';bar.parentElement.setAttribute('aria-valuenow',String(percent));}
    if(progress)progress.textContent=job.message+' · '+job.done.toLocaleString()+' / '+job.total.toLocaleString()+
      ' records · '+(rate>=1?Math.round(rate).toLocaleString()+' records/s':'Starting…')+
      ' · '+job.completedBatches+'/'+job.batches+' batches';
  }
  function cancelFullExport(silent){
    var job=state.exportJob;
    if(!job)return;
    job.cancelled=true;
    job.controller.abort();
    if(job.zipWorker){job.zipWorker.terminate();job.zipWorker=null;}
    if(job.rejectZip){var fail=job.rejectZip;job.rejectZip=null;fail(new Error('Export cancelled'));}
    if(job.objectUrl){URL.revokeObjectURL(job.objectUrl);job.objectUrl='';}
    if(silent){state.exportJob=null;return;}
    job.chunks=[];
    job.status='cancelled';job.message='Export cancelled';
    exportProgress(job,'Export cancelled');
    if(state.tab==='export')renderContent();
  }
  function exportTextCell(value){
    if(value===undefined||value===null)return '';
    if(typeof value==='object')return JSON.stringify(value);
    if(typeof value==='boolean')return value?'true':'false';
    return String(value);
  }
  function exportAttributeValue(attrs,name){
    if(attrs[name]!==undefined)return attrs[name];
    var key=Object.keys(attrs).find(function(k){return k.toLowerCase()===name.toLowerCase();});
    return key?attrs[key]:undefined;
  }
  function csvCell(value){
    var raw=exportTextCell(value);
    // Neutralize spreadsheet formula injection without changing numeric cells.
    if(typeof value==='string' && /^\s*[=+@]/.test(raw))raw="'"+raw;
    return '"'+raw.replace(/"/g,'""')+'"';
  }
  function geoCoord(p){return Array.isArray(p)?[Number(p[0]),Number(p[1])]:null;}
  function closeGeoRing(input){
    var ring=input.map(geoCoord).filter(function(p){return p&&Number.isFinite(p[0])&&Number.isFinite(p[1]);});
    if(ring.length<3)return [];
    var a=ring[0],z=ring[ring.length-1];
    if(a[0]!==z[0] || a[1]!==z[1])ring.push(a.slice());
    return ring.length>=4?ring:[];
  }
  function signedRingArea(r){
    var sum=0;
    for(var i=0;i<r.length-1;i++)sum+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];
    return sum/2;
  }
  function ringArea(r){return Math.abs(signedRingArea(r));}
  function pointInGeoRing(p,r){
    var inside=false;
    for(var i=0,j=r.length-1;i<r.length;j=i++){
      var a=r[i],b=r[j],cross=(a[1]>p[1])!==(b[1]>p[1]) &&
        p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0];
      if(cross)inside=!inside;
    }
    return inside;
  }
  function polygonFromRings(raw){
    var rings=raw.map(closeGeoRing).filter(function(r){return r.length;})
      .map(function(r){return {ring:r,area:ringArea(r),parent:null,depth:0,polygon:null};})
      .sort(function(a,b){return b.area-a.area;});
    var polygons=[];
    rings.forEach(function(entry){
      var closest=null;
      rings.forEach(function(candidate){
        if(candidate===entry||candidate.area<=entry.area || !pointInGeoRing(entry.ring[0],candidate.ring))return;
        if(!closest || candidate.area<closest.area)closest=candidate;
      });
      entry.parent=closest;entry.depth=closest?closest.depth+1:0;
      // RFC 7946: exterior rings counterclockwise, holes clockwise.
      // ArcGIS commonly returns the opposite winding order.
      if(entry.depth%2===0){
        if(signedRingArea(entry.ring)<0)entry.ring.reverse();
        entry.polygon=[entry.ring];polygons.push(entry.polygon);
      }else{
        if(signedRingArea(entry.ring)>0)entry.ring.reverse();
        var parent=entry.parent;
        while(parent && parent.depth%2!==0)parent=parent.parent;
        if(parent && parent.polygon)parent.polygon.push(entry.ring);
        else{entry.polygon=[entry.ring];polygons.push(entry.polygon);}
      }
    });
    return polygons.length===1?{type:'Polygon',coordinates:polygons[0]}
      :{type:'MultiPolygon',coordinates:polygons};
  }
  function esriToGeoGeometry(g){
    if(!g)return null;
    if(g.curvePaths || g.curveRings)throw new Error('This layer contains true curves. GeoJSON/Shapefile export cannot preserve these curves without densification. Use CSV attributes or an ArcGIS-native export.');
    if(g.x!==undefined&&g.y!==undefined)return {type:'Point',coordinates:[Number(g.x),Number(g.y)]};
    if(Array.isArray(g.points))return {type:'MultiPoint',coordinates:g.points.map(geoCoord)};
    if(Array.isArray(g.paths)){
      var paths=g.paths.map(function(p){return p.map(geoCoord);}).filter(function(p){return p.length>=2;});
      return paths.length===1?{type:'LineString',coordinates:paths[0]}
        :{type:'MultiLineString',coordinates:paths};
    }
    if(Array.isArray(g.rings))return polygonFromRings(g.rings);
    if(g.xmin!==undefined && g.ymin!==undefined && g.xmax!==undefined && g.ymax!==undefined){
      var box=[[g.xmin,g.ymin],[g.xmax,g.ymin],[g.xmax,g.ymax],[g.xmin,g.ymax],[g.xmin,g.ymin]];
      return {type:'Polygon',coordinates:[box]};
    }
    throw new Error('Unsupported ArcGIS geometry type. Export CSV instead.');
  }
  function exportAsGeoFeature(f,oidField){
    var props=f.attributes||f.properties||{},geo=esriToGeoGeometry(f.geometry);
    var out={type:'Feature',geometry:geo,properties:props};
    if(props[oidField]!==undefined)out.id=props[oidField];
    return out;
  }
  function exportUiStatus(job){
    var button=$('exportStart');
    if(button)button.disabled=Boolean(job && (job.status==='running'||job.status==='packing'));
    var host=$('exportStatus');
    if(!host)return;
    clear(host);
    if(!job){
      host.appendChild(el('p','export-hint','This downloads all records, not just the current page. Large layers may take several minutes.'));
      return;
    }
    var top=el('div','export-status-head');
    append(top,el('strong','',job.status==='ready'?'Export ready':job.status==='failed'?'Export failed':
      job.status==='cancelled'?'Export cancelled':job.status==='packing'?'Preparing download…':'Exporting layer…'),
      el('span','export-percent','0%'));
    top.lastChild.id='exportPercent';
    host.appendChild(top);
    var track=el('div','export-track');track.setAttribute('role','progressbar');
    track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow','0');
    var bar=el('div','export-bar');bar.id='exportProgressBar';track.appendChild(bar);host.appendChild(track);
    var msg=el('p','export-progress-text','');msg.id='exportProgressText';host.appendChild(msg);
    if(job.status==='running'||job.status==='packing'){
      var stop=btn('Cancel export','action-button',function(){cancelFullExport(false);});
      stop.classList.add('export-stop');host.appendChild(stop);
    }
    if(job.status==='ready' && job.objectUrl){
      var a=el('a','export-download','↓ Download '+job.fileName);
      a.href=job.objectUrl;a.download=job.fileName;
      a.setAttribute('aria-label','Download completed full-layer export');
      host.appendChild(a);
      host.appendChild(el('p','export-hint','Keep this page open until your download finishes. File is generated in your browser.'));
    }
    if(job.error)host.appendChild(el('p','export-error',job.error));
    exportProgress(job,job.message);
  }
  function renderFullExport(host){
    var layer=state.data||{},isTable=exportIsTable();
    var c=card('Export all layer features','Full dataset export, including layers with 100,000+ records');
    c.card.classList.add('export-card');
    var p=el('p','export-description','All matching records are requested in parallel batches. Missing or truncated batches stop the export instead of producing an incomplete file.');
    c.card.appendChild(p);
    var grid=el('div','export-grid');
    var format=el('label','field','Format');
    var select=el('select','','');select.id='fullExportFormat';
    [['geojson','GeoJSON (.geojson)'],['shp','ESRI Shapefile (.zip)'],['csv','CSV, attributes only (.csv)']].forEach(function(x){
      if(isTable&&x[0]!=='csv')return;
      var o=el('option','',x[1]);o.value=x[0];select.appendChild(o);
    });
    if(isTable)select.value='csv';
    format.appendChild(select);
    var context=state.exportContext||{},mode=context.ids?.length?'selected':context.bbox?'extent':context.where && context.where!=='1=1'?'filtered':'all';
    var scope=el('label','field','Export scope');
    var scopeSelect=el('select');scopeSelect.id='fullExportScope';
    [['all','Entire layer'],['filtered','Current filter'],['selected','Selected records'],['extent','Selected map extent']].forEach(function(entry){
      var opt=el('option','',entry[1]);opt.value=entry[0];
      if(entry[0]==='selected'&&!context.ids?.length)opt.disabled=true;
      if(entry[0]==='extent'&&!context.bbox)opt.disabled=true;
      scopeSelect.appendChild(opt);
    });
    scopeSelect.value=mode;scope.appendChild(scopeSelect);
    var where=createField('WHERE clause (1=1 for all features)',mode==='all'||mode==='selected'?'1=1':(context.where||'1=1'),'text','fullExportWhere');
    scopeSelect.addEventListener('change',function(){
      where.querySelector('input').value=scopeSelect.value==='all'||scopeSelect.value==='selected'?'1=1':(context.where||'1=1');
    });
    var workers=el('label','field','Parallel download workers');
    var workerSelect=el('select');workerSelect.id='fullExportWorkers';
    [['2','2 – Light'],['4','4 – Balanced'],['6','6 – Faster'],['8','8 – Maximum']].forEach(function(x){
      var o=el('option','',x[1]);o.value=x[0];workerSelect.appendChild(o);
    });
    workerSelect.value='4';workers.appendChild(workerSelect);
    var batch=el('label','field','Requested records per batch');
    var batchSelect=el('select');batchSelect.id='fullExportBatch';
    [['100','100 – Conservative'],['250','250 – Balanced'],['500','500 – Faster'],['1000','1,000 – Server permitting']].forEach(function(x){
      var o=el('option','',x[1]);o.value=x[0];batchSelect.appendChild(o);
    });
    batchSelect.value='250';batch.appendChild(batchSelect);
    append(grid,format,scope,where,workers,batch);
    c.card.appendChild(grid);
    var guidance=el('div','export-guidance');
    guidance.appendChild(el('p','','CSV is attributes-only: no coordinates, WKT, or geometry are requested from the server.'));
    guidance.appendChild(el('p','','GeoJSON uses WGS 84 (longitude/latitude). Shapefile ZIP includes spatial files but limits DBF field names to 10 characters and may require substantial memory on phones.'));
    c.card.appendChild(guidance);
    var actions=el('div','export-actions');
    var go=btn('↓ Prepare full export','primary-button',function(){beginFullExport();});
    go.id='exportStart';
    if(state.exportJob && (state.exportJob.status==='running'||state.exportJob.status==='packing'))go.disabled=true;
    actions.appendChild(go);
    c.card.appendChild(actions);
    var summary=el('div','export-status');summary.id='exportStatus';c.card.appendChild(summary);
    host.appendChild(c.card);
    exportUiStatus(state.exportJob);
  }
  async function exportPost(job,params){
    if(exportCancelled(job))throw exportRequestError('Export cancelled',false);
    var target=job.url+'/query',token=scopedToken(target);
    var data=new URLSearchParams();
    Object.keys(params).forEach(function(k){
      if(params[k]!==undefined&&params[k]!==null)data.set(k,String(params[k]));
    });
    data.set('f','json');
    if(token)data.set('token',token);
    var response;
    try{
      response=await fetch(target,{method:'POST',body:data,
        mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
        referrerPolicy:'no-referrer',signal:job.signal,
        headers:{Accept:'application/json'}});
    }catch(e){
      if(exportCancelled(job))throw exportRequestError('Export cancelled',false);
      throw exportRequestError('ArcGIS request failed (network, CORS, server unavailable, or VPN). '+(e.message||''),true);
    }
    if(!response.ok){
      var retry=[408,429,500,502,503,504].includes(response.status);
      throw exportRequestError('ArcGIS export returned HTTP '+response.status+'.',retry);
    }
    var result;
    try{result=await response.json();}
    catch(e){throw exportRequestError('ArcGIS response was not valid JSON.',true);}
    if(result.error){
      var code=Number(result.error.code||0);
      var message='ArcGIS '+code+': '+(result.error.message||'Query failed');
      throw exportRequestError(message,[429,500,502,503,504].includes(code));
    }
    return result;
  }
  async function exportRetry(job,params){
    var attempt=0;
    while(true){
      if(exportCancelled(job))throw exportRequestError('Export cancelled',false);
      try{return await exportPost(job,params);}
      catch(e){
        if(exportCancelled(job))throw e;
        if(++attempt>3 || !e.retryable)throw e;
        await new Promise(function(resolve){setTimeout(resolve,Math.min(5000,350*Math.pow(2,attempt)));});
      }
    }
  }
  function exportOidField(metadata,idInfo){
    return idInfo.objectIdFieldName || metadata.objectIdField ||
      metadata.objectIdFieldName ||
      ((metadata.fields||[]).find(function(f){return f.type==='esriFieldTypeOID';})||{}).name || 'OBJECTID';
  }
  function exportOidValue(feature,field){
    var a=feature.attributes||feature.properties||{};
    if(a[field]!==undefined)return a[field];
    var k=Object.keys(a).find(function(x){return x.toLowerCase()===field.toLowerCase();});
    return k?a[k]:undefined;
  }
  async function exportChunk(job,ids,depth){
    if(exportCancelled(job))throw exportRequestError('Export cancelled',false);
    var params={objectIds:ids.join(','),where:'1=1',outFields:'*',
      returnGeometry:job.geometry?'true':'false'};
    if(job.geometry)params.outSR=4326;
    var data;
    try{data=await exportRetry(job,params);}
    catch(e){
      // Only split requests when ArcGIS explicitly reports a service batch-size limit.
      // CORS, offline, permission, and temporary server failures must not fan out.
      if(ids.length<=1 || depth>=12 || !/maxrecordcount|too many|exceed|transfer limit|request.*large|size limit|HTTP 413/i.test(e.message))throw e;
      var middle=Math.floor(ids.length/2);
      var first=await exportChunk(job,ids.slice(0,middle),depth+1);
      var second=await exportChunk(job,ids.slice(middle),depth+1);
      return first.concat(second);
    }
    var features=Array.isArray(data.features)?data.features:[];
    var lookup=new Map();
    features.forEach(function(feature){
      var oid=exportOidValue(feature,job.oidField);
      if(oid!==undefined)lookup.set(String(oid),feature);
    });
    var ordered=ids.map(function(id){return lookup.get(String(id));});
    if(ordered.some(function(x){return !x;})){
      if(ids.length===1)throw new Error('A feature disappeared or could not be retrieved (OID '+ids[0]+'). No incomplete file will be downloaded.');
      if(depth>=12)throw new Error('Layer returned fewer records than requested after retries. No incomplete file will be downloaded.');
      var half=Math.floor(ids.length/2);
      return (await exportChunk(job,ids.slice(0,half),depth+1))
        .concat(await exportChunk(job,ids.slice(half),depth+1));
    }
    if(job.geometry && data.spatialReference){
      var sr=data.spatialReference.latestWkid||data.spatialReference.wkid;
      if(sr && sr!==4326 && sr!==4269)throw new Error('ArcGIS did not return WGS 84 geometry (WKID '+sr+'). Export stopped to avoid incorrect coordinates.');
    }
    return ordered;
  }
  async function convertForExport(job,feature){
    if(job.format==='csv'){
      var a=feature.attributes||{};
      return job.fields.map(function(name){return csvCell(exportAttributeValue(a,name));}).join(',');
    }
    var geo=exportAsGeoFeature(feature,job.oidField);
    if(job.format==='shp' && !geo.geometry)
      throw new Error('At least one record lacks geometry. Shapefile ZIP cannot preserve null geometries. Export GeoJSON or CSV instead.');
    return geo;
  }
  function saveFullBlob(job,blob,extension){
    job.objectUrl=URL.createObjectURL(blob);
    job.fileName=exportFileName(job,extension);
    job.status='ready';
    job.done=job.total;
    job.chunks=[];
    job.message='Complete';
    exportUiStatus(job);
  }
  function zipInWorker(job,features){
    return new Promise(function(resolve,reject){
      var worker;
      try{worker=new Worker(new URL('./export-worker.js',document.baseURI));}
      catch(e){reject(new Error('Browser cannot start the shapefile packaging worker: '+e.message));return;}
      job.zipWorker=worker;
      job.rejectZip=reject;
      worker.onmessage=function(event){
        job.rejectZip=null;
        var d=event.data||{};
        worker.terminate();job.zipWorker=null;
        if(exportCancelled(job)){reject(new Error('Export cancelled'));return;}
        if(!d.ok){reject(new Error(d.error||'Shapefile packaging failed'));return;}
        resolve(d.bytes);
      };
      worker.onerror=function(e){
        job.rejectZip=null;
        worker.terminate();job.zipWorker=null;
        reject(new Error('Shapefile worker could not load or package the ZIP. Check access to @mapbox/shp-write. '+(e.message||'')));
      };
      worker.postMessage({name:safeExportName(job.name),features:features});
    });
  }
  async function beginFullExport(){
    if(!fullExportCapable())return;
    if(state.exportJob && ['running','packing'].includes(state.exportJob.status))return;
    if(state.exportJob)cancelFullExport(true);
    var d=state.data||{},format=$('fullExportFormat').value,
      scope=$('fullExportScope').value,context=state.exportContext||{},
      where=$('fullExportWhere').value.trim()||'1=1',
      workers=Number($('fullExportWorkers').value)||4,
      requestedBatch=Number($('fullExportBatch').value)||250;
    var controller=new AbortController();
    var job={
      url:state.url,name:titleFor(d,state.url),format:format,where:where,scope:scope,
      workers:Math.max(1,Math.min(8,workers)),requestedBatch:requestedBatch,
      fields:(d.fields||[]).map(function(f){return f.name;}),
      geometry:format!=='csv',oidField:'',started:Date.now(),
      status:'running',message:'Requesting all matching object IDs',error:'',
      total:0,done:0,batches:0,completedBatches:0,chunks:[],
      controller:controller,signal:controller.signal,
      objectUrl:'',fileName:'',zipWorker:null,rejectZip:null,cancelled:false
    };
    state.exportJob=job;
    exportUiStatus(job);
    var go=$('exportStart');if(go)go.disabled=true;
    try{
      if(scope==='selected'&&!context.ids?.length)throw new Error('No records are selected. Return to Data and select records first.');
      if(scope==='extent'&&!context.bbox)throw new Error('Select an area on the map before exporting an extent.');
      var whereParams={where:job.where,returnIdsOnly:'true',returnGeometry:'false'};
      if(scope==='extent'){
        var b=context.bbox;
        Object.assign(whereParams,{geometry:JSON.stringify({xmin:b.west,ymin:b.south,xmax:b.east,ymax:b.north,
          spatialReference:{wkid:4326}}),geometryType:'esriGeometryEnvelope',inSR:4326,
          spatialRel:'esriSpatialRelIntersects'});
      }
      var idsResponse=scope==='selected'
        ? {objectIds:context.ids.slice(),objectIdFieldName:d.objectIdField||d.objectIdFieldName}
        : await exportRetry(job,whereParams);
      if(!Array.isArray(idsResponse.objectIds))
        throw new Error('This ArcGIS layer did not return object IDs. A complete and reliable export cannot be guaranteed with its current Query capabilities.');
      job.oidField=exportOidField(d,idsResponse);
      var ids=Array.from(new Set(idsResponse.objectIds.map(String))).sort(function(a,b){
        var an=Number(a),bn=Number(b);
        return Number.isFinite(an)&&Number.isFinite(bn)?an-bn:a.localeCompare(b);
      });
      job.total=ids.length;
      if(exportCancelled(job))return;
      job.message='Checking layer record count';
      exportProgress(job,job.message);
      // Detect partial ID responses caused by service restrictions (or edits).
      try{
        var countParams=Object.assign({},whereParams);
        delete countParams.returnIdsOnly;
        countParams.returnCountOnly='true';
        var countResponse=scope==='selected'?{count:ids.length}:await exportRetry(job,countParams);
        if(Number.isInteger(countResponse.count)&&countResponse.count!==ids.length){
          throw new Error('ArcGIS reported '+countResponse.count+' matching records but returned '+ids.length+
            ' object IDs. The layer may be changing or restricting results. Export stopped rather than generating an incomplete file.');
        }
      }catch(e){
        if(/reported .*matching records/i.test(e.message))throw e;
        if(exportCancelled(job))return;
        // Older ArcGIS servers can reject returnCountOnly. ID list remains authoritative.
      }
      var batchSize=Math.max(1,Math.min(job.requestedBatch,d.maxRecordCount||job.requestedBatch));
      var groups=[];
      for(var i=0;i<ids.length;i+=batchSize)groups.push(ids.slice(i,i+batchSize));
      job.batches=groups.length;
      job.message='Downloading all features';
      exportProgress(job,job.message);
      var next=0,firstError=null,processing=[];
      async function downloader(){
        while(next<groups.length && !firstError && !exportCancelled(job)){
          var slot=next++;
          try{
            var rows=await exportChunk(job,groups[slot],0);
            if(rows.length!==groups[slot].length)throw new Error('Incomplete batch '+(slot+1));
            if(job.format==='csv'){
              var lines=rows.map(function(feature){
                var attrs=feature.attributes||{};
                return job.fields.map(function(field){return csvCell(exportAttributeValue(attrs,field));}).join(',');
              });
              job.chunks[slot]=lines.join('\r\n');
            }else{
              job.chunks[slot]=rows.map(function(feature){return exportAsGeoFeature(feature,job.oidField);});
            }
            job.done+=rows.length;job.completedBatches++;
            exportProgress(job,'Downloading all features');
          }catch(err){
            if(!firstError)firstError=err;
            controller.abort();
            return;
          }
        }
      }
      for(var n=0;n<Math.min(job.workers,groups.length);n++)processing.push(downloader());
      await Promise.all(processing);
      // A failed worker aborts sibling requests; report the actual failure
      // before considering the abort signal to be a user cancellation.
      if(firstError)throw firstError;
      if(exportCancelled(job))return;
      if(job.done!==job.total || job.completedBatches!==job.batches)
        throw new Error('Not all features were retrieved. No partial file was created.');
      job.status='packing';job.message='Preparing file';exportUiStatus(job);
      if(job.format==='csv'){
        var pieces=['\uFEFF',job.fields.map(csvCell).join(',')+'\r\n'];
        job.chunks.forEach(function(text,i){if(i)pieces.push('\r\n');pieces.push(text);});
        saveFullBlob(job,new Blob(pieces,{type:'text/csv;charset=utf-8'}),'csv');
      }else if(job.format==='geojson'){
        var geoParts=['{"type":"FeatureCollection","features":['];
        job.chunks.forEach(function(features){
          features.forEach(function(feature){
            if(geoParts.length>1)geoParts.push(',');
            geoParts.push(JSON.stringify(feature));
          });
        });
        geoParts.push(']}');
        saveFullBlob(job,new Blob(geoParts,{type:'application/geo+json'}),'geojson');
      }else{
        var geoFeatures=job.chunks.flat();
        job.chunks=[]; // reduce memory before creating the ZIP
        job.message='Packaging Shapefile ZIP in a background worker';
        exportUiStatus(job);
        var bytes=await zipInWorker(job,geoFeatures);
        if(exportCancelled(job))return;
        saveFullBlob(job,new Blob([bytes],{type:'application/zip'}),'zip');
      }
    }catch(e){
      if(job.cancelled)return;
      job.status='failed';
      job.error=String(e.message||e);
      job.message='Export stopped';
      if(job.zipWorker){job.zipWorker.terminate();job.zipWorker=null;}
      job.rejectZip=null;
      controller.abort();
      job.chunks=[];
      exportUiStatus(job);
    }
  }

  function queryArgs(offset) {
    var where = $('queryWhere').value.trim() || '1=1', fields = $('queryFields').value.trim() || '*';
    var limit = Math.min(200, Math.max(1, Number($('queryLimit').value) || 50));
    var geometry = $('queryGeometry').value;
    return {where: where, outFields: fields, returnGeometry: geometry, resultRecordCount: limit, resultOffset: offset || 0, f: 'json'};
  }
  async function fetchData(url) {
    var request=new URL(url),token=scopedToken(request.href);
    // ArcGIS metadata endpoints are predominantly GET. Only add an ArcGIS
    // token to a request for the exact origin + REST root chosen by the user.
    if(token)request.searchParams.set('token',token);
    var response;
    try{
      response=await fetch(request.href,{mode:'cors',credentials:'omit',
        redirect:token?'error':'follow',referrerPolicy:'no-referrer',
        cache:token?'no-store':'default',headers:{Accept:'application/json'}});
    }catch(e){
      throw new Error('Browser could not reach this ArcGIS API. Check HTTPS, network or VPN access, authentication, and whether this server permits CORS from '+location.origin+'.');
    }
    if(!response.ok){
      if(response.status===401 || response.status===403)
        throw new Error('ArcGIS denied access (HTTP '+response.status+'). Open Sign in to supply a valid token, or check your permissions.');
      throw new Error('Server returned HTTP '+response.status+' ('+response.statusText+').');
    }
    var raw=await response.text(), result;
    try{result=JSON.parse(raw);}
    catch(e){throw new Error('The endpoint did not return JSON. It may require authentication, redirect to a login page, or have the REST API disabled.');}
    if(result.error){
      var code=Number(result.error.code);
      if(code===498 || code===499)throw new Error('ArcGIS token is invalid, expired, or missing (error '+code+'). Open Sign in and reconnect with a valid token.');
      throw new Error('ArcGIS error '+(result.error.code||'')+': '+(result.error.message||'Request failed')+(result.error.details?.length?' — '+result.error.details.join('; '):''));
    }
    return result;
  }
  async function queryRecords(offset) {
    var box = $('queryWhere'); if (!box) return;
    var args = queryArgs(offset);
    state.lastQuery = args;
    state.result = null; state.offset = offset;
    var host = $('content'), waiting = el('div', 'card loading-box'); append(waiting, el('div', 'spinner'), el('div', '', 'Querying records…')); host.appendChild(waiting);
    try {
      var result = await fetchData(buildUrl(state.url + '/query', args));
      state.result = {payload: result, args: args};
      waiting.remove();
      var old = $('queryResults'); if (old) old.remove();
      renderQueryResult(host);
    } catch (e) { waiting.remove(); showAlert('Query failed', e.message, true, jsonUrl(state.url + '/query')); }
  }
  async function countRecords() {
    var args = queryArgs(0); args.returnCountOnly = true;
    delete args.outFields; delete args.returnGeometry; delete args.resultRecordCount; delete args.resultOffset;
    try { var d = await fetchData(buildUrl(state.url + '/query', args)); showAlert('Matching records', formatNum(d.count) + ' records match the WHERE clause.', false); }
    catch (e) { showAlert('Count failed', e.message, true); }
  }
  function csvValue(v) { var s = textify(v); return '"' + s.replace(/"/g, '""') + '"'; }
  function downloadBlob(content, name, type) { var blob = new Blob([content], {type: type}), u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); }
  function renderQueryResult(host) {
    var r = state.result; if (!r) return;
    var payload = r.payload, features = payload.features || [], attrs = features.map(function (f) { return f.attributes || f.properties || {}; });
    var keys = Array.from(new Set(attrs.flatMap(function (a) { return Object.keys(a); })));
    var c = card('Query results', 'Server-side results, limited to ' + r.args.resultRecordCount + ' records per request'); c.card.id = 'queryResults';
    var tool = el('div', 'form-actions'); tool.style.marginTop = '0';
    if (features.length) append(tool, btn('↓ CSV', 'action-button', function () { downloadBlob([keys.map(csvValue).join(',')].concat(attrs.map(function (a) { return keys.map(function (k) { return csvValue(a[k]); }).join(','); })).join('\n'), 'gis-query.csv', 'text/csv;charset=utf-8'); }), btn('↓ JSON', 'action-button', function () { downloadBlob(JSON.stringify(payload, null, 2), 'gis-query.json', 'application/json'); }));
    c.card.appendChild(tool);
    c.card.appendChild(el('p', 'result-meta', formatNum(features.length) + ' records returned' + (payload.exceededTransferLimit ? ' · More records may be available' : '') + (payload.spatialReference ? ' · WKID ' + (payload.spatialReference.wkid || payload.spatialReference.latestWkid || '—') : '')));
    if (features.length) c.card.appendChild(table(keys, attrs.map(function (a) { return keys.map(function (k) { return a[k]; }); })));
    else c.card.appendChild(el('div', 'empty', 'No matching records. Check the WHERE clause.'));
    var pager = el('div', 'pager');
    var prev = btn('← Previous', 'action-button', function () { queryRecords(Math.max(0, state.offset - r.args.resultRecordCount)); }); prev.disabled = state.offset <= 0;
    var next = btn('Next →', 'action-button', function () { queryRecords(state.offset + r.args.resultRecordCount); });
    next.disabled = features.length < r.args.resultRecordCount && !payload.exceededTransferLimit;
    append(pager, prev, el('span', '', 'Offset ' + state.offset), next); c.card.appendChild(pager); host.appendChild(c.card);
    if (payload.exceededTransferLimit) c.card.appendChild(el('p', 'section-note', 'The server reports a transfer limit. Pagination support depends on the service.'));
  }

  // The ArcGIS export image is a raster. Identify is a separate, read-only
  // MapServer request, matched against the map's actual visible extent.
  function inspectorEl() { return $('featureInspector'); }
  function inspectorClose() {
    var p=inspectorEl();
    if (p) { p.hidden=true; clear(p); }
  }
  function cleanupMap() {
    state.mapImageSeq=(state.mapImageSeq||0)+1;
    state.vectorSeq=(state.vectorSeq||0)+1;
    if(state.vectorLayer && state.map){state.map.removeLayer(state.vectorLayer);state.vectorLayer=null;}
    if(state.overlay && state.overlay._gisBlobUrl)URL.revokeObjectURL(state.overlay._gisBlobUrl);
    state.identifySeq=(state.identifySeq||0)+1;
    state.identifyContext=null;
    inspectorClose();
    if(state.map) { state.map.off(); state.map.remove(); state.map=null; state.overlay=null; }
    clearTimeout(state.mapTimer);
  }
  function mapRoot() { return state.url.replace(/\/\d+$/, ''); }
  function zoomToExtent(map, e) {
    if (!e || !e.spatialReference) return;
    var wkid=e.spatialReference.latestWkid || e.spatialReference.wkid;
    try {
      var a,b;
      if (wkid===4326 || wkid===4269) {a=L.latLng(e.ymin,e.xmin);b=L.latLng(e.ymax,e.xmax);}
      else if(wkid===102100 || wkid===102113 || wkid===3857) {a=L.CRS.EPSG3857.unproject(L.point(e.xmin,e.ymin));b=L.CRS.EPSG3857.unproject(L.point(e.xmax,e.ymax));}
      else return;
      if(Number.isFinite(a.lat)&&Number.isFinite(b.lat)) map.fitBounds(L.latLngBounds(a,b),{padding:[25,25],maxZoom:14});
    }catch(e){}
  }

  function refreshOverlay() {
    if(!state.map)return;
    if(/\/FeatureServer\/\d+$/i.test(new URL(state.url).pathname)){
      if(window.GISEnhancements)window.GISEnhancements.refreshVectorOverlay(state.map);
      return;
    }
    var map=state.map,bounds=map.getBounds(),dims=map.getSize(),
      sw=L.CRS.EPSG3857.project(bounds.getSouthWest()),
      ne=L.CRS.EPSG3857.project(bounds.getNorthEast());
    var opts={
      bbox:[sw.x,sw.y,ne.x,ne.y].join(','),bboxSR:3857,imageSR:3857,
      size:Math.round(dims.x)+','+Math.round(dims.y),format:'png32',
      transparent:'true',dpi:96,f:'image'
    };
    var path=urlParts(state.url);
    if(Array.isArray(state.visibleMapLayers))opts.layers=state.visibleMapLayers.length?'show:'+state.visibleMapLayers.join(','):'hide:'+((state.data.layers||[]).map(function(l){return l.id}).join(','));
    else if(/^\d+$/.test(path[path.length-1]||''))opts.layers='show:'+path[path.length-1];
    var base=mapRoot()+'/export', token=scopedToken(base);
    var requestId=state.mapImageSeq=(state.mapImageSeq||0)+1;
    function renderOverlay(src,blobUrl){
      if(!state.map || state.map!==map || requestId!==state.mapImageSeq){
        if(blobUrl)URL.revokeObjectURL(blobUrl);return;
      }
      var overlay=L.imageOverlay(src,bounds,{opacity:typeof state.mapOpacity==='number'?state.mapOpacity:.82});
      overlay._gisBlobUrl=blobUrl||'';
      overlay.on('load',function(){
        if(!state.map || state.map!==map || requestId!==state.mapImageSeq)return;
        if(state.overlay && state.overlay!==overlay) {
          map.removeLayer(state.overlay);
          if(state.overlay._gisBlobUrl)URL.revokeObjectURL(state.overlay._gisBlobUrl);
        }
        state.overlay=overlay;
      });
      overlay.on('error',function(){
        if(map.hasLayer(overlay))map.removeLayer(overlay);
        if(blobUrl)URL.revokeObjectURL(blobUrl);
      });
      overlay.addTo(map);
    }
    if(!token){
      renderOverlay(buildUrl(base,opts),'');return;
    }
    // Protected map exports use POST + a local Blob URL, avoiding tokens
    // in image URLs, referrer headers, or browser navigation history.
    var form=new URLSearchParams();
    Object.keys(opts).forEach(function(k){form.set(k,String(opts[k]));});
    form.set('token',token);
    fetch(base,{method:'POST',mode:'cors',credentials:'omit',redirect:'error',
      cache:'no-store',referrerPolicy:'no-referrer',
      body:form.toString(),headers:{
        'Content-Type':'application/x-www-form-urlencoded','Accept':'image/png'
      }}).then(function(resp){
        if(!resp.ok)throw new Error('Map export HTTP '+resp.status);
        var type=resp.headers.get('content-type')||'';
        if(!/^image\//i.test(type))throw new Error('Map export did not return an image');
        return resp.blob();
      }).then(function(blob){
        var objectUrl=URL.createObjectURL(blob);
        renderOverlay(objectUrl,objectUrl);
      }).catch(function(err){
        if(requestId===state.mapImageSeq && state.map===map){
          var note=$('mapAuthWarning');
          if(note)note.textContent='Protected map could not load: '+err.message+'. The ArcGIS server must allow authenticated POST and CORS.';
        }
      });
  }
  function inspectorHeader(heading,subtitle){
    var panel=inspectorEl();if(!panel)return null;
    clear(panel);panel.hidden=false;
    panel.setAttribute('role','region');
    panel.setAttribute('aria-label','Map feature details');
    var header=el('div','identify-header'),
      titles=el('div','identify-headings');
    append(titles,el('h4','',heading),el('p','',subtitle||''));
    var close=btn('×','identify-close',inspectorClose);
    close.title='Close feature details';
    close.setAttribute('aria-label','Close feature details');
    append(header,titles,close);
    panel.appendChild(header);
    return panel;
  }
  function inspectorMessage(heading,subtitle,bodyText,working){
    var panel=inspectorHeader(heading,subtitle);
    if(!panel)return;
    var body=el('div','identify-body');
    if(working)body.appendChild(el('div','identify-spin'));
    body.appendChild(el('p','identify-message',bodyText));
    panel.appendChild(body);
  }
  function identifyValue(value){
    if(value===null || value===undefined || value==='')return '—';
    if(typeof value==='object'){
      try{return JSON.stringify(value,null,2);}catch(e){return String(value);}
    }
    if(typeof value==='boolean')return value?'True':'False';
    return String(value);
  }
  function identifyAttributesFor(result){return result.fullAttributes || result.attributes || {};}
  function identifyFieldAlias(name,result){
    var currentLayer=urlParts(state.url).slice(-1)[0];
    if(String(result.layerId)!==currentLayer || !Array.isArray(state.data?.fields))return name;
    var f=state.data.fields.find(function(field){return field.name===name;});
    return f && f.alias && f.alias!==f.name ? f.alias : name;
  }
  function paintIdentifiedFeature(){
    var context=state.identifyContext, panel=inspectorEl();
    if(!context || !panel || context.map!==state.map || !context.results.length)return;
    var item=context.results[context.index], count=context.results.length;
    var layerName=item.layerName || 'Map feature';
    var title=layerName;
    var subtitle='Layer '+item.layerId + ' · '+(context.index+1)+' of '+count+' feature'+(count===1?'':'s');
    inspectorHeader(title,subtitle);
    var control=el('div','identify-actions');
    if(count>1){
      var prev=btn('← Previous','identify-switch',function(){
        context.index=(context.index-1+count)%count; paintIdentifiedFeature(); loadFullFeature(context,context.results[context.index]);
      });
      var next=btn('Next →','identify-switch',function(){
        context.index=(context.index+1)%count; paintIdentifiedFeature(); loadFullFeature(context,context.results[context.index]);
      });
      append(control,prev,el('span','identify-position',(context.index+1)+' / '+count),next);
    }
    if(item.value!==undefined&&item.value!==null&&String(item.value).trim()!==''){
      control.appendChild(el('div','identify-value',String(item.value)));
    }
    if(control.childNodes.length)panel.appendChild(control);
    var attrs=identifyAttributesFor(item);
    var keys=Object.keys(attrs);
    var body=el('div','identify-body');
    body.tabIndex=0;
    body.setAttribute('aria-label','Scrollable feature attributes');
    body.appendChild(el('div','identify-count',keys.length+' attribute'+(keys.length===1?'':'s')+
      (item.fullAttributes?' · Full record':' · ArcGIS identify response')));
    if(!keys.length){
      body.appendChild(el('p','identify-message','The service did not return any public attributes for this feature.'));
    }else{
      var list=el('dl','identify-list');
      keys.forEach(function(key){
        var row=el('div','identify-row');
        var label=identifyFieldAlias(key,item);
        var term=el('dt','',label);
        if(label!==key)term.title=key;
        var val=el('dd','',identifyValue(attrs[key]));
        append(row,term,val);
        list.appendChild(row);
      });
      body.appendChild(list);
    }
    panel.appendChild(body);
    var footer=el('div','identify-footer');
    footer.appendChild(el('span','identify-source','Source: ArcGIS REST'));
    var copy=btn('Copy JSON','identify-copy',async function(){
      try{
        await navigator.clipboard.writeText(JSON.stringify(attrs,null,2));
        copy.textContent='Copied';
        setTimeout(function(){if(copy.isConnected)copy.textContent='Copy JSON';},1600);
      }catch(e){copy.textContent='Copy unavailable';}
    });
    footer.appendChild(copy);
    panel.appendChild(footer);
  }
  function findObjectId(item) {
    var attrs=item.attributes||{}, keys=Object.keys(attrs);
    var oidField;
    var selected=urlParts(state.url).slice(-1)[0];
    if(String(item.layerId)===selected && state.data){
      oidField=state.data.objectIdField || state.data.objectIdFieldName;
      if(!oidField && Array.isArray(state.data.fields)){
        var oid=state.data.fields.find(function(f){return f.type==='esriFieldTypeOID';});
        if(oid)oidField=oid.name;
      }
    }
    if(oidField && Object.prototype.hasOwnProperty.call(attrs,oidField))return attrs[oidField];
    var key=keys.find(function(k){return /^objectid(?:_\d+)?$|^fid$/i.test(k);});
    return key ? attrs[key] : null;
  }
  // When the layer has an object ID, try /query?outFields=* to retrieve
  // all accessible columns. Identify attributes stay visible if /query is
  // unavailable, or if the layer is not queryable.
  async function loadFullFeature(context,item){
    if(!item || item.fullAttributes || item.fullAttempted)return;
    var oid=findObjectId(item), id=Number(item.layerId);
    if(oid===null || oid===undefined || oid==='' || !Number.isInteger(id) || id<0)return;
    item.fullAttempted=true;
    try{
      var payload=await fetchData(buildUrl(mapRoot()+'/'+id+'/query',{
        objectIds:String(oid),outFields:'*',returnGeometry:'false',f:'json'
      }));
      if(state.identifyContext!==context || context.map!==state.map)return;
      if(payload.features && payload.features[0] && payload.features[0].attributes){
        item.fullAttributes=payload.features[0].attributes;
        if(context.results[context.index]===item)paintIdentifiedFeature();
      }
    }catch(e){ /* Keep the attributes already returned by identify. */ }
  }
  async function identifyAt(e){
    if(!state.map || state.spatialDrawing)return;
    var map=state.map,seq=state.identifySeq=(state.identifySeq||0)+1;
    state.identifyContext=null;
    inspectorMessage('Finding features','ArcGIS map identify','Looking for features at the selected location…',true);
    var b=map.getBounds(),sw=L.CRS.EPSG3857.project(b.getSouthWest()),
      ne=L.CRS.EPSG3857.project(b.getNorthEast()),
      pt=L.CRS.EPSG3857.project(e.latlng),size=map.getSize(),
      tail=urlParts(state.url).slice(-1)[0];
    var args={
      geometry:JSON.stringify({x:pt.x,y:pt.y,spatialReference:{wkid:3857}}),
      geometryType:'esriGeometryPoint',
      sr:3857,
      layers:/^\d+$/.test(tail)?'all:'+tail:'visible',
      tolerance:window.matchMedia && window.matchMedia('(pointer: coarse)').matches?12:8,
      mapExtent:[sw.x,sw.y,ne.x,ne.y].join(','),
      imageDisplay:Math.round(size.x)+','+Math.round(size.y)+',96',
      returnGeometry:'false',
      returnFieldName:'true',
      returnUnformattedValues:'true',
      f:'json'
    };
    try{
      var results=[];
      if(/\/FeatureServer\/\d+$/i.test(new URL(state.url).pathname)){
        var tolerance=window.matchMedia&&window.matchMedia('(pointer: coarse)').matches?13:8;
        var a=map.containerPointToLatLng([e.containerPoint.x-tolerance,e.containerPoint.y+tolerance]),
          z=map.containerPointToLatLng([e.containerPoint.x+tolerance,e.containerPoint.y-tolerance]);
        var geometry=JSON.stringify({xmin:Math.min(a.lng,z.lng),ymin:Math.min(a.lat,z.lat),
          xmax:Math.max(a.lng,z.lng),ymax:Math.max(a.lat,z.lat),spatialReference:{wkid:4326}});
        var match=await postArcGIS(state.url+'/query',{where:'1=1',geometry:geometry,
          geometryType:'esriGeometryEnvelope',spatialRel:'esriSpatialRelIntersects',
          outFields:'*',returnGeometry:'false',resultRecordCount:8});
        var layerId=Number(tail);
        results=(match.features||[]).map(function(feature){
          var properties=feature.attributes||{};
          return {attributes:properties,layerId:layerId,layerName:titleFor(state.data,state.url),
            value:properties[state.data.displayField]||properties[state.data.objectIdField]||properties.OBJECTID||''};
        });
      }else{
        var data=await fetchData(buildUrl(mapRoot()+'/identify',args));
        results=Array.isArray(data.results)?data.results:[];
      }
      if(seq!==state.identifySeq||map!==state.map)return;
      if(!results.length){
        inspectorMessage('No feature found','At this map location',
          'Try tapping directly on a colored line or area, or zoom in for a more precise selection.',false);
        return;
      }
      var context={map:map,results:results,index:0};
      state.identifyContext=context;
      paintIdentifiedFeature();
      loadFullFeature(context,results[0]);
    }catch(err){
      if(seq!==state.identifySeq||map!==state.map)return;
      inspectorMessage('Unable to inspect feature','ArcGIS identify request failed',
        err.message || 'The source server did not provide feature details for this location.',false);
    }
  }
  function renderMap(host) {
    var c=card('Live map preview',/\/FeatureServer\/\d+$/i.test(new URL(state.url).pathname)
      ? 'Basemap: Esri World Street Map · queried features: ArcGIS FeatureServer'
      : 'Basemap: Esri World Street Map · service image: ArcGIS export endpoint');
    var frame=el('div','map-frame');
    var pane=el('div','map-shell');pane.id='mapPreview';
    var inspector=el('aside','identify-panel');
    inspector.id='featureInspector';inspector.hidden=true;
    frame.appendChild(pane);frame.appendChild(inspector);
    c.card.appendChild(frame);
    var authWarning=el('p','map-auth-warning','');authWarning.id='mapAuthWarning';c.card.appendChild(authWarning);
    c.card.appendChild(el('p','map-info',
      'Tap or click a feature to view its attributes. Scroll inside the detail panel to see long records. Pan or zoom to refresh this map.'));
    host.appendChild(c.card);
    if(!window.L){
      clear(pane).appendChild(el('div','empty','The map library could not load. Metadata and queries remain available.'));
      return;
    }
    cleanupMap();
    state.map=L.map(pane,{zoomControl:true,attributionControl:true}).setView([29.76,-95.37],10);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{
      maxZoom:19,attribution:'Tiles © Esri'
    }).addTo(state.map);
    zoomToExtent(state.map,state.data.fullExtent||state.data.extent||state.data.initialExtent);
    state.map.on('moveend',function(){
      clearTimeout(state.mapTimer);
      state.mapTimer=setTimeout(refreshOverlay,400);
    });
    state.map.on('click',identifyAt);
    if(window.GISEnhancements)window.GISEnhancements.onMap(state.map,c.card,frame);
    setTimeout(function(){if(state.map){state.map.invalidateSize();refreshOverlay();}},200);
  }


  function renderAdvanced(host) {
    var panel=card('Advanced operations','Fields, native REST queries, raw responses and comparisons');
    var actions=el('div','advanced-tabs');
    var mode=state.advancedMode||(Array.isArray(state.data.fields)?'fields':'json');
    [['fields','Fields'],['query','SQL query'],['json','Raw JSON'],['compare','Compare layers']].forEach(function(x){
      actions.appendChild(btn(x[1],'action-button'+(mode===x[0]?' selected':''),function(){
        state.advancedMode=x[0];renderContent();
      }));
    });
    panel.card.appendChild(actions);host.appendChild(panel.card);
    if(mode==='fields' && Array.isArray(state.data.fields))renderFields(host);
    else if(mode==='query' && queryCapable())renderQuery(host);
    else if(mode==='json')renderJson(host);
    else if(mode==='compare' && window.GISEnhancements)window.GISEnhancements.renderCompare(host);
    else host.appendChild(el('div','empty','This operation is not supported by the selected resource.'));
    if(window.GISEnhancements)window.GISEnhancements.renderConnections(host);
  }
  function renderContent() {
    var host = clear($('content'));
    if (!state.data) return;
    if (state.tab === 'overview') renderOverview(host);
    else if(state.tab==='data' && window.GISEnhancements)window.GISEnhancements.renderData(host);
    else if (state.tab === 'export') renderFullExport(host);
    else if (state.tab === 'map') renderMap(host);
    else if(state.tab==='advanced')renderAdvanced(host);
  }
  function render() { renderIntro(); renderStats(); renderCrumbs(); renderSidebar(); renderTabs(); renderContent(); }
  function loading() { cleanupMap(); $('pageTitle').textContent = 'Loading resource…'; $('pageDescription').textContent = state.url; clear($('content')).appendChild(append(el('div', 'loading-box'), el('div', 'spinner'), el('div', '', 'Requesting ArcGIS JSON…'))); status('Connecting', 'loading'); }

  async function navigate(input, options) {
    options=options||{};
    var url;
    try{url=normalize(input);}
    catch(e){showAlert('Invalid ArcGIS REST URL',e.message,true);return;}
    if(state.exportJob && state.exportJob.url!==url)cancelFullExport(true);
    if(url!==state.url){
      state.exportContext=null;
      state.visibleMapLayers=null;
      state.focusOids=null;
      state.focusWhere=null;
      state.focusBBox=null;
      state.spatialDrawing=false;
    }
    if(window.GISEnhancements)window.GISEnhancements.beforeNavigate(url);
    var id=++state.request;
    var previousRoot=state.root;
    state.url=url;
    state.root=rootOf(url);
    updateAuthButton();
    state.data=null;
    state.result=null;
    state.tab='overview';
    if(previousRoot!==state.root || !state.tree.root)newTree(state.root);
    hideAlert();
    $('urlInput').value=url;
    loading();
    if(!options.noHistory)history.pushState({url:url},'','#'+encodeURIComponent(url));
    try{
      var data=await fetchData(jsonUrl(url));
      if(id!==state.request)return;
      state.data=data;
      state.children=childrenFor(data,url);
      if(window.GISEnhancements)window.GISEnhancements.afterNavigate(url,data);
      // Record successful visits by server root, not by individual layer URL.
      if(!options.skipServerHistory && window.GISServerHistory)window.GISServerHistory.noteVisit(url);
      status('Connected','ok');
      // Display selected resource immediately. Parent branches load in parallel.
      renderIntro();renderStats();renderCrumbs();renderTabs();renderContent();
      await revealTreePath(url,data,id);
      if(id!==state.request)return;
      renderSidebar();
      if(state.tree.query)requestTreeSearch();
      try{localStorage.setItem('gis-explorer-last-url',url);}catch(e){}
    }catch(e){
      if(id!==state.request)return;
      state.data=null;state.children=[];
      status('API unavailable','error');
      $('pageTitle').textContent='Unable to load resource';
      $('pageDescription').textContent=url;
      clear($('statGrid'));clear($('tabs'));
      clear($('content')).appendChild(append(el('div','card'),
        el('h3','','Request unsuccessful'),el('p','section-note',e.message),
        btn('Try again','primary-button',function(){navigate(url,{noHistory:true});})));
      renderCrumbs();renderSidebar();
      showAlert('Connection problem',e.message+
        ' This explorer reads JSON only when the ArcGIS server permits browser access.',true,jsonUrl(url));
    }
  }

  async function copyText(str) { try { await navigator.clipboard.writeText(str); showAlert('Copied to clipboard', 'Text copied successfully.', false); } catch (e) { showAlert('Copy not available', 'Your browser blocked clipboard access. Select and copy the text manually.', true); } }

  // Sidebar width is presentation-only. Persist it locally; auth tokens are
  // never stored alongside it. Pointer capture prevents drag interruptions.
  function setupSidebarResize(){
    var splitter=$('sidebarResizer'),workspace=document.querySelector('.workspace');
    if(!splitter || !workspace)return;
    var KEY='gis-directory-panel-width',DEFAULT=300,MIN=220,MAX=560,activeId=null;
    function maxWidth(){
      return Math.max(MIN,Math.min(MAX,window.innerWidth-360));
    }
    function applyWidth(value,persist){
      var width=Math.max(MIN,Math.min(maxWidth(),Math.round(Number(value)||DEFAULT)));
      workspace.style.setProperty('--gis-sidebar-width',width+'px');
      splitter.setAttribute('aria-valuenow',String(width));
      splitter.setAttribute('aria-valuemax',String(maxWidth()));
      splitter.setAttribute('aria-valuetext',width+' pixels');
      if(persist){
        try{localStorage.setItem(KEY,String(width));}catch(e){}
      }
    }
    function savedWidth(){
      try{
        var v=Number(localStorage.getItem(KEY));
        return Number.isFinite(v)&&v>=MIN&&v<=MAX?v:DEFAULT;
      }catch(e){return DEFAULT;}
    }
    function stop(e){
      if(activeId===null || (e&&e.pointerId!==undefined&&e.pointerId!==activeId))return;
      activeId=null;document.body.classList.remove('gis-resizing');
      splitter.classList.remove('dragging');
      try{splitter.releasePointerCapture(e.pointerId);}catch(err){}
    }
    splitter.addEventListener('pointerdown',function(e){
      if(e.pointerType==='mouse'&&e.button!==0)return;
      if(window.matchMedia('(max-width:700px)').matches)return;
      activeId=e.pointerId;
      splitter.setPointerCapture(e.pointerId);
      splitter.classList.add('dragging');
      document.body.classList.add('gis-resizing');
      e.preventDefault();
    });
    splitter.addEventListener('pointermove',function(e){
      if(activeId!==e.pointerId)return;
      applyWidth(e.clientX-workspace.getBoundingClientRect().left,true);
    });
    splitter.addEventListener('pointerup',stop);
    splitter.addEventListener('pointercancel',stop);
    splitter.addEventListener('lostpointercapture',function(){
      activeId=null;document.body.classList.remove('gis-resizing');
      splitter.classList.remove('dragging');
    });
    splitter.addEventListener('dblclick',function(){applyWidth(DEFAULT,true);});
    splitter.addEventListener('keydown',function(e){
      var current=Number(splitter.getAttribute('aria-valuenow'))||DEFAULT;
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
        e.preventDefault();applyWidth(current+(e.key==='ArrowRight'?16:-16),true);
      }else if(e.key==='Home'){
        e.preventDefault();applyWidth(MIN,true);
      }else if(e.key==='End'){
        e.preventDefault();applyWidth(maxWidth(),true);
      }else if(e.key==='Escape'){
        e.preventDefault();applyWidth(DEFAULT,true);
      }
    });
    window.addEventListener('resize',function(){
      applyWidth(Number(splitter.getAttribute('aria-valuenow'))||DEFAULT,false);
    });
    applyWidth(savedWidth(),false);
  }



  // Compact directory controls; keep mobile navigation vertical and collapsible.
  function setupSidebarToolbar(){
    var optionsButton=$('gisSearchOptionsBtn'),optionsPanel=$('gisSearchOptionsPanel');
    var favoritesButton=$('gisFavoritesBtn'),favoritesPanel=$('gisFavoritePanel');
    var collapseButton=$('mobileTreeToggle'),sidebar=document.querySelector('.sidebar');
    function closeOptions(){
      optionsPanel.hidden=true;
      optionsButton.setAttribute('aria-expanded','false');
    }
    optionsButton.addEventListener('click',function(){
      var open=optionsPanel.hidden;
      if(open){
        favoritesPanel.hidden=true;
        favoritesButton.setAttribute('aria-expanded','false');
      }
      optionsPanel.hidden=!open;
      optionsButton.setAttribute('aria-expanded',String(open));
    });
    document.addEventListener('pointerdown',function(e){
      if(!optionsPanel.hidden && !optionsPanel.contains(e.target) && !optionsButton.contains(e.target))
        closeOptions();
    });
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape' && !optionsPanel.hidden){closeOptions();optionsButton.focus();}
    });
    collapseButton.addEventListener('click',function(){
      var collapsed=sidebar.classList.toggle('is-tree-collapsed');
      collapseButton.setAttribute('aria-expanded',String(!collapsed));
      collapseButton.setAttribute('aria-label',collapsed?'Expand directory tree':'Collapse directory tree');
      collapseButton.title=collapsed?'Expand directory tree':'Collapse directory tree';
      // The chevron rotates through CSS; keep its SVG and accessible labels intact.
    });
  }

  // Safe public interface for the small interaction module. Do not expose tokens.
  async function postArcGIS(url,params,signal){
    var u=new URL(url),base=rootOf(state.url||EXAMPLE);
    if(u.protocol!=='https:' || !rootOf(u.href) ||
      new URL(rootOf(u.href)).origin!==new URL(base).origin)
      throw new Error('Use a valid HTTPS ArcGIS REST endpoint on the connected server.');
    var body=new URLSearchParams();
    Object.keys(params||{}).forEach(function(k){if(params[k]!==undefined && params[k]!==null)body.set(k,String(params[k]));});
    body.set('f','json');
    var token=scopedToken(u.href);if(token)body.set('token',token);
    var response=await fetch(u.href,{method:'POST',body:body,signal:signal,
      mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store'});
    if(!response.ok)throw new Error('ArcGIS HTTP '+response.status);
    var data=await response.json();
    if(data.error)throw new Error('ArcGIS '+data.error.code+': '+data.error.message);
    return data;
  }
  window.GISCore={
    state:state,post:postArcGIS,read:fetchData,buildUrl:buildUrl,jsonUrl:jsonUrl,
    navigate:navigate,setTab:setTab,renderContent:renderContent,
    element:el,button:btn,titleFor:titleFor,resourceType:resourceType,scopedToken:scopedToken,
    createCard:card,showAlert:showAlert,formatNum:formatNum,mapRoot:mapRoot,
    refreshOverlay:refreshOverlay,table:table,esriToGeoGeometry:esriToGeoGeometry
  };

  setupSidebarResize();
  attachAuthUI();
  setupSidebarToolbar();
  if(window.GISEnhancements)window.GISEnhancements.setupExtras();
  if(window.GISServerHistory)window.GISServerHistory.setup({
    normalize:normalize,rootOf:rootOf,navigate:navigate,
    getCurrent:function(){return state.url||$('urlInput').value;}
  });
  // Handle the full-page mobile OAuth callback without retaining a code in the URL.
  (function(){
    var q=new URLSearchParams(location.search),code=q.get('arcgis_code'),nonce=q.get('arcgis_state');
    if(code || nonce){
      history.replaceState(null,'',location.pathname+location.hash);
      openAuth();
      if(code && nonce)completeOAuth(code,nonce);
      else authMessage('ArcGIS returned an incomplete sign-in response.',true);
    }
  })();
  $('urlForm').addEventListener('submit', function (e) { e.preventDefault(); navigate($('urlInput').value); });
  $('filterInput').addEventListener('input', function(e) {
    state.tree.query=e.target.value || '';
    state.tree.nodes.forEach(function(n){n.collapsedSearch=false;});
    $('navItems').scrollTop=0;
    $('navItems').scrollLeft=0;
    requestTreeSearch();
  });
  $('homeButton').addEventListener('click', function () { navigate(state.root); });
  $('upButton').addEventListener('click', function () { var p = parentUrl(state.url); if (p) navigate(p); });
  $('copyUrl').addEventListener('click', function () { copyText(state.url); });
  $('exampleButton').addEventListener('click', function () { navigate(EXAMPLE); });
  window.addEventListener('popstate', function () { var url = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : EXAMPLE; navigate(url, {noHistory:true}); });
  var initial = EXAMPLE;
  if (location.hash.length > 1) { try { initial = decodeURIComponent(location.hash.slice(1)); } catch (e) {} }
  $('urlInput').value = initial;
  // The automatic demo on an empty URL is not a user-visited server.
  navigate(initial, {noHistory: true, skipServerHistory: location.hash.length <= 1});
})();
