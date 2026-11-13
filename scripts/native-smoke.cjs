const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async function () {
  const project = path.resolve(__dirname, '..');
  const receipt = { date: new Date().toISOString(), editor: vscode.version, assertions: [], errors: [] };
  try {
    const extension = vscode.extensions.getExtension('priyanshu-chaurasia.little-forge');
    if (!extension) throw new Error('Little Forge was not discovered by the real extension host.');
    await extension.activate(); receipt.assertions.push('Extension activates in the real VS Code extension host.');
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['open','inlineEdit','stop','undo','setup','review']) if (!commands.includes(`littleForge.${command}`)) throw new Error(`Missing native command: ${command}`);
    receipt.assertions.push('All six required product commands are registered.');
    await vscode.commands.executeCommand('littleForge.open');
    receipt.assertions.push('The contributed webview command opens without host errors.');
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar').catch(() => {});
    await vscode.commands.executeCommand('littleForge.open');
    await new Promise(resolve => setTimeout(resolve, 2500));
  } catch (error) { receipt.errors.push(error.message); }
  await fs.mkdir(path.join(project, 'test-results'), { recursive: true });
  await fs.writeFile(path.join(project, 'test-results', 'native-smoke.json'), JSON.stringify(receipt, null, 2));
  // Keep only the owned development-host window available for visual inspection.
  for (let i = 0; i < Number(process.env.FORGE_VISUAL_HOLD_SECONDS || 3); i++) {
    try { await fs.access(path.join(project, 'test-results', 'native-smoke-stop')); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (receipt.errors.length) throw new Error(receipt.errors.join('; '));
};
