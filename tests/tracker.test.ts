import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { currentSprint, isoOf, itemOf, ITEM_RE, JWT_RE, lastEditOf, membersOf, roleAssociation, saidOf, SLUG_RE, stateClassOf, statusesOf, tagsOf, taigaTracker, TOKEN_RE } from '../src/lib/tracker';

// Recorded from a Taiga 6.10.2 site the plugin's builder made (--install --add-users --sample-content), read through
// its REST API as the account member with an application token (tools/tg-record-fixtures.py in the trackers round),
// the site's address made https://taiga.test and no token kept. Webship site (project 1, slug webship-site): owner (6)
// administers it as Product Owner, member (7) is in the role Back, reader (8) in the role Reader, which only views;
// stranger and the site's administrator are not in it. Sprint 1 holds #1 (In progress, member's, tagged bug, owner's
// comment and member's task #4) and #3 (Done); #2 (New) is in the backlog. The sprint's dates are the build's: the
// answers below move them around today.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const FIX = path.join(PKG, 'tests', 'fixtures', 'tracker');
const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, `${f}.json`), 'utf8'));
const made: string[] = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const TOKEN = 'eyJhcHBfdG9rZW5faWQiOjF9:1vO6yA:' + 'Ab3_dE-'.repeat(6) + 'x';
const SETTINGS = { url: 'https://taiga.test', username: 'member', token: TOKEN, default_scope: 'webship-site' };
const SCOPE = { id: 'webship-site', name: 'webship-site', web: 'https://taiga.test/project/webship-site/' };
const OWNER = 6;
const MEMBER = 7;
const READER = 8;
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/** What a curl call asked: its method, its address, its body and its headers file. */
function readCurl(args: string[]) {
  const headerFile = args.find((a) => a.startsWith('@') && a.endsWith('/headers'));
  const bodyFile = args.find((a) => a.startsWith('@') && a.endsWith('/body.json'));
  const url = new URL(args[args.length - 1]);
  return {
    args, url, method: args[args.indexOf('-X') + 1], route: url.pathname.replace(/^\/api\/v1/, ''), query: url.searchParams,
    body: bodyFile ? JSON.parse(fs.readFileSync(bodyFile.slice(1), 'utf8')) : undefined,
    headers: headerFile ? fs.readFileSync(headerFile.slice(1), 'utf8') : '',
  };
}

const STORIES = () => [1, 2, 3].map((n) => fixture(`us-${n}`));

/** The answer the recorded site gives to a call: [status, body]. Lists are filtered as Taiga filters them. */
function recorded(c: ReturnType<typeof readCurl>): [number, unknown] {
  const r = c.route;
  const q = c.query;
  if (c.method === 'GET') {
    if (r === '/users/me') return [200, fixture('me')];
    if (r === '/projects' && q.get('member') === String(MEMBER)) return [200, fixture('projects')];
    if (r === '/projects/1') return [200, fixture('project')];
    if (r === '/memberships' && q.get('project') === '1') return [200, fixture('memberships')];
    if (r === '/milestones' && q.get('project') === '1') {
      return [200, fixture('milestones-open').map((m: any) => ({ ...m, estimated_start: day(-3), estimated_finish: day(11) }))];
    }
    if (r === '/userstories/by_ref') {
      const hit = STORIES().find((us) => String(us.ref) === q.get('ref') && q.get('project') === '1');
      return hit ? [200, hit] : [404, { _error_message: 'No UserStory matches the given query.', _error_type: 'taiga.base.exceptions.NotFound' }];
    }
    if (r === '/userstories' && q.get('project') === '1') {
      let list = STORIES();
      if (q.get('status__is_closed') === 'false') list = list.filter((us) => !us.is_closed);
      if (q.get('assigned_users')) list = list.filter((us) => us.assigned_users.includes(Number(q.get('assigned_users'))));
      if (q.get('milestone')) list = list.filter((us) => String(us.milestone) === q.get('milestone'));
      if (q.get('q')) list = list.filter((us) => us.subject.toLowerCase().includes(String(q.get('q')).toLowerCase()));
      return [200, list.slice(0, Number(q.get('page_size') || 30))];
    }
    const h = /^\/history\/userstory\/([0-9]+)$/.exec(r);
    if (h) {
      const n = STORIES().find((us) => String(us.id) === h[1])!.ref;
      return [200, q.get('type') === 'comment' ? fixture(`comments-${n}`) : fixture(`history-${n}`)];
    }
    return [404, { _error_message: 'Not found.' }];
  }
  if (c.method === 'PATCH' && /^\/userstories\/[0-9]+$/.test(r)) return [200, { id: Number(r.split('/').pop()), version: (c.body && c.body.version) + 1 }];
  if (c.method === 'POST' && r === '/userstories') return [201, { id: 9, ref: 5, subject: c.body.subject }];
  return [405, { _error_message: 'Method not allowed' }];
}

