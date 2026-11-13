"""Create a source-only release candidate from an explicit allowlist (stdlib only)."""
from pathlib import Path
import datetime, hashlib, json, os, re, zipfile

root=Path(__file__).resolve().parents[1]
root_files={'package.json','package-lock.json','tsconfig.json','.gitignore','.gitattributes','.vscodeignore','.editorconfig','README.md','LICENSE','REUSE.md','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','Start Little Forge.cmd'}
source_dirs={'src','tests','scripts','resources','docs','trueforge','evaluation','submission','.vscode','.github'}
excluded={'node_modules','dist','output','tmp','test-results','.trueforge','.git','workspaces','__pycache__','.venv'}
private_name=re.compile(r'^(?:\.env.*|credentials?(?:[._-].*)?|secrets?(?:[._-].*)?)$|\.(?:sqlite|db)(?:-|$)|\.(?:pem|key|p12|pfx)$',re.I)
files=[]
for name in sorted(root_files):
    p=root/name
    if p.is_file(): files.append(p)
for top in sorted(source_dirs):
    start=root/top
    if not start.is_dir(): continue
    for current, dirs, names in os.walk(start,followlinks=False):
        dirs[:]=sorted(d for d in dirs if d not in excluded and not (Path(current)/d).is_symlink() and not getattr(Path(current)/d,'is_junction',lambda:False)())
        for name in sorted(names):
            p=Path(current)/name
            if private_name.search(name) or name.endswith(('.vsix','.zip','.pyc')): continue
            if p.is_symlink() or getattr(p,'is_junction',lambda:False)() or p.stat().st_nlink!=1: raise RuntimeError('Linked source entry cannot enter a release: '+str(p.relative_to(root)))
            files.append(p)
for p in files:
    p.resolve().relative_to(root.resolve())
    if p.stat().st_size>4*1024*1024: raise RuntimeError('Unexpected oversized release source: '+str(p.relative_to(root)))
out=root/'output/release'
out.mkdir(parents=True,exist_ok=True)
target=out/'little-forge-source-0.1.0.zip'
entries=[]
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(files,key=lambda p:p.relative_to(root).as_posix()):
        relative=p.relative_to(root).as_posix()
        data=p.read_bytes()
        z.writestr('little-forge/'+relative,data)
        entries.append({'path':relative,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
digest=hashlib.sha256(target.read_bytes()).hexdigest()
manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'Source-only release candidate; publication and live acceptance are separate gates.','artifact':target.name,'sha256':digest,'files':entries,'excluded':['saved providers and credentials','test receipts/profiles','Flask evaluation clones','node_modules','bundles/binaries','generated PDF/ZIP output']}
(out/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
(out/'SHA256SUMS.txt').write_text(f'{digest}  {target.name}\n',encoding='ascii')
with zipfile.ZipFile(target) as z:
    assert all(not any(part in excluded for part in Path(name).parts[1:]) for name in z.namelist())
    assert all(not private_name.search(Path(name).name) for name in z.namelist())
    assert 'little-forge/src/extension.ts' in z.namelist()
    assert 'little-forge/package-lock.json' in z.namelist()
    assert 'little-forge/LICENSE' in z.namelist()
print(json.dumps({'artifact':str(target),'files':len(entries),'bytes':target.stat().st_size,'sha256':digest}))
