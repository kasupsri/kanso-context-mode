import { getAppState } from '../state/index.js';
import { webProviderChoices } from '../tools/web-search.js';

export interface PromptArgumentDefinition {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments?: PromptArgumentDefinition[];
}

const PROMPTS: PromptDefinition[] = [
  {
    name: 'summarize_run',
    title: 'Summarize Run',
    description: 'Summarize a recorded terminal run and highlight the important output.',
    arguments: [
      { name: 'run_id', description: 'Recorded run id to summarize.', required: true },
      { name: 'focus', description: 'Optional lens such as errors, warnings, or next steps.' },
    ],
  },
  {
    name: 'review_diff',
    title: 'Review Diff',
    description: 'Review the current git diff using Kanso summaries before opening large patches.',
    arguments: [
      { name: 'scope', description: 'Diff scope: working, staged, or unstaged.' },
      { name: 'base_ref', description: 'Optional base ref for compare-against review.' },
    ],
  },
  {
    name: 'research_topic',
    title: 'Research Topic',
    description: 'Research a topic with web_search and optionally fetch/index selected sources.',
    arguments: [
      { name: 'topic', description: 'Research topic or question.', required: true },
      { name: 'provider', description: 'Web provider to use.' },
      { name: 'kb_name', description: 'Optional knowledge base name for indexing.' },
    ],
  },
  {
    name: 'draft_commit_message',
    title: 'Draft Commit Message',
    description: 'Use git_focus to draft a concise commit message from the current diff.',
    arguments: [
      { name: 'scope', description: 'Diff scope: working, staged, or unstaged.' },
      { name: 'repo_path', description: 'Optional repository path.' },
    ],
  },
];

export function listPromptDefinitions(): PromptDefinition[] {
  return PROMPTS;
}

function asTextMessage(text: string) {
  return {
    role: 'user' as const,
    content: {
      type: 'text' as const,
      text,
    },
  };
}

export function getPromptDefinition(name: string): PromptDefinition | undefined {
  return PROMPTS.find(prompt => prompt.name === name);
}

export function buildPromptMessages(
  name: string,
  args: Record<string, string | undefined> = {}
): Array<{ role: 'user'; content: { type: 'text'; text: string } }> {
  switch (name) {
    case 'summarize_run': {
      const runId = args['run_id']?.trim() || 'latest';
      const focus = args['focus']?.trim();
      return [
        asTextMessage(
          [
            `Use \`run_focus({ run_id: ${runId} })\` and the \`run://${runId}\` resource to summarize this run.`,
            focus ? `Prioritize: ${focus}.` : 'Prioritize errors, root cause, and next action.',
            'Keep the summary short and refer to the recorded run instead of replaying raw output.',
          ].join(' ')
        ),
      ];
    }
    case 'review_diff': {
      const scope = args['scope']?.trim() || 'working';
      const baseRef = args['base_ref']?.trim();
      return [
        asTextMessage(
          [
            `Start with \`git_focus({ scope: "${scope}"${baseRef ? `, base_ref: "${baseRef}"` : ''}, include_hunks: true })\`.`,
            'Review for bugs, regressions, risky edge cases, and missing tests before opening more code.',
          ].join(' ')
        ),
      ];
    }
    case 'research_topic': {
      const topic = args['topic']?.trim() || 'topic';
      const provider = args['provider']?.trim();
      const kbName = args['kb_name']?.trim();
      return [
        asTextMessage(
          [
            `Use \`web_search({ query: "${topic.replace(/"/g, '\\"')}"${provider ? `, provider: "${provider}"` : ''} })\` first.`,
            kbName
              ? `If you find high-value URLs, call \`fetch_and_index({ urls: [...], kb_name: "${kbName}" })\` and then \`search({ query: "...", kb_name: "${kbName}" })\`.`
              : 'If you find high-value URLs, call `fetch_and_index` on the best ones before summarizing.',
            'Cite the source URLs you used.',
          ].join(' ')
        ),
      ];
    }
    case 'draft_commit_message': {
      const scope = args['scope']?.trim() || 'staged';
      const repoPath = args['repo_path']?.trim();
      return [
        asTextMessage(
          [
            `Use \`git_focus({ scope: "${scope}"${repoPath ? `, repo_path: "${repoPath}"` : ''}, include_hunks: true })\` to inspect the diff first.`,
            'Draft a concise imperative commit message with a short body only if it adds real value.',
          ].join(' ')
        ),
      ];
    }
    default:
      throw new Error(`Unknown prompt "${name}"`);
  }
}

export function completePromptArgument(
  name: string,
  argumentName: string,
  currentValue: string
): string[] {
  const prefix = currentValue.trim().toLowerCase();

  if (argumentName === 'run_id') {
    return getAppState()
      .getLatestTerminalRuns(20)
      .map(run => String(run.id))
      .filter(value => value.startsWith(prefix));
  }

  if (argumentName === 'provider') {
    return webProviderChoices().filter(value => value.startsWith(prefix));
  }

  if (argumentName === 'scope') {
    return ['working', 'staged', 'unstaged'].filter(value => value.startsWith(prefix));
  }

  if (argumentName === 'kb_name') {
    return getAppState()
      .listKnowledgeBases(20)
      .map(kb => kb.kbName)
      .filter(value => value.toLowerCase().startsWith(prefix));
  }

  if (name === 'research_topic' && argumentName === 'topic') {
    return getAppState()
      .listRecentSessionValues('web', 10)
      .map(value => value.split(':').slice(1).join(':'))
      .filter(Boolean)
      .filter(value => value.toLowerCase().startsWith(prefix));
  }

  return [];
}