/** A provider over the recordings, with what each call asked. */
function provider(settings: Record<string, unknown> = SETTINGS, answer = recorded) {
  const calls: ReturnType<typeof readCurl>[] = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'taiga-tracker-'));
  made.push(home);
  const api: any = {
    name: 'taiga',
    settings: { read: () => settings, file: 'core/config/plugin.taiga.settings.yml' },
    lib: {
      run: async (cmd: string, args: string[]) => {
        assert.strictEqual(cmd, 'curl');
        const c = readCurl(args);
        calls.push(c);
        const [status, body] = answer(c);
        return { ok: true, code: 0, stdout: `${JSON.stringify(body)}\n${status}`, stderr: '' };
      },
      cliError: (s: string) => s,
    },
  };
  return { p: taigaTracker(api), calls };
}

test('roles, statuses, states, tags, sprints, times and ids, as Taiga gives them', () => {
  const project = fixture('project');
  const statuses = statusesOf(project);
  assert.deepStrictEqual(statuses.map((s) => `${s.name}${s.closed ? ' (closed)' : ''}`), ['New', 'Ready', 'In progress', 'Ready for test', 'Done (closed)', 'Archived (closed)']);
  const members = membersOf(project, fixture('memberships'));
  assert.deepStrictEqual([...members.values()].map((m) => [m.username, m.name, m.admin, m.mayChange]).sort(), [
    ['member', 'Member Test', false, true], ['owner', 'Owner Test', true, true], ['reader', 'Reader Test', false, false],
  ]);
  assert.deepStrictEqual([members.get(OWNER), members.get(MEMBER), members.get(READER), undefined].map(roleAssociation), ['owner', 'member', 'outside', 'outside'], 'the administrator, a role that may change user stories, a reader, someone the project does not have');
  assert.strictEqual(roleAssociation({ ...members.get(OWNER)!, active: false }), 'outside', 'someone no longer active');
  const [one, two, three] = STORIES();
  assert.deepStrictEqual([one, two, three].map((us) => stateClassOf(us, statuses)), ['doing', 'open', 'done'], 'In progress, New, Done');
  assert.deepStrictEqual(tagsOf(one), ['bug']);
  assert.deepStrictEqual(tagsOf({ tags: [['b', null], 'a', ['', '#fff']] }), ['a', 'b']);
  assert.strictEqual(isoOf('2026-11-26T11:17:06.241Z'), '2026-11-26T11:17:06.241Z');
  assert.strictEqual(isoOf('2026-11-26T11:17:06.000Z'), '2026-11-26T11:17:06Z');
  assert.strictEqual(isoOf(''), undefined);
  const now = new Date('2026-11-26T12:00:00Z');
  assert.deepStrictEqual(currentSprint(fixture('milestones-open'), now), { id: 1, name: 'Sprint 1' });
  assert.strictEqual(currentSprint(fixture('milestones-open'), new Date('2026-12-08T00:00:00Z')), null, 'after its last day');
  assert.strictEqual(currentSprint([{ ...fixture('milestones-open')[0], closed: true }], now), null, 'a closed sprint is no current one');
  assert.deepStrictEqual(currentSprint([
    { id: 2, name: 'Long', closed: false, estimated_start: '2026-11-01', estimated_finish: '2026-12-31' },
    { id: 3, name: 'Short', closed: false, estimated_start: '2026-11-20', estimated_finish: '2026-11-30' },
  ], now), { id: 3, name: 'Short' }, 'two at once: the one that ends first');
  for (const id of ['1', '#1', '42', '123456789']) assert.ok(ITEM_RE.test(id), id);
  for (const id of ['0', '#0', 'WEB-1', 'abc', '1234567890', 'webship-site']) assert.strictEqual(ITEM_RE.test(id), false, id);
  assert.ok(SLUG_RE.test('webship-site'));
  for (const s of ['Webship site', '-x', '']) assert.strictEqual(SLUG_RE.test(s), false, s);
  assert.ok(TOKEN_RE.test(TOKEN), 'an application token');
  assert.ok(TOKEN_RE.test(`token=${TOKEN} `), 'in a line of text');
  assert.strictEqual(TOKEN_RE.test('eyJhbGciOiJIUzI1NiJ9 alone'), false, 'a signed value has three parts');
  assert.ok(JWT_RE.test('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ'), 'a session token');
  assert.strictEqual(JWT_RE.test('eyJ.eyJ.x'), false);
  assert.strictEqual(saidOf({ _error_message: 'No UserStory matches the given query.' }), 'No UserStory matches the given query.');
  assert.strictEqual(saidOf({ version: ['The version is not valid'] }), 'version: The version is not valid');
  assert.strictEqual(saidOf(null), '');
});

