import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Render the exact extension HTML/CSS/JS, with a fixture replacing only VS Code messaging.
const source = await readFile('src/extension.ts', 'utf8');
let html = source.match(/view\.webview\.html = `([\s\S]*?)`;/)?.[1];
if (!html) throw new Error('Cannot locate the extension HTML template.');
html = html.replaceAll('${nonce}', 'ui-smoke').replaceAll('${view.webview.cspSource}', "'self'").replaceAll("${uri('ui.css')}", '/ui.css').replaceAll("${uri('ui.js')}", '/ui.js');
html = html.replace('<script nonce="ui-smoke" src=', `<script nonce="ui-smoke">window.__actions=[]; window.acquireVsCodeApi=()=>({postMessage:m=>window.__actions.push(m)});</script><script nonce="ui-smoke" src=`);
const css = `:root{--vscode-sideBar-background:#12171d;--vscode-editor-background:#1a2028;--vscode-foreground:#e4eaf0;--vscode-descriptionForeground:#9caaba;--vscode-widget-border:#303c48;--vscode-font-family:'Segoe UI',system-ui;--vscode-editor-font-family:Consolas,monospace}\n` + await readFile('dist/ui.css', 'utf8');
const js = await readFile('dist/ui.js', 'utf8');
const server = createServer((req, res) => { const type = req.url === '/ui.css' ? 'text/css' : req.url === '/ui.js' ? 'text/javascript' : 'text/html'; res.writeHead(200, { 'Content-Type': type }); res.end(req.url === '/ui.css' ? css : req.url === '/ui.js' ? js : html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const browser = await chromium.launch({ channel: process.env.FORGE_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 1100 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const assertions = [];
const base = { status:'idle', connected:false, model:'', messages:[], context:null, proposals:[], approvals:[], checkpoints:[], activity:[] };
try {
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByRole('heading', {name:'Your code. Your call.'}).waitFor();
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 420);
  assertions.push('Welcome UI renders at sidebar width without horizontal overflow.');
  await mkdir('test-results/ui', { recursive:true });
  await page.screenshot({ path:'test-results/ui/welcome.png', fullPage:true });
  await page.getByRole('button', {name:'Map this repository'}).click();
  assert.match(await page.locator('#prompt').inputValue(), /repository/);
  await page.locator('#form').evaluate(form => form.requestSubmit());
  assert.equal(await page.evaluate(() => window.__actions.filter(a=>a.type==='run').length),1);
  assertions.push('Suggestion and submit send a typed request without embedding executable source.');

  const formatted = [
    '## Forge&#x20;results',
    '',
    '**Ready** to run `pytest`. See the [Flask docs](https://flask.palletsprojects.com/).',
    '',
    '3. Review the patch',
    '   - Check the source',
    '   - Check the tests',
    '',
    '> Review before applying.',
    '',
    '| Check | Result |',
    '| --- | ---: |',
    '| CLI tests | Passed |',
    '',
    '~~~python',
    'print("<tag> &amp;")',
    '~~~',
    '',
    '<img src="/tracking" onerror="window.__unsafe = true">',
    '',
    '![Image label](/tracking) [Open command](command:workbench.action.reloadWindow)',
    '',
    '[Script link](javascript:alert%281%29)',
  ].join('\n');
  const markdownState = {
    ...base, status: 'completed', messages: [{role: 'assistant', text: formatted}],
  };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), markdownState);
  const reply = page.locator('.message.assistant .message-body');
  await reply.getByRole('heading', {name: 'Forge results', level: 2}).waitFor();
  assert.equal(await reply.locator('strong').textContent(), 'Ready');
  assert.equal(await reply.locator('code.inline-code').textContent(), 'pytest');
  assert.equal(await reply.locator('ol').getAttribute('start'), '3');
  assert.equal(await reply.locator('ol ul li').count(), 2);
  assert.equal(await reply.locator('blockquote').innerText(), 'Review before applying.');
  assert.equal(await reply.getByRole('cell', {name: 'Passed'}).evaluate(el => getComputedStyle(el).textAlign), 'right');
  assert.equal(await reply.getByRole('link', {name: 'Flask docs'}).getAttribute('href'), 'https://flask.palletsprojects.com/');
  assert.equal(await reply.locator('a').count(), 1);
  assert.equal(await reply.locator('img').count(), 0);
  assert.match(await reply.textContent(), /Image label/);
  assert.match(await reply.textContent(), /<img src="\/tracking"/);
  assert.equal(await reply.locator('pre code').textContent(), 'print("<tag> &amp;")\n');
  assert.equal(await reply.locator('pre .hljs-string').textContent(), '"<tag> &amp;"');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async text => { window.__copiedCode = text; } },
    });
  });
  await reply.getByRole('button', {name: 'Copy code'}).click();
  await reply.getByText('Copied', {exact: true}).waitFor();
  assert.equal(await page.evaluate(() => window.__copiedCode), 'print("<tag> &amp;")\n');
  await page.screenshot({path: 'test-results/ui/markdown-reply.png', fullPage: true});
  assertions.push('Assistant Markdown renders structured blocks, decodes prose entities, copies literal code and keeps active model HTML, images and command links inert.');

  const streamed = {
    ...base, status: 'running',
    messages: [{role: 'assistant', text: '## Streaming\n\n```python\n' + 'x'.repeat(360)}],
  };
  await page.setViewportSize({width: 300, height: 1100});
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), streamed);
  await reply.getByRole('heading', {name: 'Streaming'}).waitFor();
  assert.equal(await reply.locator('pre code').textContent(), 'x'.repeat(360));
  assert.equal(await reply.locator('pre').evaluate(el => el.scrollWidth > el.clientWidth), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  streamed.messages[0].text += '\n```\n\n**Done.**';
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), streamed);
  await reply.getByText('Done.', {exact: true}).waitFor();
  assert.equal(await reply.locator('pre code').textContent(), 'x'.repeat(360) + '\n');
  await page.setViewportSize({width: 420, height: 1100});
  assertions.push('An unfinished streamed code fence renders and scrolls locally, then the closing fence restores normal prose.');

  const proposal = { id:'fixture', runId:'fixture', createdAt:0, state:'pending', files:[{path:'src/example.ts',original:'a\nb\nc\n',proposed:'A\nb\nC\n',baseHash:'fixture',hunks:[{id:'h1',start:0,end:1,before:'a',after:'A',decision:'pending'},{id:'h2',start:4,end:5,before:'c',after:'C',decision:'pending'}]}] };
  const state = {...base,status:'awaiting-review',connected:true,model:'configured/provider',messages:[{role:'user',text:'Review UI fixture'},{role:'assistant',text:'<img src=x onerror="window.__unsafe=true">'}],proposals:[proposal],approvals:[{name:'apply_proposal',args:{proposalId:'fixture'},toolCallId:'call',threadId:'main'}]};
  await page.evaluate(state => window.postMessage({type:'state',state},'*'),state);
  assert.equal(await page.locator('img').count(),0);
  assert.equal(await page.evaluate(()=>Boolean(window.__unsafe)),false);
  assert.equal(await page.getByRole('button',{name:'Finish review',exact:true}).isDisabled(),true);
  assertions.push('Model HTML remains inert text; pending hunk decisions keep application disabled.');
  assert.equal(await page.locator('.hunk pre').count(), 0);
  await page.getByRole('button',{name:'Hunk 1 · Line 1'}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)),
    {type:'preview',proposalId:'fixture',path:'src/example.ts',hunkId:'h1'});
  assertions.push('The compact review opens the exact hunk in the native diff editor.');
  await page.getByRole('button',{name:'Accept',exact:true}).first().click();
  await page.getByRole('button',{name:'Reject',exact:true}).last().click();
  const actions = await page.evaluate(()=>window.__actions.filter(a=>a.type==='decide'));
  assert.deepEqual(actions.map(a=>[a.hunkId,a.decision]),[['h1','accept'],['h2','reject']]);
  proposal.files[0].hunks[0].decision='accept'; proposal.files[0].hunks[1].decision='reject';
  await page.evaluate(state => window.postMessage({type:'state',state},'*'),state);
  assert.equal(await page.getByRole('button',{name:'Apply selected hunks',exact:true}).isDisabled(),false);
  await page.screenshot({path:'test-results/ui/review-fixture.png',fullPage:true});
  assertions.push('Independent hunk actions carry exact IDs; only fully resolved review enables apply.');
  await page.locator('#stop').click();
  assert.equal(await page.evaluate(()=>window.__actions.at(-1).type),'stop');
  assertions.push('Stop remains available during harness review.');
  for (const width of [300,360,520]) { await page.setViewportSize({width,height:1100}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); }
  assertions.push('Review remains within the viewport at 300, 360 and 520px.');

  const proposalFiles = ['src/one.ts', 'src/two.ts', 'src/three.ts', 'src/four.ts'];
  const applied = {...proposal, state:'applied', files:proposalFiles.map(path => ({...proposal.files[0],path}))};
  const approval = {name:'run_command', args:{task:'pytest', args:['tests/repro.py']}, toolCallId:'cmd_1', threadId:'main'};
  const approvalState = {
    ...base,status:'awaiting-review',connected:true,model:'configured/provider',proposals:[applied],approvals:[approval],
    checkpoints:[{id:'receipt',paths:proposalFiles,state:'applied'}],
    evidence:{id:'fixture', startedAt:1,usage:{tokens:0,measured:false}, checks:[], edits:[{proposalId:applied.id,checkpointId:'receipt',paths:proposalFiles}]},
  };
  await page.evaluate(s => window.postMessage({type:'state',state:s},'*'), approvalState);
  await page.getByText('Applied 4 files',{exact:true}).waitFor();
  assert.equal(await page.locator('.review').count(), 0);
  assert.equal(await page.locator('#review-list .action-receipt').count(), 1);
  await page.getByText('View diffs',{exact:true}).click();
  await page.getByRole('button',{name:'src/three.ts'}).first().click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'preview',proposalId:'fixture',path:'src/three.ts'});
  await page.getByRole('button', {name:'Allow once'}).evaluate(button => { button.click(); button.click(); });
  assert.deepEqual(await page.evaluate(() => window.__actions.filter(a => a.toolCallId === 'cmd_1')),
    [{type:'commandDecision',toolCallId:'cmd_1',allow:true}]);
  const receipt = {id:'cmd_1',args:approval.args,status:'allowed'};
  await page.evaluate(s => window.postMessage({type:'state',state:s},'*'), {...approvalState,commandReceipts:[receipt]});
  await page.locator('.command-receipt').getByText('Allowed',{exact:true}).waitFor();
  assert.equal(await page.locator('.command-card').count(), 0);
  const actualCheck = {input:approval.args,phase:'agent',durationMs:15,changedSource:[],result:{exitCode:0,cleanupConfirmed:true,stdout:'passed'}};
  await page.evaluate(s => window.postMessage({type:'state',state:s},'*'), {
    ...approvalState, status:'completed', approvals:[], commandReceipts:[{...receipt,status:'finished',checkIndex:0}],
    evidence:{...approvalState.evidence,checks:[actualCheck]},
  });
  await page.locator('.command-receipt').getByText('Passed',{exact:true}).waitFor();
  await page.locator('.command-receipt').getByRole('button',{name:'Output'}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'showCheck',index:0});
  assertions.push('A four-file apply and an allowed command collapse to receipts. Command pass and output appear after the host confirms execution.');

  // Test Antigravity Work Trace user-toggle preservation
  const runState1 = {
    ...base,
    status: 'running',
    connected: true,
    model: 'google-gemini/gemini-3-1-flash-lite',
    messages: [
      { role: 'user', text: 'Task prompt' },
      { role: 'assistant', text: '' }
    ],
    activity: ['search workspace: flask config', 'read file: src/flask/cli.py']
  };
  await page.evaluate(state => window.postMessage({ type: 'state', state }, '*'), runState1);
  await page.locator('.work-trace').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.querySelector('.work-trace').open), true);

  // User clicks to collapse the Thinking trace
  await page.locator('.work-trace-summary').click();
  assert.equal(await page.evaluate(() => document.querySelector('.work-trace').open), false);

  // Subsequent tool action arrives (e.g. edited file / ran command)
  const runState2 = {
    ...runState1,
    activity: [...runState1.activity, 'staged file: src/flask/cli.py', 'ran command: pytest tests/test_cli.py · Exit code 0']
  };
  await page.evaluate(state => window.postMessage({ type: 'state', state }, '*'), runState2);

  // Trace MUST remain closed - never reopened automatically by incoming tool steps!
  assert.equal(await page.evaluate(() => document.querySelector('.work-trace').open), false);
  // Verify steps were updated in-place inside the closed trace
  await page.waitForFunction(() => document.querySelectorAll('.work-step-row').length === 4);
  const stepCount = await page.evaluate(() => document.querySelectorAll('.work-step-row').length);
  assert.equal(stepCount, 4);
  assertions.push('Antigravity work trace strictly preserves user collapse state during streaming tool updates.');
  await page.locator('main').evaluate(main => { main.scrollTop = main.scrollHeight; });
  const failed = {
    ...base, status:'failed', connected:true, model:'fixture/unreachable',error:'The provider rate limit was reached.',
    recovery:{id:'old',kind:'provider',title:'Provider rate limit reached',model:'fixture/unreachable'},
    messages:[{role:'user',text:'Failure visibility fixture'},{role:'assistant',text:'',attempt:{id:'old',activity:runState1.activity,error:'The provider rate limit was reached.'}}],
  };
  await page.evaluate(s => window.postMessage({type:'state',state:s},'*'), failed);
  await page.getByRole('alert').waitFor({state:'visible'});
  assert.equal(await page.locator('#error').evaluate(dock => dock.nextElementSibling.matches('footer')), true);
  assert.equal(await page.locator('#prompt').isEnabled(), true);
  assert.equal(await page.getByRole('button',{name:'Resume',exact:true}).count(), 0);
  await page.evaluate(s => window.postMessage({type:'state',state:s},'*'), {...failed,model:'other/available'});
  await page.getByRole('button',{name:'Resume',exact:true}).evaluate(button => { button.click(); button.click(); });
  assert.deepEqual(await page.evaluate(() => window.__actions.filter(a => a.type === 'recoverRun')), [{type:'recoverRun',id:'old'}]);
  const resumed = {
    ...base, status:'running',messages:[...failed.messages,{role:'assistant',text:'',attempt:{id:'new',label:'Started a new attempt'}}],
    activity:['read file: tests/test_cli.py'],
  };
  await page.evaluate(s => window.postMessage({type:'state',state:s},'*'), resumed);
  await page.getByText('Started a new attempt',{exact:true}).waitFor();
  assert.equal(await page.locator('#error').isHidden(), true);
  assert.equal(await page.locator('#transcript .message.user').count(), 1);
  assert.equal(await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#transcript .message.assistant')];
    return rows[0].textContent.includes('Attempt interrupted') && rows[1].textContent.includes('tests/test_cli.py');
  }), true);
  await page.evaluate(s => window.postMessage({type:'state',state:s},'*'), failed);
  assertions.push('A provider error sits above the composer, resumes once after a model switch, and new work follows the interruption.');

  // Test 1: Attached Quick Commands Menu (/...)
  await page.locator('#prompt').fill('/');
  await page.locator('#slash-menu').waitFor({ state: 'visible' });
  const slashItemsCount = await page.locator('#slash-items .input-popup-item').count();
  assert.ok(slashItemsCount >= 7, `Expected at least 7 slash commands, found ${slashItemsCount}`);
  // Keyboard arrow down and Enter to select /plan
  await page.locator('#prompt').press('ArrowDown');
  await page.locator('#prompt').press('Enter');
  assert.equal(await page.locator('#slash-menu').isHidden(), true);
  assert.match(await page.locator('#prompt').inputValue(), /^\/impact\s*$/); // second item was /impact after ArrowDown
  assertions.push('Attached quick commands menu opens on / and supports arrow selection.');

  // Test 2: Attached Mention Menu (@...)
  await page.locator('#prompt').fill('Check this @');
  await page.locator('#mention-menu').waitFor({ state: 'visible' });
  const mentionItemsCount = await page.locator('#mention-items .input-popup-item').count();
  assert.equal(mentionItemsCount, 3);
  // Click @folder option
  await page.locator('#mention-items button[data-kind="folder"]').click();
  assert.equal(await page.locator('#mention-menu').isHidden(), true);
  const mentionActions = await page.evaluate(() => window.__actions.filter(a => a.type === 'mention'));
  assert.equal(mentionActions.at(-1)?.kind, 'folder');
  assertions.push('Attached mention menu opens on @ and clicking @folder triggers designated mention action.');

  // Test 3: Collapsible Tools Sidebar Drawer
  await page.locator('#tools-toggle-btn').click();
  await page.locator('#tools-sidebar').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#tools-sidebar button').count(), 7);
  // Click Signals inside tools sidebar
  await page.locator('#tools-sidebar #signals-btn').click();
  await page.locator('#signals-drawer').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#tools-sidebar').isHidden(), true);
  await page.locator('#signals-close').click();
  assert.equal(await page.locator('#signals-drawer').isHidden(), true);
  assertions.push('Collapsible tools sidebar opens and seamlessly launches signals drawer.');

  // Test 4: Header Controls Responsive Layout at narrow widths and wide expansion
  for (const w of [280, 320, 360, 600, 800]) {
    await page.setViewportSize({ width: w, height: 900 });
    const headerRowWidth = await page.locator('.header-controls-row').evaluate(el => el.scrollWidth);
    const containerWidth = await page.locator('header').evaluate(el => el.clientWidth);
    assert.ok(headerRowWidth <= containerWidth + 2, `Header controls row overflowed at ${w}px: ${headerRowWidth} > ${containerWidth}`);
    assert.equal(await page.locator('#new-chat').isVisible(), true);
    assert.equal(await page.locator('#history-btn').isVisible(), true);

    // Verify Chat and + never overlap
    const historyBox = await page.locator('#history-btn').boundingBox();
    const newChatBox = await page.locator('#new-chat').boundingBox();
    assert.ok(historyBox && newChatBox, 'Chat and new chat buttons must have bounding boxes');
    assert.ok(historyBox.x + historyBox.width <= newChatBox.x + 0.5, `Chat and + must not overlap: history right (${historyBox.x + historyBox.width}) > new chat left (${newChatBox.x})`);

    // Verify Model pill does not take all available space upon expanding
    const modelBox = await page.locator('#model').boundingBox();
    assert.ok(modelBox, 'Model button must have a bounding box');
    assert.ok(modelBox.width <= 180, `Model button width (${modelBox.width}px) must not excessively balloon on expand at ${w}px`);
  }
  await page.screenshot({ path: 'test-results/ui/responsive-narrow.png', fullPage: false });
  assertions.push('Model, review, chats, and new chat controls remain non-overlapping, balanced, and responsive across narrow and expanded widths.');

  const reviewState = structuredClone(state);
  reviewState.proposals[0].files[0].hunks[1].decision = 'pending';
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), reviewState);
  await page.getByText('1 accepted · 0 rejected · 1 pending').first().waitFor();
  await page.getByRole('button', {name: 'Next hunk'}).click();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.hunkId), 'h2');
  await page.keyboard.press('Alt+r');
  assert.equal(await page.evaluate(() => window.__actions.at(-1).decision), 'reject');
  assert.equal(await page.locator('#sticky-apply').isDisabled(), true);
  const stale = { ...reviewState, stale: { proposalId: 'fixture', paths: ['src/example.ts'] } };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), stale);
  await page.getByRole('button', {name: 'Refresh proposal'}).click();
  assert.equal(await page.evaluate(() => window.__actions.at(-1).type), 'refreshStale');
  assertions.push('Sticky review navigation, keyboard decisions, and stale refresh emit the correct actions.');

  const commands = { task: 'pytest', args: ['-q', 'tests/test_cli.py'] };
  const result = exitCode => ({exitCode, stdout: `command exit ${exitCode}`, stderr: '', cleanupConfirmed: true});
  const proofState = {
    ...base, status: 'completed',
    messages: [{role:'assistant',text:'Read [example source](src/example.ts#L12).\n\n~~~markdown\n## Preview title\n~~~'}],
    evidence: { id:'fixture', workflow:'build', startedAt:1, finishedAt:1500, sessions:[], usage:{tokens:200,measured:true}, edits:[{proposalId:'fixture',checkpointId:'receipt',paths:['src/example.ts']}], checks:[
      {input:commands,phase:'baseline',durationMs:40,result:result(1),changedSource:[]},
      {input:commands,phase:'after',durationMs:55,result:result(0),changedSource:[]},
      {input:{task:'git-diff-check'},phase:'agent',durationMs:23,result:result(1),changedSource:[]},
    ]},
  };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), proofState);
  await page.getByText('Run evidence', {exact:true}).click();
  await page.getByText('1 of 2 executed checks passed', {exact:true}).waitFor();
  await page.getByText('Now passing', {exact:true}).click();
  assert.equal(await page.getByText('command exit 0', {exact:true}).isVisible(), true);
  const comparison = page.locator('.check-comparison');
  await comparison.getByText('Baseline · Failed', {exact:true}).waitFor();
  await comparison.getByText('After changes · Passed', {exact:true}).waitFor();
  await comparison.getByRole('button', {name:'Open captured output'}).last().click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'showCheck',index:1});
  await page.getByRole('link', {name:'example source'}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'openSource',path:'src/example.ts',line:12});
  await page.getByRole('button', {name:'Preview',exact:true}).click();
  await page.getByRole('heading', {name:'Preview title'}).waitFor();
  await page.getByRole('button', {name:'Collapse',exact:true}).click();
  assert.equal(await page.getByRole('heading', {name:'Preview title'}).isVisible(), false);
  await page.getByRole('button', {name:'Expand',exact:true}).click();
  await page.getByRole('heading', {name:'Preview title'}).waitFor();
  await page.locator('.reply-copy > summary').last().click();
  await page.getByRole('button', {name:'Plain text',exact:true}).click();
  assert.match(await page.evaluate(() => window.__copiedCode), /^Read example source/);
  await page.getByRole('button', {name:'Export receipt'}).click();
  assert.equal(await page.evaluate(() => window.__actions.at(-1).type), 'exportEvidence');
  assertions.push('Actual check results drive proof and baseline comparisons; citations, code preview, plain-copy and receipt export use the expected controls.');

  await page.getByRole('combobox', {name:'Workflow'}).selectOption('plan');
  await page.locator('#prompt').fill('Review @file(src/example.ts) for edge cases');
  await page.getByRole('button', {name:'Remove @file(src/example.ts)'}).click();
  assert.equal((await page.locator('#prompt').inputValue()).includes('@file'), false);
  await page.getByRole('button', {name:'Edit context'}).click();
  assert.equal(await page.evaluate(() => window.__actions.at(-1).type), 'contextPreview');
  const draftContext = { chunks:[{path:'src/example.ts',reason:'Related implementation',tokens:279,startLine:1,endLine:7}], usedTokens:279, budgetTokens:5000, indexedFiles:1 };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {...proofState,draftContext});
  await page.getByRole('button', {name:'Pin',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1).context.pins), ['src/example.ts']);
  await page.locator('#form').evaluate(form => form.requestSubmit());
  const planRequest = await page.evaluate(() => window.__actions.at(-1));
  assert.equal(planRequest.workflow,'plan');
  assert.deepEqual(planRequest.context.pins,['src/example.ts']);
  await page.locator('#new-chat').click();
  await page.locator('#prompt').fill('A clean new request');
  await page.locator('#form').evaluate(form => form.requestSubmit());
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1).context.pins), []);
  await page.locator('#tools-toggle-btn').click();
  await page.getByRole('button', {name:'Demo mode'}).click();
  assert.equal(await page.locator('body').evaluate(el => el.classList.contains('demo-mode')), true);
  assertions.push('Workflow selection, removable mentions, context pins, and demo mode work in the bundled panel.');

  const chatState = { ...base, activeConversationId:'active', conversations:[
    { id:'active', title:'Current task', messageCount:2, updatedAt:Date.now() },
    { id:'previous', title:'Earlier review', messageCount:4, updatedAt:Date.now() },
  ] };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), chatState);
  await page.locator('#history-btn').click();
  await page.locator('#history-search').fill('earlier');
  const previousChat = page.locator('.history-item', {hasText:'Earlier review'});
  assert.equal(await page.locator('.history-item').count(), 1);
  await previousChat.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'switchConversation',id:'previous'});
  assert.equal(await page.locator('#history-drawer').isHidden(), true);
  assertions.push('Chat history search and keyboard selection open the matching conversation.');
  await page.locator('#history-btn').click();
  await page.locator('#history-search').fill('src/example.ts');
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'searchHistory',query:'src/example.ts'});
  await page.evaluate(() => window.postMessage({type:'historyMatches',query:'src/example.ts',
    matches:[{id:'previous',messageIndex:2,excerpt:'Applied src/example.ts'}]},'*'));
  await previousChat.getByText('Applied src/example.ts',{exact:true}).waitFor();
  await previousChat.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'switchConversation',id:'previous',messageIndex:2});
  assertions.push('Content search shows a matching receipt excerpt and opens its message directly.');

  const impactState = { ...reviewState, impactResults:[{
    targetFile:'src/example.ts', consumers:['src/consumer.ts'], relatedTests:['tests/example.test.ts'], riskLevel:'medium', partial:true,
  }] };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), reviewState);
  await page.locator('.review-file').waitFor({state:'visible'});
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), impactState);
  const radar = page.locator('.review-file .impact-radar-card');
  await radar.getByText('↳ src/consumer.ts').waitFor();
  assert.match(await radar.innerText(), /outside the scan/);
  assertions.push('An asynchronous impact scan updates the existing hunk review and reports partial coverage.');

  const reproState = { ...base, reproSession:{phase:'capturing', errorText:'', stackTrace:'', affectedFile:''} };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), reproState);
  await page.locator('#repro-error-input').fill('A failure to reproduce');
  await page.locator('#repro-stack-input').fill('A stack trace');
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), reproState);
  await page.locator('#repro-submit-btn').click();
  const repro = await page.evaluate(() => window.__actions.at(-1));
  assert.equal(repro.type, 'submitRepro');
  assert.equal(repro.errorText, 'A failure to reproduce');
  assert.equal(repro.stackTrace, 'A stack trace');
  assertions.push('Diagnostic state refreshes preserve both fields of a reproduction draft.');

  const providerState = { ...base, connected:true, model:'google-gemini/fixture', providers:[
    { id:'openrouter', label:'OpenRouter', note:'Free routes', needsToken:false, models:[{ name:'openrouter/particle-1-free', label:'particle-1-free' }] },
    { id:'workers-ai', label:'Workers AI', note:'Daily free allowance', needsToken:true, models:[], presets:['gpt-oss-120b', 'gpt-oss-20b', 'glm-4-7-flash'] },
    { id:'groq', label:'Groq', note:'Fast inference', needsToken:false, models:[] },
    { id:'gemini', label:'Gemini', note:'Google AI Studio', needsToken:false, models:[{ name:'google-gemini/fixture', label:'fixture' }] },
    { id:'cohere', label:'Cohere', note:'Evaluation key', needsToken:false, models:[] },
    { id:'vercel', label:'Vercel', note:'Usage credits', needsToken:false, models:[] },
    { id:'custom', label:'Custom', note:'OpenAI-compatible endpoint', needsToken:false, models:[] },
  ] };
  await page.setViewportSize({width:280,height:700});
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), providerState);
  await page.locator('#model').click();
  const providers = page.locator('#provider-drawer');
  await providers.getByRole('heading', {name:'Gemini'}).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('#provider-options img')].every(img => img.complete && img.naturalWidth));
  assert.equal(await providers.locator('#provider-options img').count(), 6);
  await providers.getByRole('button', {name:'Workers AI'}).click();
  await providers.getByText('API token needed').waitFor();
  await providers.getByText('gpt-oss-120b', {exact:true}).waitFor();
  await page.screenshot({path:'test-results/ui/providers-narrow.png'});
  await providers.getByRole('button', {name:'Add API token'}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'configureProvider',provider:'workers-ai'});
  await providers.getByRole('button', {name:'OpenRouter'}).click();
  await providers.getByRole('button', {name:'particle-1-free',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'selectProviderModel', model:'openrouter/particle-1-free'});
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {...providerState,model:'openrouter/particle-1-free'});
  await page.locator('#model img[data-brand="openrouter"]').waitFor();
  assert.equal(await providers.locator('.provider-model', {hasText:'particle-1-free'}).getAttribute('aria-pressed'), 'true');
  await providers.getByRole('button',{name:'Favorite particle-1-free'}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'toggleFavoriteModel',model:'openrouter/particle-1-free'});
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {
    ...providerState, model:'openrouter/particle-1-free', favoriteModels:['openrouter/particle-1-free'], recentModels:['google-gemini/fixture'],
  });
  await providers.getByRole('button',{name:'fixture',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'selectProviderModel',model:'google-gemini/fixture'});
  await page.keyboard.press('Escape');
  assert.equal(await providers.isHidden(), true);
  assert.equal(await page.locator('#model').evaluate(node => node === document.activeElement), true);
  assertions.push('The narrow provider picker renders bundled brand marks, routes token setup, and confirms selection.');

  const themeNames = ['Graphite', 'Blueprint', 'Paper', 'Moss', 'Violet', 'Glacier', 'Ember', 'Plum', 'System'];
  const colors = new Set();
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {...failed,model:'other/available',providers:providerState.providers});
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  const picker = page.getByRole('dialog',{name:'Appearance'});
  await picker.waitFor();
  assert.equal(await picker.getByRole('radio').count(), themeNames.length);
  for (const name of themeNames) {
    const appearance = name.toLowerCase();
    await picker.getByRole('radio',{name:new RegExp(`^${name}\\b`)}).check();
    assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'setAppearance',appearance});
    await page.evaluate(state => window.postMessage({type:'state',state},'*'), {...failed,model:'other/available',appearance,providers:providerState.providers});
    await page.waitForFunction(theme => document.body.dataset.forgeTheme === theme, appearance);
    const visual = await page.evaluate(() => {
      const rgb = value => value.match(/\d+/g).slice(0,3).map(component => {
        const unit = Number(component) / 255;
        return unit <= .04045 ? unit / 12.92 : ((unit + .055) / 1.055) ** 2.4;
      });
      const luminance = value => rgb(value).reduce((sum, component, index) => sum + component * [.2126,.7152,.0722][index], 0);
      const ratio = (a,b) => (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
      const body = getComputedStyle(document.body);
      const resume = getComputedStyle(document.querySelector('#recovery-actions .primary'));
      return {
        background: body.backgroundColor,
        contrast: ratio(luminance(body.color), luminance(body.backgroundColor)),
        actionContrast: ratio(luminance(resume.color), luminance(resume.backgroundColor)),
        fits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    colors.add(visual.background);
    assert.ok(visual.fits, `${name} overflows at 280px`);
    assert.ok(visual.contrast >= 4.5, `${name} text contrast is ${visual.contrast}`);
    if (appearance !== 'system') assert.ok(visual.actionContrast >= 4.5, `${name} recovery button contrast is ${visual.actionContrast}`);
  }
  assert.equal(colors.size, themeNames.length);
  await page.keyboard.press('Escape');
  assert.equal(await picker.isHidden(), true);
  assert.equal(await page.locator('#appearance-toggle').evaluate(button => button === document.activeElement), true);
  assertions.push('Eight distinct themes and System switch at 280px, meet text and recovery-action contrast checks, and return keyboard focus on close.');

  const composer = page.locator('#form');
  assert.equal(await composer.getByRole('button',{name:'@file',exact:true}).isHidden(), true);
  await composer.getByText('Options',{exact:true}).click();
  assert.equal(await composer.getByRole('button',{name:'@file',exact:true}).isVisible(), true);
  await composer.getByText('Run limits',{exact:true}).click();
  assert.equal(await composer.getByRole('spinbutton',{name:'Tokens',exact:true}).isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await composer.getByRole('spinbutton',{name:'Tokens',exact:true}).isHidden(), true);
  assertions.push('The narrow composer keeps attachments and run limits behind a single Options control.');

  const saved = {
    ...base,
    activeConversationId:'saved-conversation',
    messages:[{role:'user',text:'Earlier change'},{role:'assistant',text:'Done.',attempt:{id:'saved-attempt',receipt:{
      reviews:[{id:'saved-review',state:'applied',paths:['src/example.ts'],checkpointId:'saved-checkpoint'}],
      checks:[{...actualCheck,result:{...actualCheck.result,stdout:'',stderr:''}}],
      commands:[],
    }}}],
  };
  await page.reload();
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), saved);
  await page.getByRole('button',{name:'View diff',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)),
    {type:'showArchivedDiff',attemptId:'saved-attempt',reviewId:'saved-review',path:'src/example.ts'});
  await page.locator('.attempt-end .check-summary').click();
  await page.getByRole('button',{name:'Open captured output'}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)),
    {type:'showArchivedCheck',attemptId:'saved-attempt',index:0});
  assert.equal(await page.getByRole('button',{name:'Allow once'}).count(), 0);
  assertions.push('A reopened chat displays saved edit and check receipts and sends read-only requests for their original artifacts.');
  await page.getByText('Reply actions',{exact:true}).click();
  await page.getByRole('button',{name:'Share summary',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'shareRunSummary',attemptId:'saved-attempt'});
  await page.getByText('Reply actions',{exact:true}).click();
  await page.getByRole('button',{name:'Branch from here',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)),
    {type:'branchConversation',id:'saved-conversation',messageIndex:1});
  await page.evaluate(() => window.postMessage({type:'revealHistory',id:'saved-conversation',index:1},'*'));
  await page.waitForFunction(() => document.activeElement?.dataset.messageIndex === '1');
  assertions.push('Saved turns can open their share preview, branch at the selected message, and receive focus from search.');

  const working = {
    ...base, status:'awaiting-review', canQueue:true, activeConversationId:'queued-chat', messages:saved.messages,
    evidence:{id:'active-attempt',edits:[],checks:[],usage:{tokens:0,measured:false}},
  };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), working);
  await page.locator('#prompt').fill('Check the configuration\nAdd a focused assertion.');
  await page.getByRole('button',{name:'Queue',exact:true}).click();
  const queued = {id:'follow-up-id',prompt:'Check the configuration\nAdd a focused assertion.',status:'queued'};
  assert.deepEqual(await page.evaluate(() => window.__actions.filter(action => action.type === 'queueFollowUp').map(({after,prompt}) => ({after,prompt}))),
    [{after:'active-attempt',prompt:queued.prompt}]);
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {...working,queuedFollowUp:queued});
  await page.getByText('Follow-up queued',{exact:true}).waitFor();
  assert.equal(await page.locator('#prompt').inputValue(), '');
  assert.equal(await page.getByRole('button',{name:'Send now',exact:true}).count(), 0);
  await page.locator('#follow-up').getByRole('button',{name:'Edit',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'editFollowUp',id:queued.id});
  await page.evaluate(entry => window.postMessage({type:'editFollowUp',id:entry.id,prompt:entry.prompt,requeue:true},'*'), queued);
  const editor = page.getByRole('dialog',{name:'Edit follow-up'});
  const updated = 'Recheck the command.\nInclude the empty case.';
  await editor.getByRole('textbox',{name:'Follow-up request'}).fill(updated);
  await editor.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(() => window.__actions.at(-1).type === 'updateFollowUp');
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'updateFollowUp',id:queued.id,requeue:true,prompt:updated});
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {
    ...working,status:'failed',canQueue:false,queuedFollowUp:{...queued,prompt:updated,status:'held'},
  });
  await page.getByText('Follow-up held',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Send now',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'sendFollowUp',id:queued.id});
  assertions.push('A follow-up can be queued during review, edited as multiline text, and sent explicitly from a held state.');

  const long = {
    ...base, status:'running', activeConversationId:'live-long', activitySequence:30,
    messages:Array.from({length:18}, (_,index) => ({role:index%2 ? 'assistant' : 'user',text:`Turn ${index}\n\n${'Long agent response. '.repeat(60)}`})),
  };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), long);
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    return main.scrollHeight - main.scrollTop - main.clientHeight < 64 && main.scrollTop > 100;
  });
  await page.locator('main').evaluate(main => { main.scrollTop = 0; });
  await page.getByRole('button',{name:'Jump to latest',exact:true}).waitFor();
  await page.evaluate(state => window.postMessage({type:'state',state},'*'),
    {...long,activitySequence:32,activity:['read file: src/a.ts','read file: src/b.ts']});
  const jump = page.getByRole('button',{name:'Jump to latest · 2 new',exact:true});
  await jump.waitFor();
  assert.equal(await page.locator('main').evaluate(main => main.scrollTop), 0);
  await jump.click();
  assert.equal(await jump.isHidden(), true);
  assert.equal(await page.locator('main').evaluate(main => main.scrollHeight - main.scrollTop - main.clientHeight < 64), true);
  assertions.push('New activity leaves a history reader in place and the jump button restores live following.');

  const reviewFilters = {
    ...reviewState, activeConversationId:'filter-fixture', activity:['read file: src/example.ts · Line 8', 'Search match: ["src/example.ts",12]'],
    messages:[{role:'user',text:'Review fixture'},{role:'assistant',text:'A reviewable change.',attempt:{id:'fixture'}}],
    evidence:{id:'fixture',checks:[],edits:[],usage:{tokens:0,measured:false}},
  };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), reviewFilters);
  await page.locator('[data-attempt-id="fixture"] #live-results').waitFor();
  const filter = page.getByRole('combobox',{name:'Timeline filter'});
  await filter.selectOption('errors');
  assert.equal(await page.locator('#review-list .review').isVisible(), true);
  assert.equal(await page.locator('.assistant .message-body').isHidden(), true);
  await page.getByRole('button',{name:'Pending only'}).click();
  assert.equal(await page.locator('#review-list .hunk').count(), 1);
  await page.getByRole('button',{name:'Previous',exact:true}).click();
  assert.match(await page.locator('#review-count').textContent(), /Pending hunk 1 of 1/);
  await page.getByRole('button',{name:'Accept 1 in file',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'decideFile',proposalId:'fixture',path:'src/example.ts',decision:'accept'});
  await filter.selectOption('all');
  await page.locator('.work-batch > summary').click();
  await page.locator('.work-batch').getByRole('button',{name:/Match/}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'openSource',path:'src/example.ts',line:12,attemptId:'fixture'});
  assertions.push('Timeline filtering keeps pending review available, file decisions are scoped, and grouped search matches open exact source lines.');

  const threadA = {...base,activeConversationId:'draft-a',conversations:[
    {id:'draft-a',title:'First draft',messageCount:1,updatedAt:1,pinned:true},
    {id:'draft-b',title:'Other draft',messageCount:0,updatedAt:2},
    {id:'draft-c',title:'Archived task',messageCount:2,updatedAt:3,archived:true},
  ]};
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), threadA);
  await page.locator('#prompt').fill('Inspect @file(src/example.ts#L8-L12)');
  await page.getByRole('button',{name:'Preview @file(src/example.ts#L8-L12)'}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'previewMention',reference:'@file(src/example.ts#L8-L12)'});
  await page.getByRole('combobox',{name:'Workflow'}).selectOption('plan');
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {...threadA,activeConversationId:'draft-b'});
  await page.waitForFunction(() => document.getElementById('prompt').value === '');
  await page.locator('#prompt').fill('Separate draft');
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), threadA);
  await page.waitForFunction(() => document.getElementById('prompt').value === 'Inspect @file(src/example.ts#L8-L12)');
  assert.equal(await page.getByRole('combobox',{name:'Workflow'}).inputValue(), 'plan');
  await page.locator('#history-btn').click();
  assert.match(await page.locator('.history-item').first().innerText(), /First draft/);
  await page.getByRole('button',{name:'Archived',exact:true}).click();
  await page.locator('.history-item').getByText('Archived task',{exact:true}).waitFor();
  await page.getByLabel('Manage Archived task').click();
  await page.getByRole('button',{name:'Unarchive',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'archiveConversation',id:'draft-c'});
  await page.locator('#drawer-close').click();
  assertions.push('Draft text and mode stay scoped to each chat, context chips can preview a file range, and the history drawer exposes archive controls.');

  const selectedReply = {
    ...base,status:'running',activeConversationId:'selection-chat',messages:[
      {role:'user',text:'Keep the answer selected'},{role:'assistant',text:'Selected line.',attempt:{id:'selected-reply'}},
    ],activity:['edited file: src/example.ts'],
  };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), selectedReply);
  await page.locator('.assistant .message-body').getByText('Selected line.',{exact:true}).waitFor();
  await page.locator('.assistant .message-body p').evaluate(block => {
    const range = document.createRange();
    range.selectNodeContents(block);
    document.getSelection().addRange(range);
  });
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {
    ...selectedReply,messages:[selectedReply.messages[0],{...selectedReply.messages[1],text:'Selected line. More output.'}],
  });
  await page.locator('.assistant .message-body[data-pending-text]').waitFor();
  assert.equal(await page.evaluate(() => document.getSelection().toString()), 'Selected line.');
  await page.evaluate(() => document.getSelection().removeAllRanges());
  await page.getByText('Selected line. More output.',{exact:true}).waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#run-status .spinner').evaluate(node => getComputedStyle(node).animationName), 'none');
  assertions.push('Streaming preserves a selected response until release and honors the operating system reduced-motion preference.');

  const reconnect = {
    ...base,status:'failed',error:'Connection timed out.',connected:false,sessionId:'known-session',
    recovery:{id:'known-run',kind:'reconnect',title:'Connection interrupted',sessionId:'known-session',model:'fixture/model'},
  };
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), reconnect);
  await page.getByRole('button',{name:'Reconnect',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'recoverRun',id:'known-run'});
  await page.getByText('Details',{exact:true}).last().click();
  await page.getByRole('button',{name:'Copy diagnostic',exact:true}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'copyDiagnostic'});
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {
    ...base,status:'cancelled',evidence:{id:'known-run',stopReason:'Reported token limit reached.',
      edits:[],checks:[],usage:{tokens:50,measured:true}},
  });
  await page.getByRole('button',{name:'Adjust run limits',exact:true}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'Tokens',exact:true}).evaluate(node => document.activeElement === node), true);
  assertions.push('Reconnect and diagnostic copy are available in the error dock and a budget stop opens the relevant limit field.');

  const reviewReply = {
    ...base, status:'completed', connected:true, model:'openrouter/particle-1-free',
    messages:[{role:'assistant',text:[
      'The `flask config` command is ready, and the CLI tests pass.',
      '',
      '**Source** — [src/flask/cli.py#L1120-L1137](src/flask/cli.py#L1120-L1137)',
      '',
      '- Defined with `@click.command("config", short_help="Show the config for the app.")` and `@with_appcontext`.',
      '- Masks keys containing `SECRET`, `PASSWORD`, `TOKEN`, or `KEY` in `current_app.config`.',
      '',
      '**Test** — [tests/test_cli.py#L49-L68](tests/test_cli.py#L49-L68)',
      '',
      '- Covers `SECRET_KEY` and `my_token`, and preserves `CUSTOM_VALUE`.',
      '',
      '**Docs** — [docs/cli.rst#L148-L164](docs/cli.rst#L148-L164)',
      '',
      '~~~python',
      '# Output can contain values of different types.',
      'def show_config():',
      '    result = {"API_KEY": "***", "ITEMS": 2}',
      '    return result',
      '~~~',
    ].join('\n')}],
  };
  await page.setViewportSize({width:300,height:850});
  for (const theme of themeNames) {
    const appearance = theme.toLowerCase();
    await page.evaluate(state => window.postMessage({type:'state',state},'*'), {...reviewReply,appearance});
    await page.waitForFunction(value => document.body.dataset.forgeTheme === value && document.querySelector('code.inline-code'), appearance);
    const ratios = await page.locator('.message-body').evaluate(body => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const rgb = value => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
          const input = channel / 255;
          return input <= .04045 ? input / 12.92 : ((input + .055) / 1.055) ** 2.4;
        });
      };
      const luminance = value => rgb(value).reduce((total, channel, index) => total + channel * [.2126,.7152,.0722][index], 0);
      const contrast = (foreground, background) => {
        const [light, dark] = [luminance(foreground), luminance(background)].sort((a,b) => b - a);
        return (light + .05) / (dark + .05);
      };
      const inline = [...body.querySelectorAll('code.inline-code')].map(node => {
        const style = getComputedStyle(node);
        return contrast(style.color, style.backgroundColor);
      });
      const block = body.querySelector('.code-block-wrapper');
      const panel = getComputedStyle(block).backgroundColor;
      const syntax = [...block.querySelectorAll('pre, pre span')].map(node => contrast(getComputedStyle(node).color, panel));
      return { inline: Math.min(...inline), syntax: Math.min(...syntax), width: document.documentElement.scrollWidth };
    });
    assert.ok(ratios.inline >= 4.5 && ratios.syntax >= 4.5, `${theme} response contrast ${JSON.stringify(ratios)}`);
    assert.ok(ratios.width <= 300, `${theme} response overflows ${ratios.width}px`);
  }
  await page.setViewportSize({width:565,height:890});
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {...reviewReply,appearance:'paper'});
  await page.waitForFunction(() => document.body.dataset.forgeTheme === 'paper');
  await page.getByRole('link',{name:'src/flask/cli.py#L1120-L1137'}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)),
    {type:'openSource',path:'src/flask/cli.py',line:1120,endLine:1137});
  await page.locator('main').evaluate(main => main.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:'test-results/ui/paper-task-b-readable.png'});
  assertions.push('Task B inline code and highlighted blocks meet 4.5:1 contrast across all eight themes and System, and source ranges keep both line numbers.');

  assert.deepEqual(errors,[]);
  await writeFile('test-results/ui-smoke.json',JSON.stringify({checkedAt:new Date().toISOString(),fixture:'Exact extension renderer with a VS Code message fixture; not a native editor or live model run.',assertions,errors},null,2));
  console.log(JSON.stringify({assertions:assertions.length,errors:errors.length}));
} finally {
  const serverClosed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await browser.close();
  await serverClosed;
}
