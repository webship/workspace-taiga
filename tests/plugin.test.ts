import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { assistantContext, PLATFORM, COMMANDS, AGENTS, SKILLS, AI_COMMANDS, PROMPTS } from '../src/index';

// Compiled, these tests run from dist/tests, so the package root is one folder further up.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(PKG, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const manifest = pkg.workspacePlugin;
const FUN = read('scripts/functions/fun-taiga.sh');
const SITE = read('scripts/taiga-site.py');
const COMPOSE = read('scripts/docker-compose.taiga.yaml');
/** The part of the site script that answers one verb: its function. */
const verb = (name: string) => {
  const start = SITE.indexOf(`\ndef verb_${name}(`);
  assert.ok(start > 0, `the site script answers ${name}`);
  const next = SITE.indexOf('\ndef ', start + 10);
  return SITE.slice(start, next > 0 ? next : SITE.length);
};
const fn = (name: string) => FUN.slice(FUN.indexOf(`function ${name}()`), FUN.indexOf('\n}\n', FUN.indexOf(`function ${name}()`)) + 2);
/** A service of the compose file: its lines, up to the next service. */
const service = (name: string) => {
  const start = COMPOSE.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `the compose file has the service ${name}`);
  const next = COMPOSE.slice(start + 3).search(/\n  [a-z][a-z-]*:\n|\nvolumes:/);
  return COMPOSE.slice(start, next > 0 ? start + 3 + next : COMPOSE.length);
};

test('the manifest names the platform, and every file it names ships', () => {
  assert.strictEqual(manifest.name, PLATFORM);
  const named = [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args, ...manifest.scripts.machine,
    ...manifest.ai.agents, ...manifest.ai.skills, ...manifest.ai.commands, ...manifest.ai.prompts, ...manifest.features, manifest.settingsTemplate, manifest.labels];
  for (const f of named) assert.ok(fs.existsSync(path.join(PKG, f)), `${f} is in the package`);
  for (const f of named) assert.ok(pkg.files.includes(f.split('/')[0]), `${f} is published with the package`);
  assert.deepStrictEqual(manifest.commands.files.map((f: string) => path.basename(f)), COMMANDS);
  assert.deepStrictEqual(manifest.ai.agents.map((f: string) => path.basename(f, '.md')), AGENTS);
  assert.deepStrictEqual(manifest.ai.skills.map((f: string) => path.basename(f)), SKILLS);
  assert.deepStrictEqual(manifest.ai.commands.map((f: string) => path.basename(f, '.md')), AI_COMMANDS);
  assert.deepStrictEqual(manifest.ai.prompts.map((f: string) => path.basename(f, '.md')), PROMPTS);
  assert.deepStrictEqual(manifest.commands.types, ['sites'], 'the commands go to sites folders only');
  assert.deepStrictEqual(manifest.typeActions, { taiga: ['sites', 'code'] }, 'the TAIGA menu on the rows of sites and code folders');
  const names = manifest.scripts.machine.map((f: string) => path.basename(f));
  assert.strictEqual(new Set(names).size, names.length, 'the machine files have names of their own');
  assert.deepStrictEqual(names, ['docker-compose.taiga.yaml', 'taiga-gateway.conf', 'taiga-site.py', 'site.feature']);
  assert.deepStrictEqual(manifest.features, ['features/taiga.feature']);
  assert.strictEqual(manifest.featuresSite, undefined, 'a site for the features needs a runtime CI has: Taiga is proven on DDEV only so far');
  assert.deepStrictEqual(pkg.dependencies, { '@webship.co/workspace-tracker': '^1.0.2' });
  assert.ok(manifest.summary.length <= 110, 'the catalogue line shows at most 110 characters');
});

