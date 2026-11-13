// Native Task C setup only. No provider credentials are read or changed.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const workspace = path.join(project,'evaluation/workspaces/flask-native-c');
const evidence = path.join(project,'test-results','native-task-c-20261031');
const base = 'http://127.0.0.1:8790';
const provider = 'native-resilience-check';
const model = `${provider}/unreachable`;
await fs.mkdir(evidence,{recursive:true});
const git = args => execFileSync('git',['-C',workspace,...args],{encoding:'utf8',windowsHide:true}).trim();
if(git(['rev-parse','HEAD']) !== '22d924701a6ae2e4cd01e9a15bbaf3946094af65' || git(['status','--porcelain=v1'])) throw new Error('Task C must start at the clean pinned checkout.');
const files = execFileSync('git',['-C',workspace,'ls-files','-z'],{encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
const hashes = {};
for(const file of files) hashes[file] = createHash('sha256').update(await fs.readFile(path.join(workspace,file))).digest('hex');
const reservation=net.createServer(); reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
const address=reservation.address(); await new Promise(resolve=>reservation.close(resolve));
if(!address || typeof address === 'string') throw new Error('No test endpoint port.');
const refused=await new Promise(resolve=>{const socket=net.connect(address.port,'127.0.0.1');socket.once('error',error=>resolve(error.code==='ECONNREFUSED'));socket.once('connect',()=>{socket.destroy();resolve(false);});});
if(!refused) throw new Error('Test model endpoint is not refused.');
const response=await fetch(`${base}/api/v1/settings/model-providers`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({manifest:{type:'custom',name:provider,base_url:`http://127.0.0.1:${address.port}/v1`,models:[{name:'unreachable',model_id:'unreachable',properties:{context_length:32768,max_output_tokens:4096}}]}})});
if(response.status!==201) throw new Error(`Test provider creation returned ${response.status}; preserve existing settings and inspect before retrying.`);
const profile=path.join(project,'test-results/native-c-profile');
const settingsPath=path.join(profile,'User/settings.json');
await fs.mkdir(path.dirname(settingsPath),{recursive:true});
let settings={}; try{settings=JSON.parse(await fs.readFile(settingsPath,'utf8'));}catch(error){if(error.code!=='ENOENT') throw error;}
const previous={};
for(const key of ['littleForge.model','littleForge.baseUrl','littleForge.contextTokens','littleForge.fallbackModel']) previous[key]={present:Object.hasOwn(settings,key),value:settings[key]};
Object.assign(settings,{'littleForge.model':model,'littleForge.baseUrl':base,'littleForge.contextTokens':32768,'littleForge.fallbackModel':''});
await fs.writeFile(settingsPath,JSON.stringify(settings,null,2)+'\n');
await fs.writeFile(path.join(evidence,'before.json'),JSON.stringify({at:new Date().toISOString(),workspace,commit:git(['rev-parse','HEAD']),status:'',hashes},null,2));
await fs.writeFile(path.join(evidence,'setup.json'),JSON.stringify({at:new Date().toISOString(),provider,model,endpoint:`http://127.0.0.1:${address.port}/v1`,connectionRefusedBeforeRun:true,profile,settingsPath,previous},null,2));
console.log(JSON.stringify({workspace,profile,model,evidence,trackedFiles:files.length}));
