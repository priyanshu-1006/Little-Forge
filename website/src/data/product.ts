import { Braces, GitPullRequest, RotateCcw } from 'lucide-react'
import release from './release.json'
import cliRelease from './cli-release.json'

export const project = {
  name: 'Little Forge',
  repository: 'https://github.com/priyanshu-1006/Little-Forge',
  npmPackage: 'https://www.npmjs.com/package/little-forge-cli',
  cliInstall: 'npm install -g little-forge-cli\nlittle-forge',
  trueForge: 'https://github.com/truefoundry/trueforge',
  harness: '0.180.1',
  port: 8790,
  release,
  cliRelease,
}

export const providers = [
  { name: 'OpenRouter', icon: 'openrouter' },
  { name: 'Workers AI', icon: 'workers-ai' },
  { name: 'Groq', icon: 'groq' },
  { name: 'Gemini', icon: 'gemini' },
  { name: 'Cohere', icon: 'cohere' },
  { name: 'Vercel', icon: 'vercel' },
]

export const workflows = [
  {
    id: 'inline', label: 'Inline edit', icon: Braces,
    title: 'Start with a selection.',
    description: 'Select a function, describe the change, and review the result in VS Code. Little Forge keeps the proposal inside your selection.',
    notes: ['Scope the edit to selected code', 'Review and apply hunks individually'],
    media: 'inline-review', alt: 'VS Code shows a selected Flask function and two pending Little Forge hunks with Accept and Reject controls.',
    docs: '/docs/workflows#inline-edit',
  },
  {
    id: 'agent', label: 'Agent mode', icon: GitPullRequest,
    title: 'Describe the outcome.',
    description: 'Build mode discovers relevant code, tests, and docs in your repository. Open the context panel to see what was selected and how much of the token budget it used.',
    notes: ['Inspect selected context and its budget', 'Review related files in one proposal'],
    media: 'agent-workflow', alt: 'The Little Forge panel reviews a multi-file Flask proposal inside VS Code.',
    docs: '/docs/workflows#build-ask-and-plan',
  },
  {
    id: 'recovery', label: 'Recovery', icon: RotateCcw,
    title: 'Pick up from a failed run.',
    description: 'Little Forge surfaces the error in the panel and offers recovery actions when they are available. Inspect the TrueForge session or switch to another configured model.',
    notes: ['See the provider error in the editor', 'Inspect the session before retrying'],
    media: 'recovery', alt: 'VS Code remains open while the Little Forge panel reports a refused connection and shows its recovery actions.',
    docs: '/docs/troubleshooting#resume-a-run',
  },
]

export const chapters = [
  { stamp: '0:00', time: 0, label: 'Overview' },
  { stamp: '0:26', time: 25.767, label: 'Inline edit' },
  { stamp: '1:07', time: 66.967, label: 'Agent mode' },
  { stamp: '2:35', time: 155.4, label: 'Resilience' },
  { stamp: '3:22', time: 201.8, label: 'Tool showcase' },
]
