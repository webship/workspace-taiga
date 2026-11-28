/**
 * Taiga for Webship Workspace: a platform plugin and a provider of the tracker family.
 *
 * What the package carries is placed by the installer from the manifest: the builder and the tool in the sites
 * folders, their functions and argparse under core/scripts/plugins/taiga/ (with the compose file of Taiga's services,
 * the routes of its gateway, the script the builder runs with Taiga's own code in its back end's container, and the
 * first feature of a site), and its AI items (ai/ in this package) in the folder of their kind.
 *
 * What register() adds: the user stories of a Taiga project as work items (@webship.co/workspace-tracker): the TAIGA
 * menu on the project rows of sites and code folders that work against a Taiga project, the list (the current sprint
 * among its views), one user story, analyze, do the work with the workspace's AI CLI on a branch, and, with writes on,
 * a comment, a change of status, tags and an assignee, each a person's click after a preview. And what the assistant is
 * told.
 *
 * Everything the dashboard is asked for goes through `api`; this package requires nothing from the dashboard's own
 * files, so it can be installed from npm and removed without a trace.
 */

import type { PluginApi } from '@webship.co/workspace-plugin-api';
import { registerTracker } from '@webship.co/workspace-tracker';

import { taigaTracker } from './lib/tracker';

export { taigaTracker };

/** The plugin's name: a site is a generic project in containers that the plugin claims, and the core's tools call its functions under it. */
export const PLATFORM = 'taiga';

/** The commands the installer places in every sites folder. */
export const COMMANDS = ['cmd-taiga-project.sh', 'cmd-tools-taiga-cli.sh'];

/** The agents the installer places in the AI Agents folder. */
export const AGENTS = ['taiga-site-builder', 'taiga-tester', 'taiga-issue-worker'];

/** The skill the installer places in the AI Skills folder (a folder each, with its SKILL.md). */
export const SKILLS = ['taiga-scenarios'];

/** The slash command the installer places in the AI Commands folder. */
export const AI_COMMANDS = ['taiga-test'];

/** The prompts the installer places in the AI Prompts folder: each a whole launch command for a new session. */
export const PROMPTS = ['taiga-build-and-test', 'taiga-issue-to-branch'];

/** What the assistant is told about Taiga sites in this workspace (the user stories are told by the tracker). */
export function assistantContext(): string {
  return [
    'Taiga (a plugin, @webship.co/workspace-taiga), the open-source agile project management platform: a site is built with',
    '`bash cmd-taiga-project.sh <name> --install --add-users --sample-content` from a sites folder (dev, test, sandboxes, demos):',
    'Taiga 6.10\'s own images as its reference setup runs them (its back end, the back end\'s Celery worker, its front end, its events, its protected media, the nginx gateway and two RabbitMQ), every image pinned,',
    'on the project\'s own PostgreSQL 12 (Taiga needs PostgreSQL), on DDEV at https://<name>.ddev.site, or with `--runtime docker`, `podman` or `kubernetes` at the address the runtime gives it (the build says it).',
    'The builder asks for 2 GB of free memory before it starts. Taiga\'s telemetry is off, and so is its public sign-up.',
    '`--install` makes the workspace account the site\'s administrator;',
    '`--add-users` adds the default accounts in their roles of the Scrum project Webship site (owner: its administrator, as Product Owner; member: a member, as Back; reader: a reader that only views; stranger: not in it), each @example.com, signing in with its username;',
    '`--sample-content` adds Sprint 1 and the user stories (#1 The greeting script says Helo instead of Hello, In progress in Sprint 1, assigned to member, tagged bug, with a comment and a task; #2 The usage line spells greeting as greting, New in the backlog; #3 Add a test for the greeting, Done in Sprint 1).',
    '`bash cmd-tools-taiga-cli.sh <name>` says what the site is and lists its accounts and user stories;',
    '`--run "<command>"` runs one of Taiga\'s own management commands in its back end\'s container; `--sample-content` adds the sample content later, `--tidy` removes the user stories, tasks, sprints and comments a stopped test run left ("Webship test …"), `--add-users` and `--cancel-users` manage the default accounts (cancelling removes their application tokens too),',
    'and `--connect <login>` points the dashboard\'s Taiga at the site as that account (a new application token in the plugin\'s settings, never shown).',
    'A reader of a Taiga project reads and changes nothing; a stranger is told the project is not found. The dashboard reads and writes user stories through Taiga\'s REST API; the current sprint is its iteration view, and there is no worklog: Taiga has no time tracking of its own.',
    '`bash cmd-tools-testing.sh <name>` sets up webship-js with the Taiga step pack; `--run` runs the suite.',
    `For Taiga sites hand over to the agent \`${AGENTS[0]}\`, for testing one to \`${AGENTS[1]}\`, for working a user story to \`${AGENTS[2]}\`.`,
    `The plugin also places the skill ${SKILLS.map((a) => `\`${a}\``).join(', ')} (the step pack's phrases, by area) in ai-skills/,`,
    `the command ${AI_COMMANDS.map((a) => `\`/${a} <site>\``).join(', ')} in ai-commands/ and the prompts ${PROMPTS.map((a) => `\`${a}\``).join(' and ')} in ai-prompts/.`,
    'Never run Taiga\'s tools on the host for a project; removing the project removes its database and its files too.',
  ].join(' ');
}

export function register(api: PluginApi): void {
  registerTracker(api, taigaTracker(api));
  if (typeof api.addAssistantContext === 'function') api.addAssistantContext(assistantContext);
}
