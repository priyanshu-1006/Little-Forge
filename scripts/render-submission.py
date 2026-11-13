"""Render the honest three-page Round 1 draft. Requires reportlab; no model calls."""
from pathlib import Path
from html import escape
import json
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'submission/writeup-data.json').read_text(encoding='utf-8'))
OUT = ROOT / 'output/pdf/Little_Forge_Round1_Writeup_Draft.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
INK, MUTED, GREEN, MINT = map(colors.HexColor, ['#142523','#51635F','#07634D','#DDF5EB'])
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyLF',fontName='Helvetica',fontSize=10,leading=14,textColor=INK,spaceAfter=8))
styles.add(ParagraphStyle(name='HeadingLF',fontName='Helvetica-Bold',fontSize=13,leading=17,textColor=GREEN,spaceBefore=12,spaceAfter=7,keepWithNext=True))
styles.add(ParagraphStyle(name='SmallLF',fontName='Helvetica',fontSize=8.5,leading=11,textColor=MUTED,spaceAfter=5))
styles.add(ParagraphStyle(name='CellLF',fontName='Helvetica',fontSize=8.5,leading=11,textColor=INK))
styles.add(ParagraphStyle(name='TitleLF',fontName='Helvetica-Bold',fontSize=25,leading=29,textColor=INK,spaceAfter=7))

