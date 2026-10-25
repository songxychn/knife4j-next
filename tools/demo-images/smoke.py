import json, re, sys, urllib.request, urllib.parse

def check(base, version):
    def request(path, data=None, headers=None):
        req=urllib.request.Request(base+path, data=data, headers=headers or {})
        with urllib.request.urlopen(req, timeout=20) as r:
            assert r.status==200, (path,r.status)
            return r.read(), r.headers
    raw,_=request('/doc.html'); html=raw.decode()
    assets=set(re.findall(r'''(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']''', html))
    assert assets, 'No UI assets'
    for asset in assets:
        u=urllib.parse.urljoin(base+'/doc.html', asset)
        assert urllib.parse.urlsplit(u).netloc==urllib.parse.urlsplit(base).netloc, u
        body,h=request(u[len(base):]); assert body and 'text/html' not in h.get('Content-Type',''), u
    specpath='/v2/api-docs' if version==2 else '/v3/api-docs'
    spec=json.loads(request(specpath)[0]); assert len(spec['paths'])>=5
    assert spec.get('swagger')=='2.0' if version==2 else spec.get('openapi','').startswith('3.')
    configpath='/swagger-resources' if version==2 else '/v3/api-docs/swagger-config'
    config=json.loads(request(configpath)[0]); assert config
    for obj in (config if isinstance(config,list) else config.get('urls',[])):
        url=obj.get('url');
        if url and url.startswith('/'): assert json.loads(request(url)[0])['paths']
    users=json.loads(request('/api/user/list')[0]); assert len(users)>=2
    user=json.loads(request('/api/user',json.dumps({'name':'deploy-smoke','email':'deploy-smoke@example.com'}).encode(),{'Content-Type':'application/json'})[0])
    assert user['name']=='deploy-smoke'
    boundary='knife4j-demo-image-contract'
    def part(name,body,filename=None,ctype='text/plain'):
        disp='Content-Disposition: form-data; name="'+name+'"'+('' if filename is None else '; filename="'+filename+'"')
        return ('--'+boundary+'\r\n'+disp+'\r\nContent-Type: '+ctype+'\r\n\r\n').encode()+body+b'\r\n'
    meta=part('meta',json.dumps({'description':'deploy-smoke','category':'test','isPublic':True}).encode(),ctype='application/json')
    for endpoint,name,count in [('/upload/file-with-meta','file',1),('/upload/files-with-meta','files',2)]:
        payload=b''.join(part(name,b'smoke\n','smoke'+str(i)+'.txt') for i in range(count))+meta+('--'+boundary+'--\r\n').encode()
        result=json.loads(request(endpoint,payload,{'Content-Type':'multipart/form-data; boundary='+boundary})[0])
        assert result['description']=='deploy-smoke', result
        if count==1: assert result['size']==6 and result['filename']=='smoke0.txt',result
        else: assert result['count']==2,result
    for method in ['PUT', 'DELETE']:
        data=json.dumps({'name':'image-smoke','email':'image@example.test'}).encode() if method=='PUT' else None
        req=urllib.request.Request(base+'/api/user/1',data=data,method=method,headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=20) as response:
            assert response.status==200 and json.load(response)['id']==1
    if version==3:
        body,headers=request('/api/stream/sse?count=3&intervalMillis=200')
        assert headers.get('Content-Type','').startswith('text/event-stream') and body.count(b'event:tick')==3
    print(json.dumps({'base':base,'ui_assets':len(assets),'spec_paths':len(spec['paths']),'discovery':True,'json_roundtrip':True,'multipart_single_and_multi':True}),flush=True)
if __name__=='__main__': check(sys.argv[1],int(sys.argv[2]))
