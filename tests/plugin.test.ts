import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
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

/** Remove a folder of this file's tests, never a path outside one. */
function removeTestDir(dir: string): void {
  const parts = path.relative(os.tmpdir(), path.resolve(dir)).split(path.sep);
  assert.ok(parts.length === 1 && /^taiga-runtimes-[A-Za-z0-9]{6}$/.test(parts[0]), `refused to remove ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

/** What the builder writes for a runtime, with the runtime layer stood in: its calls, the web image's lines, the files. */
function written(runtime: string, address: string): { calls: string[], dockerfile: string, files: string[], read: (f: string) => string, mode: (f: string) => number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taiga-runtimes-'));
  try {
    const plugin = path.join(dir, 'scripts', 'plugins', 'taiga');
    fs.mkdirSync(plugin, { recursive: true });
    for (const f of manifest.scripts.machine) fs.copyFileSync(path.join(PKG, f), path.join(plugin, path.basename(f)));
    const project = path.join(dir, 'mysite');
    fs.mkdirSync(path.join(project, '.ddev'), { recursive: true });
    const stand = [
      'rt_claim() { echo "rt_claim $*" >> "$LOG" ; }',
      'rt_stack() { echo "rt_stack $*" >> "$LOG" ; }',
      'rt_web_build() { echo "rt_web_build $*" >> "$LOG" ; cat > "$LOG.dockerfile" ; }',
      'rt_service() { echo "rt_service $*" >> "$LOG" ; }',
      'rt_serve() { echo "rt_serve $1 [$2]" >> "$LOG" ; }',
    ].join('\n');
    const script = `${stand}\nsource "${path.join(PKG, 'scripts/functions/fun-taiga.sh')}"\ntaiga_write_config "${project}" ${runtime} && taiga_write_env "${project}" "${address}" ${runtime}`;
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, WORKSPACE_SCRIPTS: path.join(dir, 'scripts'), LOG: path.join(dir, 'calls.log') } });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const log = path.join(dir, 'calls.log');
    // A folder is listed with a slash, and only its name.
    const list = (d: string): string[] => fs.readdirSync(path.join(project, d)).map((f) => `${d}/${f}${fs.statSync(path.join(project, d, f)).isDirectory() ? '/' : ''}`);
    const files = [...list('.ddev'), ...list('taiga')].sort();
    const contents: Record<string, string> = {};
    const modes: Record<string, number> = {};
    for (const f of files.filter((x) => !x.endsWith('/'))) { contents[f] = fs.readFileSync(path.join(project, f), 'utf8'); modes[f] = fs.statSync(path.join(project, f)).mode & 0o777; }
    if (fs.existsSync(path.join(project, 'taiga', 'files', 'media'))) files.push('taiga/files/media/');
    return {
      calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [],
      dockerfile: fs.existsSync(`${log}.dockerfile`) ? fs.readFileSync(`${log}.dockerfile`, 'utf8') : '',
      files,
      read: (f: string) => contents[f],
      mode: (f: string) => modes[f],
    };
  } finally {
    removeTestDir(dir);
  }
}

/** The lines of a site value file, without its comments. */
const values = (text: string) => text.split('\n').filter((l) => l && !l.startsWith('#'));

/** The web container's start script up to its own output's pipe, run with a given /etc/resolv.conf: what it writes for nginx. */
function upstreamFor(resolvConf: string): { status: number, out: string, conf: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taiga-runtimes-'));
  try {
    fs.writeFileSync(path.join(dir, 'resolv.conf'), resolvConf);
    fs.writeFileSync(path.join(dir, 'env'), '');
    const lines = read('scripts/taiga-serve.sh').split('\n');
    const script = lines.slice(0, lines.findIndex((l) => l.startsWith('exec > >(cat)'))).join('\n')
      .replace('here="$(cd "$(dirname "$0")" && pwd)"', `here="${dir}"`)
      .replace(/\/etc\/resolv\.conf/g, path.join(dir, 'resolv.conf')).replace(/\/tmp\/taiga-nginx/g, path.join(dir, 'nginx'));
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    const conf = path.join(dir, 'nginx', 'services.conf');
    return { status: r.status ?? 1, out: r.stdout + r.stderr, conf: fs.existsSync(conf) ? fs.readFileSync(conf, 'utf8') : '' };
  } finally {
    removeTestDir(dir);
  }
}

/** The web container's start script with Taiga's programs stood in (python, gunicorn, celery, nginx): how it ends. A
 * stopTerm asks the script to stop (TERM) after that many milliseconds, as a container's stop does. */
function served(programs: Record<string, string>, stopTerm = 0): { status: number | null, out: string, seconds: number, log: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taiga-runtimes-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(dir, 'back'));
    fs.writeFileSync(path.join(dir, 'env'), 'POSTGRES_HOST=db\n');
    fs.writeFileSync(path.join(dir, 'resolv.conf'), 'nameserver 127.0.0.11\n');
    const log = path.join(dir, 'calls.log');
    for (const [name, body] of Object.entries(programs)) {
      fs.writeFileSync(path.join(bin, name), [
        '#!/usr/bin/env bash',
        `echo "${name} $*" >> "${log}"`,
        `trap 'kill "\${child:-}" 2> /dev/null ; echo "${name} stopped" >> "${log}" ; exit 143' TERM`,
        body,
        '',
      ].join('\n'), { mode: 0o755 });
    }
    const script = read('scripts/taiga-serve.sh')
      .replace('here="$(cd "$(dirname "$0")" && pwd)"', `here="${dir}"`)
      .replace(/\/etc\/resolv\.conf/g, path.join(dir, 'resolv.conf')).replace(/\/tmp\/taiga-nginx/g, path.join(dir, 'nginx'))
      .replace('cd /taiga-back || exit 1', `cd "${path.join(dir, 'back')}" || exit 1`)
      .replace('export PATH="/opt/venv/bin:${PATH}"', `export PATH="${bin}:\${PATH}"`);
    fs.writeFileSync(path.join(dir, 'serve.sh'), script);
    const started = Date.now();
    const r = spawnSync('bash', [path.join(dir, 'serve.sh')], { encoding: 'utf8', timeout: stopTerm || 30000, killSignal: 'SIGTERM' });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), seconds: (Date.now() - started) / 1000, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [] };
  } finally {
    removeTestDir(dir);
  }
}

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
  assert.deepStrictEqual(names, ['docker-compose.taiga.yaml', 'taiga-gateway.conf', 'taiga-site.py', 'taiga-serve.sh', 'taiga-proxy.conf', 'site.feature']);
  assert.deepStrictEqual(manifest.features, ['features/taiga.feature', 'features/taiga-runtimes.feature']);
  assert.strictEqual(manifest.featuresSite, 'cmd-taiga-project.sh ci-taiga --install --add-users --sample-content --runtime docker', 'CI builds a site on Docker Compose for the features');
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
  for (const name of ['version', 'brokers', 'install', 'accounts', 'content', 'tidy', 'list', 'token', 'counts']) verb(name);
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

test('the runtimes: DDEV, Docker Compose, Podman and Kubernetes; another is refused before anything is changed, and so is a machine with too little memory', () => {
  assert.match(read('scripts/args/arg-taiga.sh'), /choices=\['ddev', 'docker', 'podman', 'kubernetes'\]/);
  const build = fn('taiga_build');
  const guard = build.indexOf('case "${runtime}" in');
  const services = build.indexOf('! declare -f rt_service > /dev/null');
  const restart = build.indexOf('! declare -f rt_service_restart > /dev/null');
  assert.ok(guard > 0 && guard < build.indexOf('drop_database') && guard < build.indexOf('ddev config'), 'the runtime is asked first');
  assert.match(build, /case "\$\{runtime\}" in\n\s+ddev\|docker\|podman\|kubernetes\) ;;/, 'the four runtimes the plugin was proven on');
  assert.ok(build.includes('Taiga builds on DDEV, Docker Compose, Podman and Kubernetes for now (--runtime ddev, docker, podman or kubernetes), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed.'));
  assert.ok(services > guard && services < build.indexOf('drop_database'), 'a workspace whose runtimes run no service of a project\'s own is told so before anything is removed');
  assert.ok(restart > services && restart < build.indexOf('drop_database'), 'and so is one whose services do not come back, before anything is removed');
  assert.match(build, /if \{ \[ "\$\{runtime\}" = 'docker' \] \|\| \[ "\$\{runtime\}" = 'podman' \] ; \} && ! declare -f rt_service_restart > \/dev\/null ; then/, 'on Docker Compose and Podman only: Kubernetes starts a service again by itself');
  assert.ok(build.includes('(rt_service_restart, webship/workspace#959, core 1.0.45)'), 'the builder names the core it needs');
  assert.ok(build.indexOf('taiga_free_memory') < build.indexOf('drop_database'), 'the free memory is asked before anything is removed');
  assert.match(FUN, /^readonly TAIGA_MEMORY_MB=2048;$/m);
  assert.match(FUN, /^readonly TAIGA_DATABASE='postgres:12';$/m, 'PostgreSQL 12, the major version Taiga\'s reference pins');
  assert.match(build, /ddev config --project-type=generic --project-name=\$\{PROJECT_NAME\} --database=\$\{TAIGA_DATABASE\} \\\n\s+--nodejs-version=\$\(ddev_nodejs_version\)/, 'DDEV as before');
  assert.match(build, /ddev config --project-type=generic --webserver-type=generic --project-name=\$\{PROJECT_NAME\} --database=\$\{TAIGA_DATABASE\} --auto/, 'elsewhere the runtime\'s own project, on PostgreSQL 12 too');
  assert.ok(build.indexOf('base_url="$(taiga_url)"') > build.indexOf('taiga_write_config'), 'the address is read once the runtime has given the project its port');
  const env = build.indexOf('taiga_write_env "${project_path}" "${base_url}" "${runtime}"');
  const again = build.indexOf('if [ "${runtime}" = \'kubernetes\' ] ; then\n    ( cd "${project_path}" && ddev config < /dev/null > /dev/null ) || exit 1 ;');
  assert.ok(env > 0 && again > env && again < build.indexOf('ddev_up start'), 'on Kubernetes the project\'s files are written again once the site\'s values are there: its Secrets take the env files then');
  assert.match(build, /for volume in "ddev-\$\{PROJECT_NAME\}-taiga-static" "ddev-\$\{PROJECT_NAME\}-taiga-media" "ddev-\$\{PROJECT_NAME\}-taiga-async-rabbitmq" "ddev-\$\{PROJECT_NAME\}-taiga-events-rabbitmq" ; do/, 'a leftover volume of a project of the same name goes too');
  assert.match(build, /\[ \$\{#account_pass\} -lt 6 \]/, 'Taiga asks a password of at least six characters');
  assert.match(read('README.md'), /\*\*The database is PostgreSQL 12\.\*\* Taiga needs PostgreSQL/, 'the README says why and which');
});

test('Taiga\'s reference setup on DDEV: every image pinned, the four changes from it said, the data in volumes named after the project, the media in its folder', () => {
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
  const back = COMPOSE.slice(COMPOSE.indexOf('x-taiga-back: &taiga-back'), COMPOSE.indexOf('x-rabbitmq: &rabbitmq'));
  assert.match(back, /\n  user: "\$\{DDEV_UID\}:\$\{DDEV_GID\}"\n/, 'the back end and its worker as the project\'s user');
  assert.match(back, /\n    - \$\{DDEV_APPROOT\}\/taiga\/files\/media:\/taiga-back\/media\n/, 'their media in the project folder');
  assert.match(back, /\n    HOME: \/tmp\n/);
  assert.match(service('taiga-back'), /entrypoint: \["bash", "-c", "set -euo pipefail ; python manage\.py migrate ; python manage\.py loaddata initial_project_templates ; exec gunicorn taiga\.wsgi:application --name taiga_api --bind 0\.0\.0\.0:8000 --workers 3 --worker-tmp-dir \/dev\/shm --log-level=info --access-logfile -"\]/, 'the image\'s start without its owner step');
  assert.match(service('taiga-async'), /entrypoint: \["celery", "-A", "taiga\.celery", "worker", "-B", "--concurrency", "4", "-l", "INFO", "--schedule", "\/tmp\/taiga-celerybeat-schedule"\]/, 'the worker\'s too, its schedule in /tmp');
  assert.doesNotMatch(COMPOSE, /gosu|chown|async_entrypoint/, 'nothing that only root may do');
  assert.match(service('taiga-async'), /takes a worker whose group has no name in the image[^]*\n    environment:\n      HOME: \/tmp\n      C_FORCE_ROOT: "true"\n/, 'the worker starts as the project\'s user, which Celery takes for root without a group name, and the compose file says why');
  assert.match(service('taiga-gateway'), /\n      - \$\{DDEV_APPROOT\}\/taiga\/files\/media:\/taiga\/media:ro\n/, 'the gateway reads the media from the project folder');
  for (const v of ['static', 'async-rabbitmq', 'events-rabbitmq']) assert.ok(COMPOSE.includes(`name: ddev-\${DDEV_SITENAME}-taiga-${v}`), `the ${v} volume is named after the project`);
  assert.doesNotMatch(COMPOSE, /taiga-media|\n\s+- media:|\n  media:\n/, 'no media volume');
  assert.match(service('taiga-gateway'), /HTTP_EXPOSE: "80:80"/);
  assert.match(COMPOSE, /HTTPS_EXPOSE=8457:80,8026:8025/, 'the web container moves, its mail catcher stays at :8026');
  assert.doesNotMatch(COMPOSE, /PASSWORD|SECRET_KEY=|TOKEN/, 'no secret in the compose file');
  const gateway = read('scripts/taiga-gateway.conf');
  for (const route of ['location / {', 'location /api/ {', 'location /admin/ {', 'location /events {', 'location /media/ {', 'location /_protected/ {']) assert.ok(gateway.includes(route), `the gateway routes ${route}`);
  const env = fn('taiga_write_env');
  assert.match(env, /\( umask 077\n/, 'taiga/*env are their owner\'s only');
  const ddev = written('ddev', 'https://mysite.ddev.site');
  assert.deepStrictEqual(ddev.calls, [], 'DDEV: no call of the runtime layer');
  assert.deepStrictEqual(ddev.files, ['.ddev/.env', '.ddev/config.taiga.yaml', '.ddev/docker-compose.taiga.yaml', 'taiga/env', 'taiga/events.env', 'taiga/files/', 'taiga/front.env', 'taiga/gateway.conf', 'taiga/protected.env', 'taiga/rabbitmq.env', 'taiga/taiga-site.py', 'taiga/files/media/'], 'DDEV: the files it had, and the media\'s folder, made before the services start');
  for (const line of ['POSTGRES_HOST=db', 'TAIGA_SITES_SCHEME=https', 'TAIGA_SITES_DOMAIN=mysite.ddev.site', 'EMAIL_HOST=web', 'EMAIL_PORT=1025', 'ENABLE_TELEMETRY=False', 'PUBLIC_REGISTER_ENABLED=False']) {
    assert.ok(values(ddev.read('taiga/env')).includes(line), line);
  }
  for (const line of ['PUBLIC_REGISTER_ENABLED=false', 'TAIGA_URL=https://mysite.ddev.site', 'TAIGA_WEBSOCKETS_URL=wss://mysite.ddev.site']) assert.ok(values(ddev.read('taiga/front.env')).includes(line), line);
  assert.doesNotMatch(ddev.read('taiga/env'), /COOKIE_SECURE/, 'DDEV: https, Taiga\'s own cookie settings');
  assert.doesNotMatch(ddev.read('taiga/rabbitmq.env'), /RABBITMQ_NODENAME/, 'DDEV: each RabbitMQ\'s host name is its own, as before');
  for (const f of ['taiga/env', 'taiga/rabbitmq.env', 'taiga/front.env', 'taiga/events.env', 'taiga/protected.env']) assert.strictEqual(ddev.mode(f), 0o600, `${f} is its owner's only`);
  const readme = read('README.md');
  assert.match(readme, /\*\*Four changes from the reference setup\*\*/, 'the README says the four');
  const upgrade = readme.slice(readme.indexOf('### Upgrading a DDEV site from 1.0.0'), readme.indexOf('### The default accounts'));
  const steps = ['mkdir -p taiga/files/media', 'docker cp ddev-mysite-taiga-back:/taiga-back/media/. taiga/files/media/', 'cp ~/workspace/core/scripts/plugins/taiga/docker-compose.taiga.yaml .ddev/', 'ddev restart', 'docker volume rm ddev-mysite-taiga-media'];
  for (let i = 1; i < steps.length; i++) assert.ok(upgrade.indexOf(steps[i - 1]) >= 0 && upgrade.indexOf(steps[i - 1]) < upgrade.indexOf(steps[i]), `the upgrade of a 1.0.0 DDEV site, in order: ${steps[i]}`);
  assert.match(readme, /in the project's `taiga\/files\/media` on\n  every runtime, which the row's Backup holds/, 'the Backup holds the media on every runtime');
});

