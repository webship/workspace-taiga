/**
 * Taiga, as a provider of the tracker family (@webship.co/workspace-tracker): the user stories of a Taiga project, over
 * its REST API as a person, with that person's application token (Authorization: Application <token>), in a header
 * file, never on a command line. The builder's tool makes the token with Taiga's own code (--connect <login>); on your
 * own Taiga, the person authorises the application on Taiga's own screen (/external-apps?application=<id>&state=<any>)
 * and the application turns the one-time code into the token (POST /api/v1/application-tokens/validate).
 *
 * A scope is a project, by its slug ("webship-site", the last part of its address); an item is a user story, by its
 * reference (#1): the number Taiga shows and puts in its address. Tasks and issues share the project's references, so a
 * reference that is a task or an issue is not a user story here.
 *
 * Reads: the open user stories (the ones whose status is not a closed one), mine (the ones the person is among the
 * assigned users of), someone's, the current sprint's (Taiga's milestones: the open sprint whose dates hold today), and
 * a search (Taiga's own text filter); one user story with its comments. A user story's state is its status (New,
 * Ready, In progress, Ready for test, Done, Archived in the Scrum template), and its iteration the sprint it is in.
 *
 * Each author's standing is their membership of the project: its administrators are owners of it; a member whose role
 * may change user stories is a member; a member whose role may not (a reader, a stakeholder), someone no longer active,
 * and someone the project does not have are outside, so the base keeps their user stories analyze-only unless a person
 * confirms by name. The last editor is the person of the newest change of the subject or the description in the user
 * story's history, when not its creator.
 *
 * Writes, which the base offers only with writes on, each after a person's click: a comment, a change of status, tags
 * (Taiga's tags are free: a new one is made with no colour), an assignee among the project's members, and a new user
 * story in the backlog. Every change carries the user story's version, as Taiga asks. No worklog: Taiga has no time
 * tracking of its own. Taiga keeps Markdown. Taiga is not a forge: the pull request of the work is opened from the
 * project's forge menu. A Taiga application token is a signed value in three parts ("eyJ…:…:…"), and its session token
 * a JWT; the base refuses both shapes, and the provider's own token, in whatever is about to be posted.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PluginApi } from '@webship.co/workspace-plugin-api';
import type { Person, TrackerComment, TrackerItem, TrackerItemFull, TrackerProvider, TrackerScope, WriteResult } from '@webship.co/workspace-tracker';

/** A user story: its reference in the project, with or without the "#". */
export const ITEM_RE = /^#?([1-9][0-9]{0,8})$/;
/** A project's slug, as a scope. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
/** What a Taiga application token looks like: Django's signed value of {"app_token_id": …}, its time and its signature. */
export const TOKEN_RE = /(?<![A-Za-z0-9_:-])eyJ[A-Za-z0-9_-]{10,300}:[0-9A-Za-z]{4,12}:[A-Za-z0-9_-]{27,90}(?![A-Za-z0-9_:-])/;
/** What a Taiga session token looks like: a JWT. */
export const JWT_RE = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/;
/** A tag as Taiga keeps it: no comma, at most 50 characters. */
const TAG_RE = /^[^,\u0000-\u001f\u007f]{1,50}$/;
/** How long the account, its projects and a project's people and statuses are kept before they are asked again. */
const KEEP_MS = 5 * 60 * 1000;
/** Taiga answers 30 by page unless asked; history is read so many at a time, so many pages at most. */
const PAGE = 100;
const PAGES = 10;

const configured = (v: unknown) => { const s = String(v == null ? '' : v).trim(); return s && s !== 'CHANGE_ME' ? s : ''; };

export interface Status { id: number; name: string; order: number; closed: boolean }
export interface Member { id: number; username: string; name: string; admin: boolean; active: boolean; mayChange: boolean }
export interface Project { id: number; slug: string; name: string; statuses: Status[]; members: Map<number, Member> }

