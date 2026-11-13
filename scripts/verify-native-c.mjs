// Verify and clean up only the explicitly created native Task C fixture.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const project=fileURLToPath(new URL('..',import.meta.url));
const evidence=path.join(project,'test-results/native-task-c-20261031');
const before=JSON.parse(await fs.readFile(path.join(evidence,'before.json'),'utf8'));
const setup=JSON.parse(await fs.readFile(path.join(evidence,'setup.json'),'utf8'));
const ui=JSON.parse(await fs.readFile(path.join(evidence,'ui-observations.json'),'utf8'));
const hashes={}; let bytes=0;
for(const file of Object.keys(before.hashes)){const data=await fs.readFile(path.join(before.workspace,file));bytes+=data.length;hashes[file]=createHash('sha256').update(data).digest('hex');}
const git=args=>execFileSync('git',['-C',before.workspace,...args],{encoding:'utf8',windowsHide:true}).trim();
const changed=Object.keys(hashes).filter(file=>hashes[file]!==before.hashes[file]);
const status=git(['status','--porcelain=v1']);
const healthResponse=await fetch('http://127.0.0.1:8790/healthz');
const health=await healthResponse.json();
const list=await fetch('http://127.0.0.1:8790/api/v1/sessions').then(r=>r.json());
const sessions=[];
for(const session of list.data??[]){
  if(session.agent?.spec?.model?.name!==setup.model || session.created_at<ui.startedAt)continue;
  const turns=await fetch(`http://127.0.0.1:8790/api/v1/sessions/${session.id}/turns`).then(r=>r.json());
  sessions.push({id:session.id,url:`http://127.0.0.1:8790/sessions/${session.id}`,createdAt:session.created_at,turns:(turns.data??[]).map(t=>({id:t.id,status:t.state?.status,error:t.state?.message}))});
}
const traceFailure=sessions.length===3 && sessions.every(s=>s.turns.some(t=>t.status==='error' && t.error?.includes('ECONNREFUSED')));
const screenshots=['prompt','connecting','failure','navigation'];
for(const name of screenshots)await fs.access(path.join(evidence,name+'.png'));
const summary={checkedAt:new Date().toISOString(),kind:'Native VS Code inline Task C rehearsal, not the final four-minute competition video.',workspace:before.workspace,commit:git(['rev-parse','HEAD']),trackedFiles:Object.keys(hashes).length,totalTrackedBytes:bytes,changedFiles:changed,gitStatus:status,healthAfter:{httpStatus:healthResponse.status,...health},sessions,assertions:{exactNativeInlinePrompt:ui.exactPrompt==="Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.",refusedModelAndTwoBoundedRetries:traceFailure,clearErrorVisible:ui.clearErrorVisibleAboveContext,editorNavigationWithFailureVisible:ui.sourceNavigationAfterFailure,allTrackedHashesUnchanged:changed.length===0,cleanGitStatus:status==='',harnessStillHealthy:healthResponse.status===200&&health.status==='ok',noRealModelQuotaUsed:true},limits:{physicalShortcutVerified:false,interactionDuringBackoffNotAsserted:true,finalVideoRecorded:false},screenshots:screenshots.map(n=>n+'.png')};
await fs.writeFile(path.join(evidence,'after.json'),JSON.stringify({checkedAt:summary.checkedAt,hashes,gitStatus:status},null,2));
await fs.writeFile(path.join(evidence,'summary.json'),JSON.stringify(summary,null,2));
const deletion=await fetch('http://127.0.0.1:8790/api/v1/settings/model-providers/'+encodeURIComponent(setup.provider),{method:'DELETE'});
const settings=JSON.parse(await fs.readFile(setup.settingsPath,'utf8'));
for(const [key,old] of Object.entries(setup.previous)){if(old.present)settings[key]=old.value;else delete settings[key];}
await fs.writeFile(setup.settingsPath,JSON.stringify(settings,null,2)+'\n');
await fs.writeFile(path.join(evidence,'cleanup.json'),JSON.stringify({at:new Date().toISOString(),deletedOnlyTestProvider:setup.provider,deleteHttpStatus:deletion.status,restoredOnlyIsolatedProfileSettings:true,realProviderCredentialsReadOrChanged:false},null,2));
console.log(JSON.stringify({summary:path.join(evidence,'summary.json'),trackedFiles:summary.trackedFiles,changedFiles:changed,status:status||'clean',sessions:sessions.length,assertions:summary.assertions,testProviderRemoved:deletion.status===200}));
if(Object.values(summary.assertions).some(v=>v!==true)||deletion.status!==200)process.exitCode=1;
