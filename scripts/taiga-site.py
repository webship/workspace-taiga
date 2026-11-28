# The Taiga builder's script: the site's administrator, its default accounts and their roles in the sample project,
# the sample content, the clean-up after a stopped test run, and the dashboard's connection, with Taiga's own code in
# its back end's container: its models for the accounts, the project, its roles and memberships and the application
# token; its REST API (at http://localhost:8000, inside the container) for the content, as each part's author, so
# Taiga keeps its history, its references and its events as its screens would.
#
# Run by the plugin's functions, in the back end's container, through Taiga's own shell:
#   TAIGA_SITE_VERB=<verb> [TAIGA_SITE_FLAG=list] python manage.py shell -c "exec(open('/opt/webship/taiga-site.py').read())"
# with what it needs (accounts, passwords, a login) on its input, as the base64 of a JSON object, never on a command
# line. A token it makes is printed only by the verb "token", on its own line (TOKEN …), for the tool to store.
#
# Verbs: version, brokers, install, accounts, content, tidy (with the flag "list": only what it would remove), list, token,
# counts.

import base64
import datetime
import json
import os
import re
import sys

import requests
from django.apps import apps
from django.db import transaction

VERB = os.environ.get('TAIGA_SITE_VERB', '')
FLAG = os.environ.get('TAIGA_SITE_FLAG', '')
API = 'http://localhost:8000/api/v1'
PROJECT = 'Webship site'
TEST = 'Webship test'
APP = 'Webship Workspace'
# A role that reads the project and changes nothing: the template has none, so the builder adds it.
READER = ('Reader', 'reader', ['view_project', 'view_milestones', 'view_epics', 'view_us', 'view_tasks', 'view_issues', 'view_wiki_pages', 'view_wiki_links'])
# Each default account's role in the sample project (its slug) and whether it administers the project.
ROLES = {'owner': ('product-owner', True), 'member': ('back', False), 'reader': ('reader', False)}

User = apps.get_model('users', 'User')
Role = apps.get_model('users', 'Role')
Project = apps.get_model('projects', 'Project')
ProjectTemplate = apps.get_model('projects', 'ProjectTemplate')
Membership = apps.get_model('projects', 'Membership')
UserStory = apps.get_model('userstories', 'UserStory')
Task = apps.get_model('tasks', 'Task')
Milestone = apps.get_model('milestones', 'Milestone')
HistoryEntry = apps.get_model('history', 'HistoryEntry')
Application = apps.get_model('external_apps', 'Application')
ApplicationToken = apps.get_model('external_apps', 'ApplicationToken')


class Fail(Exception):
    pass


def payload():
    raw = sys.stdin.read().strip()
    return json.loads(base64.b64decode(raw).decode()) if raw else {}


def say(text):
    print(text, flush=True)


def user_named(login):
    return User.objects.filter(username=login).first()


def project():
    return Project.objects.filter(name=PROJECT).order_by('id').first()


class Session:
    """A person signed in to Taiga's REST API inside the container: their JWT, kept in this process only."""

    def __init__(self, login, password):
        r = requests.post(API + '/auth', json={'type': 'normal', 'username': login, 'password': password}, timeout=60)
        if r.status_code != 200:
            raise Fail('%s cannot sign in to Taiga (%s)' % (login, r.status_code))
        data = r.json()
        self.login = login
        self.id = data['id']
        self.headers = {'Authorization': 'Bearer ' + data['auth_token'], 'Content-Type': 'application/json'}

    def call(self, method, route, body=None, what=''):
        r = requests.request(method, API + route, headers=self.headers, data=json.dumps(body) if body is not None else None, timeout=60)
        if r.status_code >= 300:
            raise Fail('%s %s answered %s: %s' % (method, route, r.status_code, r.text[:300]))
        return r.json() if r.content else None


def verb_version(_):
    import taiga
    say('VERSION %s' % taiga.__version__)