/** The project's statuses of user stories, in their order. */
export function statusesOf(detail: any): Status[] {
  return (Array.isArray(detail && detail.us_statuses) ? detail.us_statuses : [])
    .filter((s: any) => s && Number.isInteger(s.id))
    .map((s: any) => ({ id: s.id, name: String(s.name || ''), order: Number(s.order) || 0, closed: s.is_closed === true }))
    .sort((a: Status, b: Status) => a.order - b.order || a.id - b.id);
}

/**
 * The project's people: its members (from the project's detail: their names and roles), each with whether they
 * administer it (its memberships) and whether their role may change user stories (the role's permissions).
 */
export function membersOf(detail: any, memberships: any[]): Map<number, Member> {
  const changers = new Set((Array.isArray(detail && detail.roles) ? detail.roles : [])
    .filter((r: any) => r && Array.isArray(r.permissions) && r.permissions.includes('modify_us')).map((r: any) => r.id));
  const admins = new Set((Array.isArray(memberships) ? memberships : []).filter((m: any) => m && m.is_admin === true).map((m: any) => m.user));
  const out = new Map<number, Member>();
  for (const m of (Array.isArray(detail && detail.members) ? detail.members : [])) {
    if (!m || !Number.isInteger(m.id)) continue;
    out.set(m.id, {
      id: m.id, username: String(m.username || ''), name: String(m.full_name_display || m.full_name || m.username || ''),
      admin: admins.has(m.id), active: m.is_active !== false, mayChange: changers.has(m.role),
    });
  }
  return out;
}

/** A member of the project, as the base reads an author's standing. */
export function roleAssociation(member: Member | undefined): Person['association'] {
  if (!member || !member.active) return 'outside';
  if (member.admin) return 'owner';
  return member.mayChange ? 'member' : 'outside';
}

/** How a user story's state reads: a closed status is done; the first status open; the others, work going on. */
export function stateClassOf(us: any, statuses: Status[]): TrackerItem['stateClass'] {
  if (us && (us.is_closed === true || (us.status_extra_info && us.status_extra_info.is_closed === true))) return 'done';
  const open = statuses.filter((s) => !s.closed);
  if (!open.length || !us) return undefined;
  return us.status === open[0].id ? 'open' : 'doing';
}

/** The names of a user story's tags, as Taiga keeps them ([name, colour] pairs, or names), sorted. */
export function tagsOf(us: any): string[] {
  return (Array.isArray(us && us.tags) ? us.tags : [])
    .map((t: any) => String(Array.isArray(t) ? t[0] : t || '').trim()).filter(Boolean).sort();
}

/** An ISO time, as Taiga gives it, without its milliseconds when they are 0. */
export function isoOf(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().replace(/\.000Z$/, 'Z');
}

/** The sprint of today: an open one whose dates hold today, the one that ends first; else none. */
export function currentSprint(list: any[], now: Date = new Date()): { id: number; name: string } | null {
  const day = now.toISOString().slice(0, 10);
  const running = (Array.isArray(list) ? list : [])
    .filter((m) => m && Number.isInteger(m.id) && m.closed !== true && String(m.estimated_start || '') <= day && day <= String(m.estimated_finish || ''));
  running.sort((a, b) => String(a.estimated_finish || '').localeCompare(String(b.estimated_finish || '')) || a.id - b.id);
  return running.length ? { id: running[0].id, name: String(running[0].name || '') } : null;
}

/** A user story of Taiga's, as the base reads an item. */
export function itemOf(us: any, base: string, slug: string, statuses: Status[], members: Map<number, Member>): TrackerItem {
  const ids: number[] = Array.isArray(us.assigned_users) && us.assigned_users.length ? us.assigned_users
    : (Number.isInteger(us.assigned_to) ? [us.assigned_to] : []);
  const extra = us.assigned_to_extra_info || {};
  return {
    id: String(us.ref),
    title: String(us.subject || ''),
    url: `${base}/project/${slug}/us/${us.ref}`,
    state: String((us.status_extra_info && us.status_extra_info.name) || ''),
    stateClass: stateClassOf(us, statuses),
    assignees: ids.map((id) => (members.get(id) || { name: id === us.assigned_to ? String(extra.full_name_display || '') : '' }).name || `#${id}`),
    labels: tagsOf(us),
    ...(us.milestone_name ? { iteration: String(us.milestone_name) } : {}),
    updated: isoOf(us.modified_date),
  };
}

