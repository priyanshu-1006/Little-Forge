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

  // Test modern command permission card & crossing out (dismissal)
  const approvalState = {
    ...base,
    status: 'awaiting-review',
    connected: true,
    model: 'configured/provider',
    proposals: [{ ...proposal, id: 'fixture-dismiss', state: 'applied' }],
    approvals: [{ name: 'run_command', args: { task: 'pytest', args: ['tests/repro.py'] }, toolCallId: 'cmd_1', threadId: 'main' }]
  };
  await page.evaluate(s => window.postMessage({ type: 'state', state: s }, '*'), approvalState);
  await page.locator('.command-card').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.command-prompt-symbol').textContent(), '$');
  assert.match(await page.locator('.command-cli-code').textContent(), /pytest tests\/repro\.py/);
  assert.equal(await page.locator('.command-card .card-dismiss-btn').count(), 1);

  // Click Allow once
  await page.getByRole('button', { name: 'Allow once' }).click();
  const cmdAction = await page.evaluate(() => window.__actions.find(a => a.type === 'commandDecision' && a.toolCallId === 'cmd_1'));
  assert.equal(cmdAction?.allow, true);
  assert.match(await page.locator('.command-status-msg').textContent(), /Command allowed/);

  // Dismiss command card
  await page.locator('.command-card .card-dismiss-btn').click();
  assert.equal(await page.locator('.command-card').count(), 0);
  const approvedChoices = await page.evaluate(() => window.__actions.filter(a => a.toolCallId === 'cmd_1'));
  assert.deepEqual(approvedChoices, [{ type:'commandDecision', toolCallId:'cmd_1', allow:true }]);

  // Dismiss applied proposal (change acceptor)
  assert.equal(await page.locator('.review').count(), 1);
  await page.locator('.review .review-dismiss-action').click();
  assert.equal(await page.locator('.review').count(), 0);
  assert.equal(await page.evaluate(() => window.__actions.some(a => a.proposalId === 'fixture-dismiss')), false);

  const pendingProposal = {...proposal, id:'fixture-pending-dismiss', state:'pending'};
  const pendingState = {...approvalState, proposals:[pendingProposal], approvals:[
    {...approvalState.approvals[0], toolCallId:'cmd_2'},
    {...approvalState.approvals[0], toolCallId:'cmd_3', args:{task:'pytest', args:['tests/another.py']}},
    { name:'apply_proposal', args:{proposalId:pendingProposal.id}, toolCallId:'apply_2', threadId:'main' },
  ]};
  await page.evaluate(s => window.postMessage({type:'state', state:s}, '*'), pendingState);
  await page.locator('.review').waitFor();
  assert.equal(await page.locator('.review .card-dismiss-btn').count(), 0);
  await page.locator('.command-card', {hasText:'tests/repro.py'}).getByTitle('Deny and dismiss request').click();
  assert.deepEqual(await page.evaluate(() => window.__actions.filter(a => a.toolCallId === 'cmd_2')),
    [{ type:'commandDecision', toolCallId:'cmd_2', allow:false }]);
  assert.equal(await page.locator('.command-card', {hasText:'tests/another.py'}).isVisible(), true);
  assert.equal(await page.locator('.review').isVisible(), true);
  assertions.push('Card dismissal keeps pending hunk review and other approvals visible, with a single decision for each command.');

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
  const failed = {...base,status:'failed',connected:true,model:'fixture/unreachable',messages:[{role:'user',text:'Failure visibility fixture'}],error:'Cannot connect to the configured model endpoint.',context:{usedTokens:12000,budgetTokens:12000,indexedFiles:222,chunks:Array.from({length:24},(_,i)=>({path:`src/file-${i}.py`,startLine:1,endLine:40,reason:'Retrieved source evidence. '.repeat(10)}))}};
  await page.evaluate(state=>window.postMessage({type:'state',state},'*'),failed);
  await page.getByRole('alert').waitFor({state:'visible'});
  await page.waitForFunction(()=>{const alert=document.getElementById('error').getBoundingClientRect();const main=document.querySelector('main').getBoundingClientRect();return alert.top>=main.top && alert.bottom<=main.bottom;});
  assert.equal(await page.locator('#prompt').isEnabled(),true);
  await page.screenshot({path:'test-results/ui/failure-fixture.png',fullPage:false});
  assertions.push('A new failure is visible above long context evidence after scrolling; the composer is usable.');

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
  await page.getByText('1 of 2 executed checks passed', {exact:true}).waitFor();
  await page.getByText('Now passing', {exact:true}).click();
  assert.equal(await page.getByText('command exit 0', {exact:true}).isVisible(), true);
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
  await providers.getByRole('button', {name:'particle-1-free'}).click();
  assert.deepEqual(await page.evaluate(() => window.__actions.at(-1)), {type:'selectProviderModel', model:'openrouter/particle-1-free'});
  await page.evaluate(state => window.postMessage({type:'state',state},'*'), {...providerState,model:'openrouter/particle-1-free'});
  await page.locator('#model img[data-brand="openrouter"]').waitFor();
  assert.equal(await providers.getByRole('button', {name:/particle-1-free/}).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await providers.isHidden(), true);
  assert.equal(await page.locator('#model').evaluate(node => node === document.activeElement), true);
  assertions.push('The narrow provider picker renders bundled brand marks, routes token setup, and confirms selection.');

  assert.deepEqual(errors,[]);
  await writeFile('test-results/ui-smoke.json',JSON.stringify({checkedAt:new Date().toISOString(),fixture:'Exact extension renderer with a VS Code message fixture; not a native editor or live model run.',assertions,errors},null,2));
  console.log(JSON.stringify({assertions:assertions.length,errors:errors.length}));
} finally {
  const serverClosed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await browser.close();
  await serverClosed;
}
