/* LOCAL fault injection only; synthetic PG_VERSION fixture, never starts PostgreSQL. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const portable=require('../../../../../scripts/zhiban-portable.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v),{mode:0o600});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zhiban-import-cut-'));fs.chmodSync(root,0o700);
const bundle=path.join(root,'bundle'),snapshot=path.join(bundle,'snapshot'),state=path.join(root,'state');
const mkdir=p=>fs.mkdirSync(p,{recursive:true,mode:0o700});
mkdir(path.join(snapshot,'root/data'));mkdir(path.join(bundle,'tls'));
fs.writeFileSync(path.join(snapshot,'root/data/PG_VERSION'),'16\n',{mode:0o600});
write(path.join(snapshot,'manifest.json'),{kind:'LOCAL_PG16_PERSISTENT_SNAPSHOT_V1',evidenceOrigin:'LOCAL',githubActions:false,originalRoot:'/tmp/zhiban-trial-content-PortableRollbackFixture',files:{'data/PG_VERSION':sha('16\n')}});
fs.writeFileSync(path.join(bundle,'tls/test-fixture'),'not a credential',{mode:0o600});
const host={platform:process.platform,arch:process.arch,endian:os.endianness(),pg:cp.execFileSync('/usr/lib/postgresql/16/bin/postgres',['--version'],{encoding:'utf8'}).trim(),nodeMajor:22,pnpm:'10.28.0'};
write(path.join(bundle,'MANIFEST.json'),{kind:'ZHIBAN_PRIVATE_RESTORE_V1',evidenceOrigin:'LOCAL',githubActions:false,host,originalRoot:'/tmp/zhiban-trial-content-PortableRollbackFixture',origin:'https://127.0.0.1:3461',snapshotManifestSha256:sha(fs.readFileSync(path.join(snapshot,'manifest.json'))),files:portable.tree(bundle,'',true)});
const originalCopy=fs.cpSync;
try{
 fs.cpSync=(source,target,options)=>{if(path.basename(target)==='tls')throw Error('INJECTED_TLS_COPY_FAILURE');return originalCopy(source,target,options)};
 assert.throws(()=>portable.importPrivate(bundle,state,sha(fs.readFileSync(path.join(bundle,'MANIFEST.json')))),/INJECTED_TLS_COPY_FAILURE/);
 assert.equal(fs.existsSync(state),false);assert.ok(fs.existsSync(path.join(snapshot,'manifest.json')));
 fs.writeFileSync(path.join(__dirname,'partial-import.json'),JSON.stringify({evidenceOrigin:'LOCAL',githubActions:false,status:'PASS',at:new Date().toISOString(),check:'Injected TLS delivery failure after snapshot copy removes only newly created state; no latest or INSTANCE receipt; original bundle preserved; no PG started'},null,2)+'\n');
 console.log('PASS partial private import rolls back only its newly created state');
}finally{fs.cpSync=originalCopy;fs.rmSync(root,{recursive:true,force:true})}