/**
 * The person of the newest change of a user story's subject or description in its history: Taiga records a change of
 * the subject under "subject", and one of the description under "description" in the entry's diff ("description_diff"
 * in its values_diff).
 */
export function lastEditOf(history: any[]): number | null {
  const edited = (e: any) => ['diff', 'values_diff'].some((k) => e && e[k] && typeof e[k] === 'object'
    && ('subject' in e[k] || 'description' in e[k] || 'description_diff' in e[k]));
  const edits = (Array.isArray(history) ? history : [])
    .filter(edited)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const pk = edits.length && edits[0].user ? Number(edits[0].user.pk) : NaN;
  return Number.isInteger(pk) ? pk : null;
}

/** What an answer of Taiga says went wrong, in one line. */
export function saidOf(data: any): string {
  if (!data || typeof data !== 'object') return '';
  const said = data._error_message || data.detail || data.error || data.message
    || Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : JSON.stringify(v)}`).join('; ');
  return String(said || '').replace(/\s+/g, ' ').slice(0, 300);
}

export function taigaTracker(api: PluginApi): TrackerProvider {
  const lib = api.lib;
  const settings = () => api.settings.read() || {};
  const base = () => configured(settings().url).replace(/\/+$/, '');
  const username = () => configured(settings().username);
  const token = () => configured(settings().token);

  // Who is asking: the site, the account and its token, so that what is kept follows a change of any of them.
  const asker = () => crypto.createHash('sha1').update(`${base()}\n${username()}\n${token()}`).digest('hex').slice(0, 12);

  /** One call of the REST API: the token and the body in files only this user reads, removed after. */
  async function call(method: 'GET' | 'POST' | 'PATCH', route: string, what: string, body?: unknown): Promise<any> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-taiga-'));
    try {
      const h = path.join(dir, 'headers');
      fs.writeFileSync(h, `Authorization: Application ${token()}\nAccept: application/json\nContent-Type: application/json\n`, { mode: 0o600 });
      const args = ['-sS', '-m', '30', '-X', method, '-w', '\n%{http_code}', '-H', `@${h}`];
      if (body !== undefined) {
        const b = path.join(dir, 'body.json');
        fs.writeFileSync(b, JSON.stringify(body), { mode: 0o600 });
        args.push('--data-binary', `@${b}`);
      }
      args.push(`${base()}/api/v1${route}`);
      const r = await lib.run('curl', args, process.env.HOME || '/', { timeoutMs: 40 * 1000, env: process.env });
      const out = String(r.stdout || '');
      const at = out.lastIndexOf('\n');
      const status = Number(out.slice(at + 1)) || 0;
      if (!status) throw new Error(lib.cliError(String(r.stderr || 'curl did not answer')));
      let data: any = null;
      try { data = JSON.parse(at >= 0 ? out.slice(0, at) : out); } catch (_) { data = null; }
      if (status === 401) throw new Error(`Taiga refused the application token (${status}): connect again with the site's tool (--connect <login>), or authorise the application again on Taiga's screen`);
      if (status === 403) throw new Error(`Taiga refused ${what} to this account (${status})`);
      if (status === 404) throw new Error(`Taiga has no ${what} (${status})`);
      if (status < 200 || status >= 300) throw new Error(`Taiga answered ${status} to ${what}${saidOf(data) ? `: ${saidOf(data)}` : ''}`);
      return data;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  async function write(method: 'POST' | 'PATCH', route: string, what: string, body: unknown, url: string): Promise<WriteResult & { result?: any }> {
    try {
      const result = await call(method, route, what, body);
      return { ok: true, error: '', url, result };
    } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
  }

  // What is kept for five minutes: the token's own account, its projects, and each project's people and statuses.
  const kept = new Map<string, { at: number; value: unknown }>();
  async function keep<T>(what: string, make: () => Promise<T>): Promise<T> {
    const key = `${asker()}:${what}`;
    const hit = kept.get(key);
    if (hit && Date.now() - hit.at < KEEP_MS) return hit.value as T;
    const value = await make();
    kept.set(key, { at: Date.now(), value });
    return value;
  }

  const me = () => keep('me', async () => {
    const u = await call('GET', '/users/me', 'the account of the token');
    return { id: Number(u && u.id), username: String(u && u.username || ''), name: String((u && (u.full_name_display || u.username)) || '') };
  });
  const projectsOfMe = () => keep('projects', async () => {
    const rows = await call('GET', `/projects?member=${(await me()).id}&page_size=${PAGE}`, 'the projects of the account');
    return (Array.isArray(rows) ? rows : []).filter((p: any) => p && Number.isInteger(p.id) && SLUG_RE.test(String(p.slug || '')))
      .map((p: any) => ({ id: p.id as number, slug: String(p.slug), name: String(p.name || p.slug) }));
  });
  const projectOf = (scope: TrackerScope) => keep(`project:${scope.id}`, async (): Promise<Project> => {
    const hit = (await projectsOfMe()).find((p) => p.slug === scope.id);
    if (!hit) throw new Error(`no project "${scope.id}" the account of the token is a member of`);
    const detail = await call('GET', `/projects/${hit.id}`, `the project ${scope.id}`);
    const memberships = await call('GET', `/memberships?project=${hit.id}&page_size=${PAGE}`, `the members of ${scope.id}`);
    return { id: hit.id, slug: hit.slug, name: hit.name, statuses: statusesOf(detail), members: membersOf(detail, memberships) };
  });

  /** The user story behind a reference of the scope. */
  async function storyIn(scope: TrackerScope, id: string): Promise<{ project: Project; us: any }> {
    const m = ITEM_RE.exec(String(id || '').trim());
    if (!m) throw new Error(`not a user story: ${id}`);
    const project = await projectOf(scope);
    let us: any;
    try { us = await call('GET', `/userstories/by_ref?ref=${m[1]}&project=${project.id}`, `user story #${m[1]} in ${scope.id}`); }
    catch (e) { throw new Error(/\(404\)/.test(String((e as Error).message)) ? `#${m[1]} is not a user story of ${scope.id}` : String((e as Error).message)); }
    if (!us || us.project !== project.id || String(us.ref) !== m[1]) throw new Error(`#${m[1]} is not a user story of ${scope.id}`);
    return { project, us };
  }

  /** A user story's history (comments, or every change), newest first, page by page. */
  async function historyOf(usId: number, comments: boolean): Promise<any[]> {
    const all: any[] = [];
    for (let page = 1; page <= PAGES; page++) {
      const rows = await call('GET', `/history/userstory/${usId}?${comments ? 'type=comment&' : ''}page_size=${PAGE}&page=${page}`, 'the history of the user story');
      const list = Array.isArray(rows) ? rows : [];
      all.push(...list);
      if (list.length < PAGE) break;
    }
    return all;
  }

  function personOf(project: Project, uid: unknown, fallback = ''): Person {
    const id = Number(uid);
    if (!Number.isInteger(id)) return { name: fallback || 'unknown', association: 'unknown' };
    const member = project.members.get(id);
    return { name: (member && member.name) || fallback || `#${id}`, association: roleAssociation(member) };
  }

  /** Someone the project has, by what the person typed: "me", their username, their name, or their id. Their id. */
  async function memberBy(project: Project, who: string, scope: TrackerScope): Promise<number> {
    const w = who.trim().toLowerCase().replace(/^@/, '');
    const active = [...project.members.values()].filter((m) => m.active);
    if (w === 'me') {
      const mine = (await me()).id;
      if (!active.some((m) => m.id === mine)) throw new Error(`the account of the token is not a member of ${scope.id}`);
      return mine;
    }
    const found = active.find((m) => String(m.id) === w.replace(/^#/, '') || m.username.toLowerCase() === w || m.name.toLowerCase() === w);
    if (!found) throw new Error(`${who} is not a member of ${scope.id}`);
    return found.id;
  }

  const storyUrl = (scope: TrackerScope | null, ref: string | number) => `${base()}/project/${scope ? scope.id : 'project'}/us/${String(ref).replace(/^#/, '')}`;
  const failed = (e: unknown): WriteResult => ({ ok: false, error: String((e as Error).message || e) });

  async function listOf(scope: TrackerScope, filters: string, limit: number): Promise<TrackerItem[]> {
    const project = await projectOf(scope);
    const rows = await call('GET', `/userstories?project=${project.id}${filters}&order_by=-modified_date&page_size=${limit}`, `the user stories of ${scope.id}`);
    return (Array.isArray(rows) ? rows : []).filter((us: any) => us && Number.isInteger(us.ref))
      .slice(0, limit).map((us: any) => itemOf(us, base(), project.slug, project.statuses, project.members));
  }

  /** A change of a user story, with its version as Taiga asks; the story read again just before. */
  async function change(scope: TrackerScope, id: string, what: string, make: (us: any, project: Project) => Promise<any> | any): Promise<WriteResult> {
    try {
      const { project, us } = await storyIn(scope, id);
      const body = await make(us, project);
      if (body === null) return { ok: true, error: '', url: storyUrl(scope, us.ref) };
      return await write('PATCH', `/userstories/${us.id}`, what, { ...body, version: us.version }, storyUrl(scope, us.ref));
    } catch (e) { return failed(e); }
  }

  return {
    id: api.name,
    title: 'Taiga',
    label: 'TAIGA',
    noun: { one: 'user story', many: 'user stories' },
    capabilities: {
      views: ['open', 'mine', 'assigned', 'iteration', 'query'],
      iterationWord: 'sprint',
      comment: true, worklog: false, transition: true, labels: true, assign: true, create: true,
      request: 'none',
    },
    idPattern: ITEM_RE,
    tokenVariables: ['TAIGA_TOKEN', 'TAIGA_APPLICATION_TOKEN', 'TAIGA_AUTH_TOKEN'],
    secret: () => token(),
    tokenShapes: [['a Taiga application token', TOKEN_RE], ['a Taiga session token', JWT_RE]],
    ready: () => (!base() ? `no Taiga address in ${api.settings.file} (url)`
      : !username() ? `no username in ${api.settings.file} (username)`
        : !token() ? `no application token in ${api.settings.file} (token)` : ''),
    // A workspace project has no Taiga project of its own: it remembers one, or the default is used.
    scopeOf: () => null,
    parseScope: (text) => {
      const t = String(text || '').trim().replace(/^.*\/project\/([a-z0-9-]+)\/?.*$/, '$1');
      return SLUG_RE.test(t) && base() ? { id: t, name: t, web: `${base()}/project/${t}/` } : null;
    },
    urlOf: (scope, id) => storyUrl(scope, id),
    account: async () => { try { return (await me()).name; } catch (_) { return ''; } },
    // The projects the token's account is a member of.
    scopes: async () => (await projectsOfMe()).map((p) => ({ id: p.slug, name: p.name, web: `${base()}/project/${p.slug}/` })),

    list: async (scope, q) => {
      const limit = Math.max(1, Math.min(q.limit, 100));
      const open = '&status__is_closed=false';
      if (q.view === 'mine') return listOf(scope, `${open}&assigned_users=${(await me()).id}`, limit);
      if (q.view === 'assigned') {
        if (!q.who) return [];
        const uid = await memberBy(await projectOf(scope), q.who, scope);
        return listOf(scope, `${open}&assigned_users=${uid}`, limit);
      }
      if (q.view === 'iteration') {
        const project = await projectOf(scope);
        const sprint = currentSprint(await call('GET', `/milestones?project=${project.id}&closed=false&page_size=${PAGE}`, `the sprints of ${scope.id}`));
        if (!sprint) return [];
        return listOf(scope, `${open}&milestone=${sprint.id}`, limit);
      }
      if (q.view === 'query') {
        const words = String(q.text || '').trim();
        if (!words) return [];
        return listOf(scope, `${open}&q=${encodeURIComponent(words)}`, limit);
      }
      return listOf(scope, open, limit);
    },

    get: async (scope, id) => {
      const { project, us } = await storyIn(scope, id);
      const ownerName = String((us.owner_extra_info && us.owner_extra_info.full_name_display) || '');
      const author = personOf(project, us.owner, ownerName);
      const editor = lastEditOf(await historyOf(us.id, false));
      const lastEditor = editor !== null && editor !== us.owner ? personOf(project, editor) : undefined;
      const comments: TrackerComment[] = (await historyOf(us.id, true))
        .filter((c: any) => c && !c.delete_comment_date && String(c.comment || '').trim())
        .sort((a: any, b: any) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
        .map((c: any) => ({ author: personOf(project, c.user && c.user.pk, String((c.user && c.user.name) || '')), body: String(c.comment).trim(), at: isoOf(c.created_at) || '' }));
      const full: TrackerItemFull = {
        ...itemOf(us, base(), project.slug, project.statuses, project.members),
        body: String(us.description || ''), author, ...(lastEditor ? { lastEditor } : {}), comments,
      };
      return full;
    },

    comment: async (scope, id, markdown) => change(scope, id, 'a comment on the user story', () => ({ comment: String(markdown || '') })),
    transitions: async (scope, id) => {
      const { project, us } = await storyIn(scope, id);
      return project.statuses.filter((s) => s.id !== us.status).map((s) => ({ id: `status:${s.id}`, name: `Change the status to ${s.name}` }));
    },
    transition: async (scope, id, to) => change(scope, id, 'the status of the user story', (us, project) => {
      const m = /^status:([0-9]{1,9})$/.exec(String(to));
      const status = m ? project.statuses.find((s) => s.id === Number(m[1])) : undefined;
      if (!status) throw new Error(`not a status of ${scope.id}: ${to}`);
      if (status.id === us.status) throw new Error(`#${us.ref} is ${status.name} already`);
      return { status: status.id };
    }),
    // Taiga's tags are free: a name the project has no tag for becomes a new tag, with no colour.
    labels: async (scope, id, add, remove) => change(scope, id, 'the tags of the user story', (us) => {
      const bad = [...add, ...remove].map((n) => n.trim()).filter((n) => n && !TAG_RE.test(n));
      if (bad.length) throw new Error(`not a tag Taiga keeps (no comma, at most 50 characters): ${bad.map((n) => `"${n}"`).join(', ')}`);
      const have: Array<[string, string | null]> = (Array.isArray(us.tags) ? us.tags : [])
        .map((t: any) => (Array.isArray(t) ? [String(t[0]), t[1] == null ? null : String(t[1])] : [String(t), null]) as [string, string | null]);
      const lower = (s: string) => s.trim().toLowerCase();
      const drop = new Set(remove.map(lower).filter(Boolean));
      const next = have.filter(([n]) => !drop.has(lower(n)));
      for (const n of add.map((a) => a.trim()).filter(Boolean)) if (!next.some(([x]) => lower(x) === lower(n))) next.push([n, null]);
      const same = next.length === have.length && next.every(([n], i) => n === have[i][0]);
      return same ? null : { tags: next };
    }),
    assign: async (scope, id, who) => change(scope, id, 'an assignee of the user story', async (us, project) => {
      const uid = await memberBy(project, who, scope);
      const users: number[] = Array.isArray(us.assigned_users) ? us.assigned_users.filter((n: unknown) => Number.isInteger(n)) : [];
      if (users.includes(uid) || us.assigned_to === uid) return null;
      return { assigned_users: [...users, uid], ...(Number.isInteger(us.assigned_to) ? {} : { assigned_to: uid }) };
    }),
    create: async (scope, item) => {
      try {
        const project = await projectOf(scope);
        const r = await write('POST', '/userstories', 'a new user story', { project: project.id, subject: String(item.title || ''), description: String(item.body || '') }, '');
        if (!r.ok) return r;
        const ref = r.result && Number.isInteger(r.result.ref) ? String(r.result.ref) : '';
        return ref ? { ok: true, error: '', url: storyUrl(scope, ref), id: ref } : { ok: false, error: 'Taiga made no user story (it answered no reference)' };
      } catch (e) { return failed(e); }
    },
  };
}