test('on Docker Compose, Podman and Kubernetes: Taiga\'s back-end image as the web container\'s, its other services under DDEV\'s names', () => {
  for (const runtime of ['docker', 'podman', 'kubernetes']) {
    const w = written(runtime, 'http://127.0.0.1:33001');
    assert.deepStrictEqual(w.calls, [
      'rt_claim taiga',
      'rt_stack image docker.io/taigaio/taiga-back:6.10.2',
      'rt_web_build taiga',
      'rt_service taiga-front docker.io/taigaio/taiga-front:6.10.3 --port 80 --env-file taiga/front.env',
      'rt_service taiga-events docker.io/taigaio/taiga-events:6.10.0 --port 8888 --env-file taiga/events.env',
      'rt_service taiga-protected docker.io/taigaio/taiga-protected:6.10.1 --port 8003 --env-file taiga/protected.env',
      'rt_service taiga-events-rabbitmq docker.io/library/rabbitmq:3.8.34-management-alpine --port 5672 --env-file taiga/rabbitmq.env --volume /var/lib/rabbitmq',
      'rt_service taiga-async-rabbitmq docker.io/library/rabbitmq:3.8.34-management-alpine --port 5672 --env-file taiga/rabbitmq.env --volume /var/lib/rabbitmq',
      'rt_serve 8080 [bash taiga/taiga-serve.sh]',
    ], runtime);
    // The web image: the stack's start, not the image's own (which runs Taiga as its taiga user), nginx, and the media
    // in the project's folder.
    assert.match(w.dockerfile, /^ENTRYPOINT \[\]$/m, `${runtime}: the stack's start runs`);
    assert.match(w.dockerfile, /apt-get install -y --no-install-recommends nginx/, `${runtime}: the gateway's nginx`);
    assert.match(w.dockerfile, /rm -rf \/taiga-back\/media && ln -s \/var\/www\/html\/taiga\/files\/media \/taiga-back\/media/, `${runtime}: the media in the project's folder`);
    assert.deepStrictEqual(w.files, ['taiga/env', 'taiga/events.env', 'taiga/front.env', 'taiga/nginx.conf', 'taiga/protected.env', 'taiga/rabbitmq.env', 'taiga/taiga-serve.sh', 'taiga/taiga-site.py'], `${runtime}: no DDEV file`);
    assert.strictEqual(w.read('taiga/nginx.conf'), read('scripts/taiga-proxy.conf'), `${runtime}: the gateway's settings`);
    assert.strictEqual(w.read('taiga/taiga-serve.sh'), read('scripts/taiga-serve.sh'));
    // The site's values at a plain http address.
    const env = values(w.read('taiga/env'));
    for (const line of ['POSTGRES_HOST=db', 'TAIGA_SITES_SCHEME=http', 'TAIGA_SITES_DOMAIN=127.0.0.1:33001', 'EMAIL_HOST=mail', 'EMAIL_PORT=1025', 'SESSION_COOKIE_SECURE=False', 'CSRF_COOKIE_SECURE=False']) assert.ok(env.includes(line), `${runtime}: ${line}`);
    for (const line of ['TAIGA_URL=http://127.0.0.1:33001', 'TAIGA_WEBSOCKETS_URL=ws://127.0.0.1:33001']) assert.ok(values(w.read('taiga/front.env')).includes(line), `${runtime}: ${line}`);
    assert.ok(values(w.read('taiga/rabbitmq.env')).includes('RABBITMQ_NODENAME=rabbit@localhost'), `${runtime}: each RabbitMQ's data stays its own when its container gets another host name`);
    for (const f of ['taiga/env', 'taiga/rabbitmq.env', 'taiga/front.env', 'taiga/events.env', 'taiga/protected.env']) assert.strictEqual(w.mode(f), 0o600, `${runtime}: ${f} is its owner's only`);
  }
  // At an https address of another runtime, Taiga's own cookie settings stay, and the events go over wss://.
  const https = written('kubernetes', 'https://taiga.example.org');
  assert.doesNotMatch(https.read('taiga/env'), /COOKIE_SECURE/);
  assert.ok(values(https.read('taiga/front.env')).includes('TAIGA_WEBSOCKETS_URL=wss://taiga.example.org'));
});