test('the last editor is the newest change of the subject or the description in the history', () => {
  assert.strictEqual(lastEditOf(fixture('history-1')), null, 'the sample user stories were made, tagged, assigned and commented on, never edited');
  const edits = [
    { created_at: '2026-11-26T08:00:00Z', user: { pk: MEMBER }, diff: { subject: ['a', 'b'] }, values_diff: { subject: ['a', 'b'] } },
    { created_at: '2026-11-26T09:00:00Z', user: { pk: OWNER }, diff: { description: ['a', 'b'] }, values_diff: { description_diff: 'x', description_html: ['', ''] } },
    { created_at: '2026-11-26T10:00:00Z', user: { pk: READER }, diff: { status: [1, 2] }, values_diff: { status: ['New', 'Ready'] } },
  ];
  assert.strictEqual(lastEditOf(edits), OWNER, 'the newest edit; a change of status is not an edit');
  assert.strictEqual(lastEditOf(edits.slice(0, 1)), MEMBER);
});

test('the provider: ready, its scope, its capabilities and the address of a user story', async () => {
  const { p } = provider();
  assert.strictEqual(p.ready(), '');
  assert.match(provider({ username: 'member', token: TOKEN }).p.ready(), /no Taiga address/);
  assert.match(provider({ url: 'https://taiga.test', token: TOKEN }).p.ready(), /no username/);
  assert.match(provider({ url: 'https://taiga.test', username: 'member', token: 'CHANGE_ME' }).p.ready(), /no application token/);
  assert.deepStrictEqual(p.parseScope('webship-site'), SCOPE);
  assert.deepStrictEqual(p.parseScope('https://taiga.test/project/webship-site/backlog'), SCOPE, 'a project\'s address gives its slug');
  assert.strictEqual(p.parseScope('Webship site'), null, 'a scope is a slug');
  assert.deepStrictEqual(p.capabilities, { views: ['open', 'mine', 'assigned', 'iteration', 'query'], iterationWord: 'sprint', comment: true, worklog: false, transition: true, labels: true, assign: true, create: true, request: 'none' });
  assert.strictEqual(p.worklog, undefined, 'no worklog: Taiga has no time tracking of its own');
  assert.strictEqual(p.urlOf(SCOPE, '#1'), 'https://taiga.test/project/webship-site/us/1');
  assert.deepStrictEqual(await p.scopes!(), [{ id: 'webship-site', name: 'Webship site', web: 'https://taiga.test/project/webship-site/' }]);
  assert.strictEqual(await p.account!(), 'Member Test');
  assert.deepStrictEqual(p.tokenShapes!.map(([w]) => w), ['a Taiga application token', 'a Taiga session token']);
});

