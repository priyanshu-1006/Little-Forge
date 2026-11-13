import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = JSON.parse(await readFile(path.join(root,'evaluation/tasks.json'),'utf8')).repository.commit;
const pythonCode = `import sys,json,flask,importlib.metadata as m
print(json.dumps({'python':sys.version,'interpreter':sys.executable,'flask':flask.__file__,'packages':{d.metadata['Name']:d.version for d in m.distributions()}}))`;
const environments = [];
for (const task of ['a','b','c']) {
  const workspace = path.join(root,'evaluation','workspaces',`flask-task-${task}`);
  const commit = execFileSync('git',['-C',workspace,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
  const status = execFileSync('git',['-C',workspace,'status','--porcelain=v1'],{encoding:'utf8',windowsHide:true}).trim();
  if (commit !== expected || status) throw new Error(`Task ${task.toUpperCase()} must have a clean pinned checkout. No reset will be performed.`);
  const python = path.join(workspace,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const environment = JSON.parse(execFileSync(python,['-c',pythonCode],{cwd:workspace,encoding:'utf8',windowsHide:true}));
  if (!path.resolve(environment.flask).startsWith(path.join(workspace,'src'))) throw new Error('Flask imports from an unrelated installation.');
  environments.push({task:task.toUpperCase(),workspace,commit,gitStatus:status,environment});
}
const receipt = { checkedAt:new Date().toISOString(), uv:execFileSync('uv',['--version'],{encoding:'utf8',windowsHide:true}).trim(), setup:'uv sync --locked --no-default-groups --group tests --python C:\\Python313\\python.exe', environments, baselines:[], liveModelTasksRun:false };
if (process.argv.includes('--run-baselines')) {
  for (const [task,file] of [['A','tests/test_helpers.py'],['B','tests/test_cli.py']]) {
    const env = environments.find(e=>e.task===task);
    const result = spawnSync(env.environment.interpreter,['-m','pytest',file,'-q'],{cwd:env.workspace,encoding:'utf8',windowsHide:true,timeout:60_000});
    const output = `${result.stdout||''}${result.stderr||''}`;
    const passed = /(?:^|\n)(\d+) passed\b/.exec(output)?.[1];
    receipt.baselines.push({task,command:`python -m pytest ${file} -q`,exitCode:result.status,passed:passed?Number(passed):undefined,output});
    console.log(`${task}: ${output.trim()}`);
    if (result.status!==0) throw new Error(`Task ${task} baseline failed; do not interpret this as an agent failure.`);
  }
}
await mkdir(path.join(root,'test-results'),{recursive:true});
await writeFile(path.join(root,'test-results/live-environment.json'),JSON.stringify(receipt,null,2));
console.log('All three environment identities and editable imports verified. No source changes made.');
