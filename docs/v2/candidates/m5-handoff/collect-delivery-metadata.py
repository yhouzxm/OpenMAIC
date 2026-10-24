#!/usr/bin/env python3
"""Fixed metadata-only collection. No auth, DSN, SQL, directory scan, HBA/key/config read."""
import hashlib,json,os,pwd,shutil,stat,subprocess,sys
from datetime import datetime,timezone
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sha=lambda b:hashlib.sha256(b).hexdigest()
invraw=(HERE/'inventory.json').read_bytes();inv=json.loads(invraw)
for name,digest in inv['filesSha256'].items():assert sha((HERE/name).read_bytes())==digest,name
for name,digest in inv['sourceBindingsSha256'].items():assert sha((ROOT/name).read_bytes())==digest,name
if len(sys.argv)!=3 or sys.argv[1]!='--output':raise SystemExit('Use --output <workspace evidence path>')
out=Path(sys.argv[2]).absolute();assert out.parent==ROOT/'docs/v2/evidence' and not out.exists(),'New workspace evidence leaf required'
def directory_metadata(path):
 try:
  p=Path(path);s=p.lstat()
  return {'path':path,'exists':True,'canonical':str(p.resolve())==path,'directory':stat.S_ISDIR(s.st_mode),'mode':oct(stat.S_IMODE(s.st_mode)),'owner':pwd.getpwuid(s.st_uid).pw_name,'uid':s.st_uid,'gid':s.st_gid}
 except (OSError,KeyError) as e:return {'path':path,'status':'UNAVAILABLE','errorClass':type(e).__name__}
node=shutil.which('node');pnpm=shutil.which('pnpm')
env={'PATH':':'.join([str(Path(node).parent) if node else '/usr/bin',str(Path(pnpm).parent) if pnpm else '/usr/bin','/usr/bin','/bin']),'LANG':'C','LC_ALL':'C'}
def read_command(args):
 try:
  r=subprocess.run(args,cwd=ROOT,env=env,capture_output=True,text=True,timeout=5)
  return {'returnCode':r.returncode,'text':r.stdout.strip() if r.returncode==0 else None}
 except (OSError,subprocess.TimeoutExpired) as e:return {'status':'UNAVAILABLE','errorClass':type(e).__name__}
runtime={'node':read_command([node,'--version']) if node else {'status':'UNAVAILABLE'},'pnpm':read_command([pnpm,'--version']) if pnpm else {'status':'UNAVAILABLE'},'pgTool':read_command(['/usr/lib/postgresql/16/bin/pg_controldata','--version'])}
control=read_command(['/usr/lib/postgresql/16/bin/pg_controldata','-D','/home/zxm/.local/share/zhiban-m1/pgdata'])
allowed={'pg_control version number','Catalog version number','Database system identifier','Database cluster state','pg_control last modified','Database block size','WAL block size','Bytes per WAL segment'}
control_meta={'status':'UNAVAILABLE'}
if control.get('returnCode')==0:
 control_meta={'status':'OBSERVED_FILE_METADATA','fields':{k.strip():v.strip() for line in control['text'].splitlines() if ':' in line for k,v in [line.split(':',1)] if k.strip() in allowed},'source':'fixed pg_controldata reads pgdata/global/pg_control only','isSqlObservation':False,'authorityAccepted':False}
else:control_meta.update({k:v for k,v in control.items() if k!='text'})
ports=read_command(['/usr/bin/ss','-H','-ltn','( sport = :55432 or sport = :55433 or sport = :3443 or sport = :56495 or sport = :56496 )'])
listeners=[]
if ports.get('returnCode')==0:
 for line in ports['text'].splitlines():
  parts=line.split()
  if len(parts)>=5:listeners.append({'state':parts[0],'localAddress':parts[3],'peerAddress':parts[4]})
head=read_command(['/usr/bin/git','rev-parse','HEAD']);branch=read_command(['/usr/bin/git','branch','--show-current'])
record={'formatVersion':1,'status':'METADATA_ONLY_COLLECTED','observedAt':datetime.now(timezone.utc).isoformat(),'evidenceOrigin':'LOCAL','githubActions':False,'candidateInventorySha256':sha(invraw),'candidateMigrationSha256':inv['migration']['aggregateSha256'],'branch':branch.get('text'),'head':head.get('text'),'runtime':runtime,'targetDirectories':[directory_metadata(p) for p in ['/home/zxm/.local/share/zhiban-m1/pgdata','/home/zxm/.local/share/zhiban-m1/socket']],'pgControlMetadata':control_meta,'listenerMetadata':listeners,'notCollected':['Business/Native OIDs and exact live SQL/profile/ACL/ledger/CLOSED/claims facts','credentials, pgpass, HMAC, signing keys or ordinary configuration','HBA bytes/rules or transport/shadow authority','TLS/CA receipt or OS/browser trust acceptance','maintenance gate, fence/pointer or activation receipt contents'],'existingDatabaseConnections':False,'credentialsRead':False,'hbaRead':False,'realAuthorityIssued':False,'realGateChanged':False,'runtimeAccepted':False,'productionSignoff':False}
assert sha((HERE/'inventory.json').read_bytes())==record['candidateInventorySha256'],'Source changed during collection'
with out.open('x') as f:json.dump(record,f,indent=2);f.write('\n')
print(json.dumps({'status':record['status'],'output':str(out),'pgControlStatus':control_meta['status'],'listenerCount':len(listeners),'credentialsRead':False,'existingDatabaseConnections':False}))