test('the views: open, mine, someone\'s, the current sprint\'s and a search; a user story\'s state is its status', async () => {
  const { p, calls } = provider();
  const open = await p.list(SCOPE, { view: 'open', limit: 20 });
  assert.deepStrictEqual(open.map((i) => `#${i.id} ${i.title} | ${i.state} ${i.stateClass} | ${i.iteration || '-'}`), [
    '#1 The greeting script says Helo instead of Hello | In progress doing | Sprint 1',
    '#2 The usage line spells greeting as greting | New open | -',
  ], 'Done is closed');
  const greeting = open[0];
  assert.deepStrictEqual({ ...greeting, updated: undefined }, {
    id: '1', title: 'The greeting script says Helo instead of Hello', url: 'https://taiga.test/project/webship-site/us/1',
    state: 'In progress', stateClass: 'doing', assignees: ['Member Test'], labels: ['bug'], iteration: 'Sprint 1', updated: undefined,
  });
  assert.match(String(greeting.updated), /^2026-11-26T\d\d:\d\d:\d\d(\.\d+)?Z$/);
  const list = calls.find((c) => c.route === '/userstories')!;
  assert.deepStrictEqual([list.query.get('status__is_closed'), list.query.get('order_by'), list.query.get('page_size')], ['false', '-modified_date', '20']);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'mine', limit: 20 })).map((i) => i.id), ['1'], 'member is among the greeting\'s assigned users');
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'assigned', who: 'Member Test', limit: 20 })).map((i) => i.id), ['1']);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'assigned', who: 'owner', limit: 20 })).map((i) => i.id), [], 'owner has none');
  assert.deepStrictEqual(await p.list(SCOPE, { view: 'assigned', limit: 20 }), []);
  await assert.rejects(p.list(SCOPE, { view: 'assigned', who: 'Stranger Test', limit: 20 }), /Stranger Test is not a member of webship-site/);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'iteration', limit: 20 })).map((i) => `#${i.id} ${i.iteration}`), ['#1 Sprint 1'], 'the open user stories of today\'s sprint');
  assert.strictEqual(calls.filter((c) => c.route === '/userstories').pop()!.query.get('milestone'), '1');
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'query', text: 'GRETING', limit: 20 })).map((i) => i.id), ['2'], 'Taiga\'s own text filter');
  assert.strictEqual(calls.filter((c) => c.route === '/userstories').pop()!.query.get('q'), 'GRETING');
  assert.deepStrictEqual(await p.list(SCOPE, { view: 'query', text: '  ', limit: 20 }), []);
  assert.strictEqual((await p.list(SCOPE, { view: 'open', limit: 1 })).length, 1, 'the limit');
  const noSprint = provider(SETTINGS, (c) => (c.route === '/milestones' ? [200, []] : recorded(c))).p;
  assert.deepStrictEqual(await noSprint.list(SCOPE, { view: 'iteration', limit: 20 }), [], 'no sprint today');
  // The token travels in a header file, never on curl's command line.
  assert.ok(calls.every((c) => c.headers.includes(`Authorization: Application ${TOKEN}`) && !c.args.join(' ').includes(TOKEN)));
  await assert.rejects(p.list({ id: 'no-such-project', name: 'no-such-project', web: '' }, { view: 'open', limit: 5 }), /no project "no-such-project" the account of the token is a member of/);
});