def p(text, style='BodyLF'): return Paragraph(text, styles[style])
def heading(text): return p(escape(text),'HeadingLF')
def cell(text): return p(escape(str(text)),'CellLF')
def table(rows, widths, header=True):
    t=Table([[cell(c) for c in row] for row in rows],colWidths=widths,hAlign='LEFT',repeatRows=1 if header else 0)
    rules=[('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,-1),0.4,colors.HexColor('#D6E2DD'))]
    if header: rules += [('BACKGROUND',(0,0),(-1,0),MINT)]
    t.setStyle(TableStyle(rules)); return t

def frame(c, doc):
    width,height=A4
    c.setFillColor(GREEN); c.rect(40,height-39,18,18,fill=1,stroke=0)
    c.setFillColor(colors.white); c.setFont('Helvetica-Bold',12); c.drawString(45,height-35,'F')
    c.setFillColor(INK); c.setFont('Helvetica-Bold',9); c.drawString(66,height-32,'LITTLE FORGE  /  ROUND 1')
    c.setFillColor(MUTED); c.setFont('Helvetica',8); c.drawRightString(width-40,height-32,'SUBMISSION DRAFT  |  '+DATA['dateIST'])
    c.setStrokeColor(colors.HexColor('#C8DAD2')); c.line(40,42,width-40,42)
    c.setFillColor(MUTED); c.setFont('Helvetica',7.5); c.drawString(40,29,DATA['teamName']+' | '+DATA['teamId'])
    c.drawRightString(width-40,29,f'{doc.page} / 3')

width=A4[0]-80
story=[p('Little Forge','TitleLF'),p('A TrueForge-native VS Code coding extension','BodyLF'),
p('<b>Draft status:</b> native A and C rehearsals passed; complete B, final footage, video timestamps and remaining team details are not yet confirmed. No judge score or passing video is claimed.','SmallLF')]
story += [heading('1. Team'),p('<b>'+escape(DATA['teamName'])+'</b> | Team ID '+escape(DATA['teamId']))]
member_rows=[['Member','Role','Institution / GitHub']]
for member in DATA['members']:
    identity=' / '.join(x for x in [member['institution'],member['github']] if x) or 'Awaiting confirmation'
    member_rows.append([member['name'],member['role'],identity])
story += [table(member_rows,[172,65,width-237]),
heading('2. Starting point'),
p('New competition-focused extension in the Little_Code repository. Starting point: <link href="https://github.com/priyanshu-1006/Little_Code" color="#07634D">github.com/priyanshu-1006/Little_Code</link>, inspected commit <font face="Courier" size="8">87de0a55b77c742b1a6ce2c4e2ce39796894f125</font>. Protected reads, lexical retrieval and review/checkpoint patterns were adapted into focused modules. The prior agent loop, direct providers and desktop shell are excluded.'),
p('The new subproject is MIT licensed. REUSE.md declares ancestry; dependency notices and original dependency licences are preserved. This is not described as having no prior foundation.','SmallLF'),
heading('3. Architecture on TrueForge'),
table([['Editor client','Local harness','Model execution'],['VS Code panel / inline command','TrueForge 0.180.1 HTTP sessions, turns and SSE','Provider configured in TrueForge only']], [width/3]*3),Spacer(1,8),
p('The harness owns the agent/tool loop. Editor MCP tools expose repository maps, literal search, fresh reads, symbols, retrieval, diagnostics, staged changes, reviewed apply and a fixed command catalog. Eight schemas load in inline mode and nine in agent mode, avoiding redundant discovery requests on free quotas.'),
p('TrueForge pauses sensitive calls. Per-hunk decisions produce a one-use host grant; hash and selection checks precede journaled writes. Checkpoint undo preserves later conflicting edits. Streaming and Stop revoke grants and cancel harness/tool work. Compaction is configured; its useful operation in the final B session still needs footage. Sandbox, dynamic subagents and web search are disabled.'),PageBreak()]

story += [heading('4. How context is selected'),
p('A bounded lexical index covers source, tests and documentation, with declaration/import links and source/test/docs ranking. @file and @symbol mentions resolve explicit identities; ambiguous symbols fail visibly. Context cards show actual paths, line ranges, reasons and conservative UTF-8 budget charges. Each proposal requires fresh file hashes.'),
p('Inline mode reads only the captured saved selection initially, verifies its immutable hash and UTF-16 bounds, and preserves its exact text. It scans the repository only for additional explicit mentions or later model requests; an oversized selection is rejected without clipping.','SmallLF'),
p('Measured unhinted Flask retrieval selected implementation, CLI tests and CLI documentation first: 222 indexed files, 11,986 / 12,000 conservative units. Default working capacity is 32,768 with a 4,096 output reserve. Index limits: 2,500 files and 8 MiB reads. The budget is not reported provider token usage. Protected/ignored file events do not interrupt indexing; relevant source/policy changes invalidate it.'),
heading('5. Model setup'),
p('Real trials used Google-hosted Gemini 3.1 Flash-Lite, 3.5 Flash-Lite, 3.6 Flash and 3.8 Flash through the native Google provider in local TrueForge. Flash-Lite with medium reasoning passed A; earlier trials used provider defaults. Optional reasoning effort is passed only through TrueForge. Credentials stay in its local settings. Connect opens the configured-model picker; selecting a model switches the next run. Test-only refused loopback endpoints exercise C without using real model quota.'),
p('Expected API cost: USD 0 for free-tier trials; billing was not independently audited and no paid upgrade was initiated. The project hit explicit daily free limits on 3.6/3.8. Safe quota continuation is bounded and retains read context; writes, commands, reviews and ambiguous delivery block automatic replay. Long daily waits stop recovery. Flash-Lite has not completed B; model availability is not a solved-task claim.','SmallLF'),
heading('6. Scorecard'),
p('No points are self-awarded. All timestamps must be replaced with positions from the final A/B/C recording.','SmallLF')]
score=[['Criterion','Max','Video time','Current supported claim']]
score += [[row['criterion'],row['max'],row['timestamp'],row['claim']] for row in DATA['scorecard']]
story += [table(score,[106,32,75,width-213]),PageBreak(),heading('7. Tools used'),
p('Development assistance: Codex, including delegated research, implementation and review agents during earlier development. Main libraries/tools: VS Code Extension API, TrueForge 0.180.1, MCP TypeScript SDK 1.26.0, TypeScript 5.9.3, Zod 4.1.12, jsdiff 8.0.2, ignore 7.0.5, esbuild, tsx, VSCE, Playwright Core, Python 3.13.9, uv 0.12.17 and pytest. ReportLab renders this write-up; native computer-use tools assist editor verification.'),
p('Verification: '+str(DATA['localTests'])+' local tests passed, TypeScript and bundle build passed. A real TrueForge process passed 12 protocol/approval/undo/cancellation/error assertions with a deterministic test model (17 fixture requests). These checks establish integration behavior, not real-model reasoning or a passing competition video.'),
heading('8. Known limitations and what you would do with another month'),
p('<b>Current acceptance:</b> native A showed the exact prompt, independent hunk accept/reject previews and apply, then passed all 42 strict checks and 35 helper tests. Native checkpoint undo restored all 235 file hashes and clean Git status. A separate accepted core patch is preserved. Physical shortcut and final video remain unverified. B has no verified meaningful three-file patch. '+escape(DATA['nativeC'])),
p('<b>Technical limits:</b> retrieval is lexical, not a full semantic graph. Conservative budgets can overestimate tokens. File changes are UTF-8 text with per-file atomic replacement and journaled multi-file recovery, not a universal filesystem transaction. Dirty editors must be saved. Native Ctrl+Z is not the advertised checkpoint undo. Approved project tests can have side effects outside source-edit rollback.'),
p('<b>Next month:</b> improve symbol-aware and incremental retrieval, measure cold/warm latency and cancellation under load, expand language coverage, verify model portability with adequate quotas, harden crash/command-side-effect recovery, and complete independent clean-machine and native end-to-end acceptance.'),
p('<b>Before submission:</b> finish exact A/B/C with visible verification and actual B session; record the legible four-minute video in A/B/C order; enter real scorecard timestamps and final team details; publish the reviewed repository, PDF and video; verify public links before authorized portal submission.'),
Spacer(1,12),table([['Release gates','Current state'],['Public repository',DATA['repositoryUrl']],['Final video',DATA['videoUrl']],['This document','Three-page draft; update after live acceptance and recording']], [145,width-145])]

doc=SimpleDocTemplate(str(OUT),pagesize=A4,rightMargin=40,leftMargin=40,topMargin=62,bottomMargin=58,title='Little Forge - Round 1 submission draft',author=DATA['teamName'])
doc.build(story,onFirstPage=frame,onLaterPages=frame)
print(OUT)
