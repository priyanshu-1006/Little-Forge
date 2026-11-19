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
const css = `:root{--vscode-sideBar-background:#12171d;--vscode-editor-background:#1a2028;--vscode-foreground:#e4eaf0;--vscode-descriptionForeground:#9caaba;--vscode-widget-border:#303c48;--vscode-font-family:'Segoe UI',system-ui;--vscode-editor-font-family:Consolas,monospace}\n` + await readFile('src/ui.css', 'utf8');
const js = await readFile('src/ui.js', 'utf8');
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
  assert.equal(await page.locator('#tools-sidebar button').count(), 5); // close + 4 tools
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

  assert.deepEqual(errors,[]);
  await writeFile('test-results/ui-smoke.json',JSON.stringify({checkedAt:new Date().toISOString(),fixture:'Exact extension renderer with a VS Code message fixture; not a native editor or live model run.',assertions,errors},null,2));
  console.log(JSON.stringify({assertions:assertions.length,errors:errors.length}));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