def verb_brokers(_):
    # Whether each of Taiga's RabbitMQ takes a connection as its back end makes one (its settings' broker URLs, kombu):
    # the Celery worker's and the events', one line each, "BROKER <name> ok" or "BROKER <name> <why>", never the URL,
    # which carries the RabbitMQ account's password. One attempt each: the builder asks again until both take it.
    from django.conf import settings
    from kombu import Connection
    for name, url in (('taiga-async-rabbitmq', settings.CELERY_BROKER_URL), ('taiga-events-rabbitmq', settings.EVENTS_PUSH_BACKEND_URL)):
        try:
            with Connection(url, connect_timeout=5) as connection:
                connection.ensure_connection(max_retries=0)
            say('BROKER %s ok' % name)
        except Exception as e:
            why = (str(e).strip().splitlines() or [type(e).__name__])[0]
            say('BROKER %s %s' % (name, re.sub(r'amqps?://\S+', 'its address', why)[:160]))


def verb_install(p):
    login, password = p.get('login'), p.get('password')
    if not login or not password:
        raise Fail('no workspace account was given')
    with transaction.atomic():
        u = user_named(login)
        if not u:
            if User.objects.filter(email=p.get('mail')).exclude(username=login).exists():
                raise Fail('another account has the address %s' % p.get('mail'))
            u = User(username=login, email=p.get('mail'))
        u.email = p.get('mail') or u.email
        u.full_name = p.get('name') or login
        u.is_active = True
        u.is_superuser = True
        u.read_new_terms = True
        u.set_password(password)
        u.save()
    say('ADMIN %s' % login)
    say("%s is Taiga's administrator (its Django admin at /admin/ too); the public sign-up is off: an administrator makes the accounts." % login)


def ensure_project(owner):
    pr = project()
    if not pr:
        template = ProjectTemplate.objects.get(slug='scrum')
        pr = Project.objects.create(name=PROJECT, description='The sample project of a Taiga site the Webship Workspace built.',
                                    owner=owner, creation_template=template, is_private=True)
        say('The project %s was made, owned by %s.' % (PROJECT, owner.username))
    changed = False
    for attr in ('is_backlog_activated', 'is_kanban_activated', 'is_issues_activated'):
        if not getattr(pr, attr):
            setattr(pr, attr, True)
            changed = True
    if changed:
        pr.save()
    name, slug, permissions = READER
    role = pr.roles.filter(slug=slug).first()
    if not role:
        role = Role.objects.create(project=pr, name=name, slug=slug, permissions=permissions, computable=False,
                                   order=pr.roles.count() + 1)
    elif sorted(role.permissions) != sorted(permissions):
        role.permissions = permissions
        role.save()
    return pr


def verb_accounts(p):
    rows = p.get('rows') or []
    made = {}
    with transaction.atomic():
        for row in rows:
            u = user_named(row['login'])
            if not u:
                u = User(username=row['login'], email=row['mail'])
                say('  %s: made' % row['login'])
            elif row.get('action') == 'lock':
                u.is_active = False
                u.save()
                # Taiga 6.10 still takes an application token of an account that may not sign in, so its tokens go too.
                gone, _ = ApplicationToken.objects.filter(user=u).delete()
                say('  %s: kept from signing in%s' % (row['login'], ', its application token(s) removed (%d)' % gone if gone else ''))
                continue
            else:
                say('  %s: its name and password given back, and it may sign in' % row['login'])
            u.email = row['mail']
            u.full_name = row['name']
            u.is_active = True
            u.read_new_terms = True
            u.set_password(row['password'])
            u.save()
            made[row['login']] = u
        if any(r.get('action') == 'lock' for r in rows):
            return
        owner_row = next((r for r in rows if r.get('role') == 'owner'), None)
        if not owner_row:
            return
        pr = ensure_project(made[owner_row['login']])
        for row in rows:
            u = made.get(row['login'])
            if not u:
                continue
            m = Membership.objects.filter(project=pr, user=u).first()
            role = ROLES.get(row.get('role') or '')
            if not role:
                if m and m.user_id != pr.owner_id:
                    m.delete()
                    say('  %s: taken off %s' % (row['login'], PROJECT))
                continue
            slug, admin = role
            r = pr.roles.get(slug=slug)
            if not m:
                Membership.objects.create(project=pr, user=u, role=r, is_admin=admin, email=u.email)
            elif m.role_id != r.id or m.is_admin != admin:
                m.role = r
                m.is_admin = admin
                m.save()
    say('The accounts are in their roles of %s: %s.' % (PROJECT, ', '.join(
        '%s %s' % (r['login'], {'owner': 'its administrator (Product Owner)', 'member': 'a member (Back)', 'reader': 'a reader (Reader, view only)'}.get(r.get('role') or '', 'not in it')) for r in rows)))