test('the web container\'s start: Taiga\'s migrations first, then its API, its Celery worker and the gateway; when one of the three stops, the others and the container stop too', () => {
  const serve = read('scripts/taiga-serve.sh');
  const order = ['. "${here}/env"', 'python manage.py migrate --noinput', 'python manage.py loaddata initial_project_templates', 'gunicorn taiga.wsgi:application', 'celery -A taiga.celery worker -B', "nginx -e stderr -c \"${here}/nginx.conf\""];
  for (let i = 1; i < order.length; i++) assert.ok(serve.indexOf(order[i - 1]) >= 0 && serve.indexOf(order[i - 1]) < serve.indexOf(order[i]), `${order[i - 1]} before ${order[i]}`);
  assert.match(serve, /--bind 127\.0\.0\.1:8000/, 'the API behind the gateway, in the container only');
  assert.match(serve, /--schedule \/tmp\/taiga-celerybeat-schedule/, 'the scheduler keeps its schedule where the host user can write');
  assert.match(serve, /^export PATH="\/opt\/venv\/bin:\$\{PATH\}" DJANGO_SETTINGS_MODULE='settings\.config'$/m, 'the image\'s own Python and Taiga\'s settings');
  assert.match(serve, /^wait -n "\$\{api\}" "\$\{worker\}" "\$\{gateway\}"$/m, 'the first of the three to stop');
  assert.doesNotMatch(serve, /^\s*wait\s*$/m, 'never a plain wait: it would also wait for the output\'s pipe, which never ends');

  const forever = 'sleep 25 > /dev/null 2>&1 & child=$! ; wait "${child}"';
  // The Celery worker stops on its own (code 3): the API and the gateway stop, and so does the container, with its code.
  let r = served({ python: 'exit 0', gunicorn: forever, celery: 'sleep 1 ; exit 3', nginx: forever });
  assert.strictEqual(r.status, 3, r.out);
  assert.ok(r.seconds < 15, `it stopped at once (${r.seconds} s)`);
  assert.match(r.out, /Taiga's API, its Celery worker or its gateway stopped \(code 3\): the others stop, and the container with them\./);
  for (const p of ['gunicorn stopped', 'nginx stopped']) assert.ok(r.log.includes(p), `${p}: ${r.log.join(' | ')}`);
  assert.deepStrictEqual(r.log.filter((l) => l.startsWith('python ')), ['python manage.py migrate --noinput', 'python manage.py loaddata initial_project_templates'], 'the migrations and the templates first');
  // One that ends with 0 is a stop too: the container ends with 1, never 0.
  r = served({ python: 'exit 0', gunicorn: forever, celery: forever, nginx: 'sleep 1 ; exit 0' });
  assert.strictEqual(r.status, 1, r.out);
  // The migrations fail (no database): nothing else starts.
  r = served({ python: 'exit 2', gunicorn: forever, celery: forever, nginx: forever });
  assert.strictEqual(r.status, 1, r.out);
  assert.ok(!r.log.some((l) => /^(gunicorn|celery|nginx) /.test(l)), 'no server without the migrations');
  // The container is asked to stop: the three stop, and the script ends with 143.
  r = served({ python: 'exit 0', gunicorn: forever, celery: forever, nginx: forever }, 3000);
  assert.strictEqual(r.status, 143, r.out);
  for (const p of ['gunicorn stopped', 'celery stopped', 'nginx stopped']) assert.ok(r.log.includes(p), `${p}: ${r.log.join(' | ')}`);
  assert.ok(r.seconds < 15, `it stopped at once (${r.seconds} s)`);
  assert.match(read('README.md'), /\*\*The web container stops when its API, its Celery worker or its gateway stops\*\*/, 'the README says it');
});

test('the gateway looks Taiga\'s services up while it runs, by the container\'s own DNS server, under the names each runtime answers', () => {
  const services = (host: string, suffix: string) => `resolver ${host} valid=5s ipv6=off;\nset $taiga_front http://taiga-front${suffix}:80;\nset $taiga_events http://taiga-events${suffix}:8888;\nset $taiga_protected http://taiga-protected${suffix}:8003;\n`;
  assert.strictEqual(upstreamFor('nameserver 127.0.0.11\nsearch example.org\noptions ndots:0\n').conf, services('127.0.0.11', ''), 'Docker Compose: its own DNS answers the services\' names');
  assert.strictEqual(upstreamFor('search dns.podman\nnameserver 10.89.0.1\n').conf, services('10.89.0.1', ''), 'Podman: aardvark-dns answers them');
  assert.strictEqual(upstreamFor('search ws-mysite.svc.cluster.local svc.cluster.local cluster.local\nnameserver 10.96.0.10\noptions ndots:5\n').conf,
    services('10.96.0.10', '.ws-mysite.svc.cluster.local'), 'Kubernetes: each Service by its whole name, in the project\'s namespace');
  assert.strictEqual(upstreamFor('nameserver fd00::1\n').conf, services('[fd00::1]', ''), 'an IPv6 DNS server, in brackets');
  const none = upstreamFor('# none\n');
  assert.notStrictEqual(none.status, 0, 'no DNS server: the server stops, saying so');
  assert.match(none.out, /no DNS server in /);
});

test('the gateway\'s settings on the other runtimes: the routes of DDEV\'s gateway, Taiga\'s API in the web container, nginx as the host user', () => {
  const proxy = read('scripts/taiga-proxy.conf');
  const gateway = read('scripts/taiga-gateway.conf');
  const routes = (text: string) => [...text.matchAll(/^\s+location (\S+) \{/gm)].map((m) => m[1]);
  assert.deepStrictEqual(routes(proxy), routes(gateway), 'the same routes as the reference\'s gateway');
  assert.match(proxy, /listen 8080 default_server;/);
  assert.match(fn('taiga_write_config'), /rt_serve "\$\{TAIGA_SERVE_PORT\}"/);
  assert.match(FUN, /^readonly TAIGA_SERVE_PORT=8080;$/m);
  assert.match(proxy, /location \/api\/ \{\n\s+proxy_pass http:\/\/127\.0\.0\.1:8000\/api\/;/, 'the API in the web container');
  assert.match(proxy, /location \/admin\/ \{\n\s+proxy_pass http:\/\/127\.0\.0\.1:8000\/admin\/;/);
  assert.match(proxy, /location \/ \{\n\s+proxy_pass \$taiga_front;/, 'the front end, looked up while nginx runs');
  assert.match(proxy, /location \/events \{\n\s+proxy_pass \$taiga_events;\n\s+proxy_http_version 1\.1;\n\s+proxy_set_header Upgrade \$http_upgrade;/, 'the events\' websocket');
  assert.match(proxy, /location \/media\/ \{[^}]*rewrite \^\/media\/\(\.\*\)\$ \/\$1 break;\n\s+proxy_pass \$taiga_protected;/, 'the media through the protected service, as the reference passes them (without /media/)');
  assert.match(proxy, /location \/_protected\/ \{\n\s+internal;\n\s+alias \/var\/www\/html\/taiga\/files\/media\/;/, 'the protected service\'s answer, from the project\'s folder');
  assert.match(proxy, /location \/static\/ \{\n\s+alias \/taiga-back\/static\/;/, 'the image\'s own static files');
  assert.match(proxy, /include \/tmp\/taiga-nginx\/services\.conf;/);
  for (const line of ['pid /tmp/taiga-nginx/nginx.pid;', 'error_log stderr warn;', 'client_body_temp_path /tmp/taiga-nginx/body;', 'proxy_temp_path /tmp/taiga-nginx/proxy;', 'include /etc/nginx/mime.types;']) assert.ok(proxy.includes(line), line);
});

test('on the other runtimes Taiga\'s probe, its site script, its commands and its logs reach its back end in the web container', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taiga-runtimes-'));
  try {
    const log = path.join(dir, 'calls.log');
    const run = (runtime: string, line: string) => {
      const script = [
        `source "${path.join(PKG, 'scripts/functions/fun-taiga.sh')}"`,
        `runtime_of() { echo ${runtime} ; }`,
        `ddev() { printf '%s\\n' "ddev $*" >> "${log}" ; echo 200 ; }`,
        `rt_find_project() { echo "${runtime} ${dir}" ; }`,
        `rt_dc() { echo "rt_dc $*" >> "${log}" ; }`,
        `rt_kubectl() { echo "rt_kubectl $*" >> "${log}" ; }`,
        `rt_k8s_ns() { echo ws-mysite ; }`,
        line,
      ].join('\n');
      fs.rmSync(log, { force: true });
      const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', input: '' });
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    };
    assert.deepStrictEqual(run('ddev', 'taiga_probe > /dev/null'), ["ddev exec curl -s -o /dev/null -m 15 -w '%{http_code}' http://taiga-gateway/api/v1/"], 'DDEV: the gateway\'s own container');
    assert.deepStrictEqual(run('docker', 'taiga_probe > /dev/null'), ["ddev exec curl -s -o /dev/null -m 15 -w '%{http_code}' http://127.0.0.1:8080/api/v1/"], 'elsewhere: the gateway in the web container');
    assert.deepStrictEqual(run('ddev', 'taiga_site version'), ["ddev exec -s taiga-back cd /taiga-back && TAIGA_SITE_VERB=version TAIGA_SITE_FLAG= python manage.py shell -c \"exec(open('/opt/webship/taiga-site.py').read())\""], 'DDEV: as before');
    assert.deepStrictEqual(run('podman', 'taiga_site counts'), ["ddev exec set -a ; . /var/www/html/taiga/env ; set +a ; export PATH=/opt/venv/bin:$PATH DJANGO_SETTINGS_MODULE=settings.config ; cd /taiga-back && TAIGA_SITE_VERB=counts TAIGA_SITE_FLAG= python manage.py shell -c \"exec(open('/var/www/html/taiga/taiga-site.py').read())\""], 'elsewhere: in the web container, with the site\'s values and the image\'s Python');
    assert.deepStrictEqual(run('kubernetes', 'taiga_back_exec "python manage.py check"'), ['ddev exec set -a ; . /var/www/html/taiga/env ; set +a ; export PATH=/opt/venv/bin:$PATH DJANGO_SETTINGS_MODULE=settings.config ; cd /taiga-back && python manage.py check']);
    assert.deepStrictEqual(run('docker', 'taiga_service_log taiga-back 40'), [`rt_dc docker ${dir} logs --tail 40 web`], 'the back end is the web container there');
    assert.deepStrictEqual(run('kubernetes', 'taiga_service_log taiga-events 10'), ['rt_kubectl -n ws-mysite logs deploy/taiga-events --tail 10']);
    assert.deepStrictEqual(run('ddev', 'taiga_service_log taiga-back 40'), ['ddev logs -s taiga-back --tail 40']);
  } finally {
    removeTestDir(dir);
  }
  assert.match(fn('taiga_cli_tool'), /taiga_back_exec "python manage\.py \$\(printf '%q ' "\$\{words\[@\]\}"\)" < \/dev\/null ;/, 'Taiga\'s own commands too');
});

test('before Taiga\'s installer, on every runtime, the builder waits until both RabbitMQ take connections, and names the one that does not', () => {
  const brokers = verb('brokers');
  assert.match(brokers, /\('taiga-async-rabbitmq', settings\.CELERY_BROKER_URL\), \('taiga-events-rabbitmq', settings\.EVENTS_PUSH_BACKEND_URL\)/, 'the URLs Taiga itself uses');
  assert.match(brokers, /connection\.ensure_connection\(max_retries=0\)/, 'one attempt each: the builder asks again');
  assert.match(brokers, /re\.sub\(r'amqps\?:\/\/\\S\+', 'its address', why\)/, 'never the URL, which carries the password');
  assert.match(FUN, /^readonly TAIGA_BROKERS_WAIT=180;$/m, 'three minutes');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taiga-runtimes-'));
  try {
    const answers = path.join(dir, 'answers');
    const count = path.join(dir, 'n');
    /** The wait, with the site script's answers stood in: each call answers the next line (its two brokers, | between them), the last one again; sleep only moves the clock. */
    const run = (lines: string[]) => {
      fs.writeFileSync(answers, lines.join('\n') + '\n');
      fs.rmSync(count, { force: true });
      const script = [
        `source "${path.join(PKG, 'scripts/functions/fun-taiga.sh')}"`,
        `taiga_site() { local n last ; n=$(( $(cat "${count}" 2> /dev/null || echo 0) + 1 )) ; echo "$n" > "${count}" ; last=$(wc -l < "${answers}") ; [ "$n" -gt "$last" ] && n=$last ; sed -n "\${n}p" "${answers}" | tr '|' '\\n' ; }`,
        'sleep() { SECONDS=$(( SECONDS + $1 )) ; }',
        'taiga_service_log() { echo "LOG $1 $2" ; }',
        `taiga_brokers_wait ; echo "EXIT $? CALLS $(cat "${count}")"`,
      ].join('\n');
      const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', input: '' });
      return r.stdout + r.stderr;
    };
    let out = run(['BROKER taiga-async-rabbitmq ok|BROKER taiga-events-rabbitmq ok']);
    assert.strictEqual(out.trim(), 'EXIT 0 CALLS 1', 'both take connections: nothing to wait for, nothing said');
    out = run(['BROKER taiga-async-rabbitmq [Errno 111] Connection refused|BROKER taiga-events-rabbitmq ok', '', 'BROKER taiga-async-rabbitmq ok|BROKER taiga-events-rabbitmq ok']);
    assert.match(out, /^Waiting for Taiga's RabbitMQ before its installer: taiga-async-rabbitmq \(\[Errno 111\] Connection refused\)\.$/m, 'said once, with the one it waits for and why');
    assert.strictEqual(out.match(/^Waiting for/gm)?.length, 1);
    assert.match(out, /^Taiga's RabbitMQ take connections now, after 10 s\.$/m, 'a back end that did not answer once is asked again too');
    assert.match(out, /EXIT 0 CALLS 3$/m);
    out = run(['BROKER taiga-async-rabbitmq ok|BROKER taiga-events-rabbitmq [Errno -2] Name or service not known']);
    assert.match(out, /^Taiga's RabbitMQ did not take connections in 180 s: taiga-events-rabbitmq \(\[Errno -2\] Name or service not known\)\. The end of the log of each:$/m, 'the one that did not, named, with why');
    assert.match(out, /^LOG taiga-events-rabbitmq 20$/m);
    assert.doesNotMatch(out, /LOG taiga-async-rabbitmq/, 'not the one that did');
    assert.match(out, /EXIT 1 CALLS 37$/m, 'asked every 5 s for three minutes, then it stops');
    out = run(['BROKER taiga-async-rabbitmq [Errno 111] Connection refused|BROKER taiga-events-rabbitmq [Errno 111] Connection refused']);
    assert.match(out, /in 180 s: taiga-async-rabbitmq \(\[Errno 111\] Connection refused\); taiga-events-rabbitmq \(\[Errno 111\] Connection refused\)\. /, 'both, when both did not');
    assert.match(out, /^LOG taiga-async-rabbitmq 20\nLOG taiga-events-rabbitmq 20$/m);
    out = run(['']);
    assert.match(out, /^Taiga's back end did not answer to ask its RabbitMQ \(taiga-async-rabbitmq, taiga-events-rabbitmq\) in 180 s; the end of its log:\nLOG taiga-back 20\nEXIT 1 CALLS 37$/m, 'a back end that never answers: said so, with its log');
  } finally {
    removeTestDir(dir);
  }
  const build = FUN.slice(FUN.indexOf('  ddev_up start -y < /dev/null || exit 1 ;\n  taiga_wait || exit 1 ;\n'));
  const wait = build.indexOf('    taiga_brokers_wait || { echo "Taiga could not be set up." ; exit 1 ; } ;\n');
  assert.ok(wait > 0 && wait < build.indexOf('| taiga_site install'), 'after its API answers and before its installer, whatever the runtime: it stops the build when they do not');
});

test('Taiga\'s database in the core\'s backups and restores: the core\'s own, no hook of the plugin\'s', () => {
  // Taiga's database is the project's PostgreSQL on every runtime, DDEV's or the runtime's, which the core backs up and
  // puts back itself (webship/workspace#968 for DDEV's import while Taiga is connected).
  for (const name of ['taiga_export_db', 'taiga_import_db', 'taiga_db_extension']) assert.doesNotMatch(FUN, new RegExp(`^function ${name}\\(\\)`, 'm'), `no ${name}`);
  const readme = read('README.md');
  assert.match(readme, /^### Backups\n/m);
  assert.match(readme, /webship\/workspace#968/, 'the README names the core\'s fix of DDEV\'s import');
  assert.match(readme, /The Workspace's core 1\.0\.47 and later close the\n  database to new connections/, 'the core that does it');
  assert.match(readme, /On an older core, stop Taiga's back end and its worker before an Import on DDEV/, 'and what to do on an older one');
});

test('the functions carry the names the core\'s tools look for; --connect keeps the token off screens and command lines', () => {
  for (const name of ['set_taiga_users', 'add_taiga_users', 'cancel_taiga_users', 'testing_configure_taiga', 'taiga_build', 'taiga_cli_tool', 'taiga_connect']) {
    assert.match(FUN, new RegExp(`^function ${name}\\(\\) \\{`, 'm'), `${name} is defined`);
  }
  assert.match(FUN, /users=\(owner member reader stranger\);/);
  assert.match(FUN, /user_stranger_role='' ;/);
  assert.match(fn('taiga_site'), /taiga_back_exec "TAIGA_SITE_VERB=\$\{verb\} TAIGA_SITE_FLAG=\$\{flag\} python manage\.py shell -c/, 'with Taiga\'s own code (taiga_back_exec)');
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
  assert.match(told, /with `--runtime docker`, `podman` or `kubernetes` at the address the runtime gives it/, 'the runtimes it builds on');
  for (const f of ['ai/agents/taiga-site-builder.md', 'src/index.ts']) assert.doesNotMatch(read(f), /Podman and Kubernetes are not proven|other runtimes are not proven/, `${f}: no runtime said unproven that is proven`);
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