test('one user story: its author and each comment\'s author by their membership, its body as Markdown', async () => {
  const { p } = provider();
  const greeting = await p.get(SCOPE, '#1');
  assert.deepStrictEqual(greeting.author, { name: 'Owner Test', association: 'owner' }, 'the project\'s administrator');
  assert.strictEqual(greeting.lastEditor, undefined, 'never edited');
  assert.strictEqual(greeting.body, '`greeting.sh` prints *Helo* where it should print *Hello*.', 'Taiga keeps Markdown');
  assert.deepStrictEqual([greeting.state, greeting.stateClass, greeting.labels, greeting.assignees, greeting.iteration], ['In progress', 'doing', ['bug'], ['Member Test'], 'Sprint 1']);
  assert.deepStrictEqual(greeting.comments.map((c) => [c.author, c.body]), [[{ name: 'Owner Test', association: 'owner' }, 'Seen on the test site: the greeting prints Helo.']]);
  assert.match(greeting.comments[0].at, /^2026-11-26T/);
  assert.deepStrictEqual((await p.get(SCOPE, '2')).author, { name: 'Member Test', association: 'member' });
  const done = await p.get(SCOPE, '3');
  assert.deepStrictEqual([done.state, done.stateClass, done.comments], ['Done', 'done', []]);
  // A member the project has as a reader now is outside; an edit by another person is the last edit; a deleted
  // comment is left out.
  const changed = (c: ReturnType<typeof readCurl>): [number, unknown] => {
    if (c.route === '/memberships') return [200, fixture('memberships').map((m: any) => (m.user === MEMBER ? { ...m, role: 7, role_name: 'Reader' } : m))];
    if (c.route === '/projects/1') {
      const pr = fixture('project');
      pr.members = pr.members.map((m: any) => (m.id === MEMBER ? { ...m, role: 7, role_name: 'Reader' } : m));
      return [200, pr];
    }
    if (c.route === '/history/userstory/2' && c.query.get('type') !== 'comment') return [200, [{ created_at: '2026-11-26T12:00:00Z', user: { pk: OWNER }, diff: { description: ['a', 'b'] }, values_diff: { description_diff: 'x' } }]];
    if (c.route === '/history/userstory/2') return [200, [{ created_at: '2026-11-26T12:00:00Z', user: { pk: OWNER, name: 'Owner Test' }, comment: 'gone', delete_comment_date: '2026-11-26T12:01:00Z' }]];
    return recorded(c);
  };
  const usage = await provider(SETTINGS, changed).p.get(SCOPE, '2');
  assert.deepStrictEqual([usage.author, usage.lastEditor, usage.comments], [{ name: 'Member Test', association: 'outside' }, { name: 'Owner Test', association: 'owner' }, []]);
  await assert.rejects(p.get(SCOPE, '4'), /#4 is not a user story of webship-site/, 'a task\'s reference');
  await assert.rejects(p.get(SCOPE, 'abc'), /not a user story: abc/);
});

test('the writes: a comment, a status, tags, an assignee and a new user story, each with the user story\'s version', async () => {
  const { p, calls } = provider();
  const last = () => calls.filter((c) => c.method !== 'GET').pop()!;
  const url = 'https://taiga.test/project/webship-site/us/1';
  const V1 = fixture('us-1').version;
  const V2 = fixture('us-2').version;
  const comment = await p.comment!(SCOPE, '1', 'Fixed in `greeting.sh` <b>now</b>');
  assert.deepStrictEqual([comment.ok, comment.url], [true, url]);
  assert.deepStrictEqual([last().method, last().route, last().body], ['PATCH', '/userstories/1', { comment: 'Fixed in `greeting.sh` <b>now</b>', version: V1 }], 'Markdown, as Taiga keeps it, with the version read just before');
  assert.deepStrictEqual((await p.transitions!(SCOPE, '1')).map((t) => `${t.id}=${t.name}`), [
    'status:1=Change the status to New', 'status:2=Change the status to Ready', 'status:4=Change the status to Ready for test',
    'status:5=Change the status to Done', 'status:6=Change the status to Archived',
  ], 'the project\'s other statuses, in their order');
  assert.strictEqual((await p.transition!(SCOPE, '1', 'status:5')).ok, true);
  assert.deepStrictEqual(last().body, { status: 5, version: V1 });
  assert.match((await p.transition!(SCOPE, '1', 'status:999')).error, /not a status of webship-site: status:999/);
  assert.match((await p.transition!(SCOPE, '1', 'status:3')).error, /#1 is In progress already/);
  assert.strictEqual((await p.labels!(SCOPE, '2', ['docs'], [])).ok, true);
  assert.deepStrictEqual(last().body, { tags: [['docs', null]], version: V2 }, 'a new tag, with no colour');
  assert.strictEqual((await p.labels!(SCOPE, '1', ['Docs'], ['BUG'])).ok, true);
  assert.deepStrictEqual(last().body, { tags: [['Docs', null]], version: V1 }, 'a tag off, whatever its case');
  const before = calls.length;
  assert.strictEqual((await p.labels!(SCOPE, '1', ['bug'], [])).ok, true, 'a tag it has already');
  assert.ok(!calls.slice(before).some((c) => c.method !== 'GET'), 'nothing to write');
  assert.match((await p.labels!(SCOPE, '1', ['a,b'], [])).error, /not a tag Taiga keeps/);
  assert.strictEqual((await p.assign!(SCOPE, '2', 'me')).ok, true);
  assert.deepStrictEqual(last().body, { assigned_users: [MEMBER], assigned_to: MEMBER, version: V2 }, 'the first assignee is the main one too');
  assert.strictEqual((await p.assign!(SCOPE, '1', 'Owner Test')).ok, true);
  assert.deepStrictEqual(last().body, { assigned_users: [MEMBER, OWNER], version: V1 }, 'another one beside the first');
  assert.strictEqual((await p.assign!(SCOPE, '1', 'reader')).ok, true, 'by username; Taiga lets a reader be assigned');
  const quiet = calls.length;
  assert.strictEqual((await p.assign!(SCOPE, '1', 'member')).ok, true, 'assigned already');
  assert.ok(!calls.slice(quiet).some((c) => c.method !== 'GET'));
  assert.match((await p.assign!(SCOPE, '1', 'Stranger Test')).error, /Stranger Test is not a member of webship-site/);
  const fresh = await p.create!(SCOPE, { title: 'Webship test new', body: 'A **new** one' });
  assert.deepStrictEqual(fresh, { ok: true, error: '', url: 'https://taiga.test/project/webship-site/us/5', id: '5' });
  assert.deepStrictEqual([last().method, last().route, last().body], ['POST', '/userstories', { project: 1, subject: 'Webship test new', description: 'A **new** one' }], 'in the backlog, with the project\'s default status');
  // A refusal of Taiga's is said as it gave it.
  const refused = provider(SETTINGS, (c) => (c.method === 'PATCH' ? [403, { _error_message: 'You do not have permission to perform this action.' }] : recorded(c))).p;
  assert.match((await refused.comment!(SCOPE, '1', 'x')).error, /Taiga refused a comment on the user story to this account \(403\)/);
  const stale = provider(SETTINGS, (c) => (c.method === 'PATCH' ? [400, { version: ['The version parameter is not valid'] }] : recorded(c))).p;
  assert.match((await stale.transition!(SCOPE, '1', 'status:5')).error, /Taiga answered 400 to the status of the user story: version: The version parameter is not valid/);
  const expired = provider(SETTINGS, () => [401, { detail: 'Invalid token' }]).p;
  await assert.rejects(expired.list(SCOPE, { view: 'open', limit: 5 }), /Taiga refused the application token \(401\): connect again/);
  assert.ok(calls.every((c) => !c.args.join(' ').includes(TOKEN)), 'the token never on a command line');
});

test('an item of the list is built from a user story of Taiga\'s', () => {
  const project = fixture('project');
  const item = itemOf({ ref: 9, subject: 'T & t', status: 2, status_extra_info: { name: 'Ready', is_closed: false }, assigned_users: [99], assigned_to: 99, assigned_to_extra_info: { full_name_display: 'Gone Person' }, tags: [['b', null], ['a', '#fff']], milestone_name: null, modified_date: '' }, 'https://taiga.test', 'webship-site', statusesOf(project), membersOf(project, fixture('memberships')));
  assert.deepStrictEqual(item, { id: '9', title: 'T & t', url: 'https://taiga.test/project/webship-site/us/9', state: 'Ready', stateClass: 'doing', assignees: ['Gone Person'], labels: ['a', 'b'], updated: undefined });
});