test('every command finds the workspace by itself, names its folder, and sources its args from where the installer puts them', () => {
  for (const f of manifest.commands.files) {
    const src = read(f);
    assert.match(src, /^#!\/usr\/bin\/env bash/, `${f} is a bash script`);
    assert.match(src, /WORKSPACE_SCRIPTS="\$\{WORKSPACE_SCRIPTS:-\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/core\/scripts" && pwd\)\}"/, `${f} locates the tooling from its own path`);
    assert.match(src, /workspace\.__WORKSPACE__\.settings\.yml/, `${f} loads the settings of the folder it is installed into`);
    assert.match(src, /source \$\{WORKSPACE_SCRIPTS\}\/plugins\/taiga\/args\/arg-[a-z-]+\.sh \|\| exit 1 ;/, `${f} reads its arguments from the plugin's args`);
    const last = src.trim().split('\n').pop() as string;
    assert.match(FUN, new RegExp(`^function ${last.replace(/ ;$/, '')}\\(\\)`, 'm'), `${f} ends by calling a function the plugin defines`);
  }
  assert.match(read('commands/cmd-taiga-project.sh'), /^# workspace-name: Taiga \(agile projects\)$/m, 'the builder carries the name the Build list shows');
  assert.doesNotMatch(read('commands/cmd-tools-taiga-cli.sh'), /^# workspace-name:/m, 'a tool is not a builder');
});

test('every shell script parses, and so does the site script', () => {
  for (const f of [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args]) {
    const r = spawnSync('bash', ['-n', path.join(PKG, f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${f}: ${r.stderr}`);
  }
  const r = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(open(sys.argv[1]).read())', path.join(PKG, 'scripts/taiga-site.py')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('the site script works with Taiga\'s own code in its back end\'s container, and each verb does what it says', () => {
  for (const name of ['version', 'install', 'accounts', 'content', 'tidy', 'list', 'token', 'counts']) verb(name);
  assert.match(SITE, /^API = 'http:\/\/localhost:8000\/api\/v1'$/m, 'Taiga\'s REST API, from inside its back end\'s container');
  assert.match(SITE, /base64\.b64decode\(raw\)/, 'what it needs comes on its input');
  assert.doesNotMatch(SITE, /sys\.argv/, 'no password on the command line');
  assert.match(SITE, /^ROLES = \{'owner': \('product-owner', True\), 'member': \('back', False\), 'reader': \('reader', False\)\}$/m, 'the roles of the sample project; stranger has none');
  assert.match(SITE, /^READER = \('Reader', 'reader', \['view_project', /m, 'a reader role that only views, since the template has none');
  const install = verb('install');
  assert.match(install, /u\.is_superuser = True/, 'the workspace account is the site\'s administrator');
  assert.match(install, /u\.set_password\(password\)/);
  const accounts = verb('accounts');
  assert.match(accounts, /ApplicationToken\.objects\.filter\(user=u\)\.delete\(\)/, 'keeping an account from signing in removes its application tokens: Taiga 6.10 still takes them');
  assert.match(accounts, /Membership\.objects\.create\(project=pr, user=u, role=r, is_admin=admin, email=u\.email\)/, 'a membership in its role');
  assert.match(SITE, /ProjectTemplate\.objects\.get\(slug='scrum'\)/, 'the project from Taiga\'s own Scrum template');
  const content = verb('content');
  assert.match(content, /owner = Session\(rows\['owner'\]\['login'\], rows\['owner'\]\['password'\]\)/, 'the content made through the REST API, as its authors');
  assert.match(content, /member\.call\('POST', '\/tasks'/, 'the member\'s task');
  const token = verb('token');
  assert.match(token, /t\.generate_token\(\)/, 'Taiga\'s own signed token, in the place of the earlier one');
  assert.match(token, /say\('TOKEN %s' % t\.token\)/);
  assert.match(token, /say\('SCOPE %s' % pr\.slug\)/, 'the sample project\'s slug for the default scope');
  assert.match(token, /os\.environ\.get\('TAIGA_SITES_DOMAIN'/, 'the application sends a person back to the site itself');
  const tidy = verb('tidy');
  assert.match(SITE, /^TEST = 'Webship test'$/m);
  assert.match(tidy, /subject__startswith=TEST, owner_id__in=ids/, 'only the default accounts\' "Webship test …" user stories');
  assert.match(tidy, /if FLAG != 'list':/, 'with list, nothing is removed');
});

test('the runtimes: DDEV only for now; another is refused before anything is changed, and so is a machine with too little memory', () => {
  assert.match(read('scripts/args/arg-taiga.sh'), /choices=\['ddev'\]/);
  const build = fn('taiga_build');
  const guard = build.indexOf('if [ "${runtime}" != \'ddev\' ] ; then');
  assert.ok(guard > 0 && guard < build.indexOf('drop_database') && guard < build.indexOf('ddev config'), 'the runtime is asked first');
  assert.ok(build.includes('Taiga builds on DDEV for now (--runtime ddev), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed.'));
  assert.ok(build.indexOf('taiga_free_memory') < build.indexOf('drop_database'), 'the free memory is asked before anything is removed');
  assert.match(FUN, /^readonly TAIGA_MEMORY_MB=2048;$/m);
  assert.match(FUN, /^readonly TAIGA_DATABASE='postgres:12';$/m, 'PostgreSQL 12, the major version Taiga\'s reference pins');
  assert.match(build, /ddev config --project-type=generic --project-name=\$\{PROJECT_NAME\} --database=\$\{TAIGA_DATABASE\} \\\n\s+--nodejs-version=\$\(ddev_nodejs_version\)/);
  assert.match(build, /for volume in "ddev-\$\{PROJECT_NAME\}-taiga-static" "ddev-\$\{PROJECT_NAME\}-taiga-media" "ddev-\$\{PROJECT_NAME\}-taiga-async-rabbitmq" "ddev-\$\{PROJECT_NAME\}-taiga-events-rabbitmq" ; do/, 'a leftover volume of a project of the same name goes too');
  assert.match(build, /\[ \$\{#account_pass\} -lt 6 \]/, 'Taiga asks a password of at least six characters');
  assert.match(read('README.md'), /\*\*The database is PostgreSQL 12\.\*\* Taiga needs PostgreSQL/, 'the README says why and which');
});

test('Taiga\'s reference setup on DDEV: every image pinned, the two changes from it said, the data in volumes named after the project', () => {
  const images: Record<string, string> = {
    TAIGA_BACK_IMAGE: 'docker.io/taigaio/taiga-back:6.10.2', TAIGA_FRONT_IMAGE: 'docker.io/taigaio/taiga-front:6.10.3',
    TAIGA_EVENTS_IMAGE: 'docker.io/taigaio/taiga-events:6.10.0', TAIGA_PROTECTED_IMAGE: 'docker.io/taigaio/taiga-protected:6.10.1',
    TAIGA_RABBITMQ_IMAGE: 'docker.io/library/rabbitmq:3.8.34-management-alpine', TAIGA_GATEWAY_IMAGE: 'docker.io/library/nginx:1.19.10-alpine',
  };
  for (const [name, image] of Object.entries(images)) {
    assert.ok(COMPOSE.includes(`"\${${name}:-${image}}"`), `${name} in the compose file, pinned to ${image}`);
    assert.ok(FUN.includes(`readonly ${name}='${image}';`), `${name} in the builder`);
  }
  assert.doesNotMatch(COMPOSE + FUN, /:latest\b/, 'never latest');
  for (const s of ['taiga-back', 'taiga-async', 'taiga-async-rabbitmq', 'taiga-front', 'taiga-events', 'taiga-events-rabbitmq', 'taiga-protected', 'taiga-gateway']) service(s);
  assert.match(service('taiga-events'), /restart: on-failure/, 'the events come back on their own');
  assert.match(service('taiga-events'), /taiga-events 6\.10\.0 exits on an unhandled rejection/, 'and the compose file says why');
  assert.match(service('taiga-async'), /taiga-back:\n\s+condition: service_started/, 'the worker starts after the back end');
  assert.match(service('taiga-async'), /mkdir …\/_data\/img: file exists/, 'and the compose file says why');
  assert.match(service('taiga-async'), /entrypoint: \["\/taiga-back\/docker\/async_entrypoint\.sh"\]/);
  for (const v of ['static', 'media', 'async-rabbitmq', 'events-rabbitmq']) assert.ok(COMPOSE.includes(`name: ddev-\${DDEV_SITENAME}-taiga-${v}`), `the ${v} volume is named after the project`);
  assert.match(service('taiga-gateway'), /HTTP_EXPOSE: "80:80"/);
  assert.match(COMPOSE, /HTTPS_EXPOSE=8457:80,8026:8025/, 'the web container moves, its mail catcher stays at :8026');
  assert.doesNotMatch(COMPOSE, /PASSWORD|SECRET_KEY=|TOKEN/, 'no secret in the compose file');
  const gateway = read('scripts/taiga-gateway.conf');
  for (const route of ['location / {', 'location /api/ {', 'location /admin/ {', 'location /events {', 'location /media/ {', 'location /_protected/ {']) assert.ok(gateway.includes(route), `the gateway routes ${route}`);
  const env = fn('taiga_write_env');
  for (const line of ['POSTGRES_HOST=db', 'TAIGA_SITES_SCHEME=https', 'TAIGA_SITES_DOMAIN=${host}', 'EMAIL_HOST=web', 'EMAIL_PORT=1025', 'ENABLE_TELEMETRY=False', 'PUBLIC_REGISTER_ENABLED=False', 'PUBLIC_REGISTER_ENABLED=false', 'TAIGA_URL=${base_url}', 'TAIGA_WEBSOCKETS_URL=wss://${host}']) {
    assert.ok(env.split('\n').includes(line), line);
  }
  assert.match(env, /\( umask 077\n/, 'taiga/*.env are their owner\'s only');
  assert.match(read('README.md'), /\*\*Two changes from the reference setup\*\*/, 'the README says both');
});

test('the functions carry the names the core\'s tools look for; --connect keeps the token off screens and command lines', () => {
  for (const name of ['set_taiga_users', 'add_taiga_users', 'cancel_taiga_users', 'testing_configure_taiga', 'taiga_build', 'taiga_cli_tool', 'taiga_connect']) {
    assert.match(FUN, new RegExp(`^function ${name}\\(\\) \\{`, 'm'), `${name} is defined`);
  }
  assert.match(FUN, /users=\(owner member reader stranger\);/);
  assert.match(FUN, /user_stranger_role='' ;/);
  assert.match(FUN, /ddev exec -s taiga-back "cd \/taiga-back && TAIGA_SITE_VERB=\$\{verb\} TAIGA_SITE_FLAG=\$\{flag\} python manage\.py shell -c/, 'with Taiga\'s own code, in its back end\'s container');
  assert.doesNotMatch(FUN, /ddev stop -y/, 'ddev stop takes no -y');
  const payload = fn('taiga_payload');
  assert.match(payload, /TAIGA_ROWS="\$1" TAIGA_LOGIN="\$\{2:-\}" python3 -c/, 'the passwords reach Python in its environment only');
  const connect = fn('taiga_connect');
  assert.match(connect, /TAIGA_NEW_TOKEN="\$\{token\}" python3/, 'the token reaches the settings writer in its environment only');
  assert.match(connect, /0o600/);
  assert.match(connect, /text = put\(text, 'username', login\)/, 'the account\'s username beside its token');
  assert.doesNotMatch(connect, /echo[^\n]*\$\{token\}/, 'the token is never printed');
  assert.match(connect, /\[\[ "\$\{token\}" =~ \^\[A-Za-z0-9_:-\]\{20,\}\$ \]\]/);
  const testing = FUN.slice(FUN.indexOf('function testing_configure_taiga()'));
  assert.match(testing, /registry="\$\{registry\}\$\{user\}\|\$\{!user_name\}\|\$\{!user_password\}\|\$\{!user_fullname\}"/, 'the pack signs in with the username and shows the full name');
  assert.match(testing, /project: process\.env\.PROJECT \|\| '%s',/, 'the project of the steps');
  assert.match(testing, /elif ! \( cd "\$\{project_path\}" && taiga_payload "\$\(taiga_rows ''\)" \| taiga_site content > \/dev\/null 2>&1 \) ; then/, 'the sample content, in the project');
});

test('the assistant is told how to build, test and connect a site, and what Taiga has', () => {
  const told = assistantContext();
  for (const c of COMMANDS) assert.ok(told.includes(c), `the assistant is told about ${c}`);
  for (const a of AGENTS) assert.ok(told.includes(a), `the assistant is told about ${a}`);
  assert.match(told, /2 GB of free memory/);
  assert.match(told, /--connect <login>/);
  assert.match(told, /PostgreSQL 12 \(Taiga needs PostgreSQL\)/);
  assert.match(told, /the current sprint is its iteration view, and there is no worklog/);
});

test('the docs say container-based, name only what ships, and carry no personal value', () => {
  const docs = ['README.md', ...manifest.ai.agents, 'scripts/functions/fun-taiga.sh', 'config/plugin.taiga.settings.yml'];
  for (const f of docs) {
    const src = read(f);
    assert.doesNotMatch(src, /DDEV-only/i, `${f}: the workspace is container-based, DDEV by default`);
    assert.doesNotMatch(src, /\/home\/(?!YOUR_USER)[a-z]/, `${f} carries no personal path`);
    const mails = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}/g) || [];
    for (const m of mails) assert.match(m, /@example\.(com|org)$/, `${f}: ${m} is not an example address`);
  }
  for (const c of COMMANDS) assert.ok(read('README.md').includes(c), `the README lists ${c}`);
  const keys = [...read('config/plugin.taiga.settings.yml').matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 13);
  for (const k of keys) assert.ok(read('README.md').includes(`\`${k}\``), `the README describes the setting ${k}`);
  assert.match(read('README.md'), /^## What the plugin does not do yet$/m);
  assert.match(read('README.md'), /\*\*A worklog\.\*\* Taiga has no time tracking of its own/);
  assert.match(read('README.md'), /Taiga 6\.10\.2 still takes the application\ntoken of an account that may not sign in/);
});