def status_id(pr, name):
    return pr.us_statuses.get(name=name).id


def verb_content(p):
    rows = {r['role'] or 'stranger': r for r in (p.get('rows') or [])}
    if 'owner' not in rows or 'member' not in rows:
        raise Fail('the owner and the member of the default accounts were not given')
    pr = project()
    if not pr:
        raise Fail('no project %s: add the default accounts first (--add-users)' % PROJECT)
    owner = Session(rows['owner']['login'], rows['owner']['password'])
    member = Session(rows['member']['login'], rows['member']['password'])
    today = datetime.date.today()
    sprint = pr.milestones.filter(name='Sprint 1').first()
    if not sprint:
        s = owner.call('POST', '/milestones', {'project': pr.id, 'name': 'Sprint 1',
                                                 'estimated_start': str(today - datetime.timedelta(days=3)),
                                                 'estimated_finish': str(today + datetime.timedelta(days=11))})
        sprint = Milestone.objects.get(id=s['id'])
        say('  the sprint Sprint 1')
    stories = [
        ('The greeting script says Helo instead of Hello', owner, 'In progress', sprint.id,
         '`greeting.sh` prints *Helo* where it should print *Hello*.'),
        ('The usage line spells greeting as greting', member, 'New', None,
         'The usage line of `greeting.sh` says *greting*.'),
        ('Add a test for the greeting', owner, 'Done', sprint.id,
         'A test that runs `greeting.sh` and expects *Hello*.'),
    ]
    made = {}
    for subject, by, status, milestone, description in stories:
        there = pr.user_stories.filter(subject=subject).first()
        if there:
            made[subject] = (there, False)
            continue
        body = {'project': pr.id, 'subject': subject, 'description': description, 'status': status_id(pr, status)}
        if milestone:
            body['milestone'] = milestone
        us = by.call('POST', '/userstories', body)
        made[subject] = (UserStory.objects.get(id=us['id']), True)
        say('  the user story "%s" (%s), by %s' % (subject, status, by.login))
    first, fresh = made[stories[0][0]]
    if fresh:
        # Assigned to the member, tagged bug, with the owner's comment and the member's task.
        us = owner.call('GET', '/userstories/%d' % first.id)
        us = owner.call('PATCH', '/userstories/%d' % first.id, {'assigned_to': member.id, 'tags': [['bug', '#e44057']], 'version': us['version']})
        owner.call('PATCH', '/userstories/%d' % first.id, {'comment': 'Seen on the test site: the greeting prints Helo.', 'version': us['version']})
        member.call('POST', '/tasks', {'project': pr.id, 'user_story': first.id, 'subject': 'Fix the spelling in greeting.sh', 'assigned_to': member.id, 'milestone': sprint.id})
    say('The sample content of %s is there: Sprint 1, its three user stories, the assignee, the tag, the comment and the task.' % PROJECT)


def default_ids(rows):
    return list(User.objects.filter(username__in=[r['login'] for r in rows]).values_list('id', flat=True))


def verb_tidy(p):
    pr = project()
    if not pr:
        say('No project %s: nothing to tidy.' % PROJECT)
        return
    ids = default_ids(p.get('rows') or [])
    stories = list(pr.user_stories.filter(subject__startswith=TEST, owner_id__in=ids))
    gone = [us.id for us in stories]
    tasks = list(pr.tasks.filter(subject__startswith=TEST, owner_id__in=ids).exclude(user_story_id__in=gone))
    sprints = list(pr.milestones.filter(name__startswith=TEST, owner_id__in=ids))
    key = lambda us: 'userstories.userstory:%d' % us.id
    comments = list(HistoryEntry.objects.filter(key__in=[key(us) for us in pr.user_stories.exclude(id__in=gone)],
                                                comment__startswith=TEST, user__pk__in=ids))
    for us in stories:
        say('  %s the user story "%s"' % ('would remove' if FLAG == 'list' else 'removed', us.subject))
    for t in tasks:
        say('  %s the task "%s"' % ('would remove' if FLAG == 'list' else 'removed', t.subject))
    for s in sprints:
        say('  %s the sprint "%s"' % ('would remove' if FLAG == 'list' else 'removed', s.name))
    for c in comments:
        say('  %s a comment "%s"' % ('would remove' if FLAG == 'list' else 'removed', c.comment[:60]))
    if FLAG != 'list':
        with transaction.atomic():
            for us in stories:
                us.delete()
            for t in tasks:
                t.delete()
            for s in sprints:
                s.delete()
            for c in comments:
                c.delete()
    say('tidy: %d user story(ies), %d task(s), %d sprint(s) and %d comment(s) %s.' % (
        len(stories), len(tasks), len(sprints), len(comments), 'to remove' if FLAG == 'list' else 'removed'))


def verb_list(p):
    pr = project()
    say('The accounts:')
    for u in User.objects.filter(is_system=False).order_by('id'):
        m = Membership.objects.filter(project=pr, user=u).select_related('role').first() if pr else None
        role = ('%s of %s%s' % (m.role.name, PROJECT, ', its administrator' if m.is_admin else '')) if m and m.role else ('not in %s' % PROJECT)
        say('  %-16s %s%s%s' % (u.username, role, " (the site's administrator)" if u.is_superuser else '', '' if u.is_active else ' (kept from signing in)'))
    if pr:
        say('The user stories of %s:' % PROJECT)
        for us in pr.user_stories.select_related('status', 'milestone').order_by('ref'):
            say('  #%d %s (%s%s)' % (us.ref, us.subject, us.status.name if us.status else '?', ', ' + us.milestone.name if us.milestone else ', backlog'))


def verb_token(p):
    login = p.get('login') or ''
    u = user_named(login)
    if not u or not u.is_active:
        raise Fail('no active account %s on the site' % login)
    # The application the dashboard's tokens belong to. Its next address is the site itself: a person who authorises it
    # on Taiga's own screen (/external-apps?application=<id>&state=…) comes back to the site.
    site = '%s://%s/' % (os.environ.get('TAIGA_SITES_SCHEME', 'https'), os.environ.get('TAIGA_SITES_DOMAIN', 'localhost'))
    app = Application.objects.filter(name=APP).first()
    if not app:
        app = Application.objects.create(name=APP, web='https://webship.co', description='The Webship Workspace dashboard, reading and writing as the person.', next_url=site)
    elif app.next_url != site:
        app.next_url = site
        app.save()
    with transaction.atomic():
        t, _ = ApplicationToken.objects.get_or_create(user=u, application=app)
        t.token = None
        t.save()
        t.generate_token()
        t.save()
    pr = project()
    if pr:
        say('SCOPE %s' % pr.slug)
    say('TOKEN %s' % t.token)


def verb_counts(p):
    pr = project()
    say('accounts %d' % User.objects.filter(is_system=False).count())
    if not pr:
        say('project 0')
        return
    say('project 1')
    say('memberships %d' % pr.memberships.count())
    say('roles %d' % pr.roles.count())
    say('sprints %d' % pr.milestones.count())
    say('user stories %d' % pr.user_stories.count())
    say('tasks %d' % pr.tasks.count())
    say('issues %d' % pr.issues.count())
    keys = ['userstories.userstory:%d' % i for i in pr.user_stories.values_list('id', flat=True)]
    say('comments %d' % HistoryEntry.objects.filter(key__in=keys).exclude(comment='').exclude(comment__isnull=True).count())
    say('tags %d' % len(pr.tags_colors or []))
    say('application tokens %d' % ApplicationToken.objects.count())


VERBS = {'version': verb_version, 'brokers': verb_brokers, 'install': verb_install, 'accounts': verb_accounts, 'content': verb_content,
         'tidy': verb_tidy, 'list': verb_list, 'token': verb_token, 'counts': verb_counts}

if VERB not in VERBS:
    say('taiga-site.py: no verb %s; one of %s' % (VERB or '(none)', ', '.join(VERBS)))
    sys.exit(2)
try:
    VERBS[VERB](payload() if VERB not in ('version', 'brokers') else {})
except Fail as e:
    say('Taiga: %s' % e)
    sys.exit(1)
