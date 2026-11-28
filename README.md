# @webship.co/workspace-taiga

Taiga, the open-source agile project management platform, for the [Webship Workspace](https://github.com/webship/workspace),
a container-based workspace (DDEV by default). The plugin brings:

- **a builder**, `cmd-taiga-project.sh`: a real Taiga site from Taiga's own images, as its reference setup runs them, on
  the project's own PostgreSQL 12, on DDEV, Docker Compose, Podman or Kubernetes, with the workspace account as the
  site's administrator, the default
  accounts in their roles of a sample Scrum project, and its sprint, user stories, an assignee, a tag, a comment and a
  task;
- **a tool**, `cmd-tools-taiga-cli.sh`: what a site is, its accounts and its user stories, Taiga's own management
  commands, the default accounts, the sample content, a clean-up after a stopped test run, and the dashboard's
  connection;
- **the step pack** [`@webship-js/taiga-steps`](https://github.com/webship/taiga-steps) wired into the workspace's
  testing setup, with a first feature for a site;
- **the user stories as work items** of the tracker family
  ([`@webship.co/workspace-tracker`](https://github.com/webship/workspace-tracker)): the TAIGA menu on a project row
  lists them (the current sprint among its views), reads one, analyzes it, and lets the workspace's AI CLI work it on
  a branch, with a person in charge;
- **AI items** in their folders: three agents, a skill, a command and two prompts.

## Install

From the workspace's root, the same four steps as Settings → Plugins:

```bash
bash core/scripts/plugins.sh --require @webship.co/workspace-taiga
bash core/scripts/plugins.sh --activate taiga --with-needs
bash core/scripts/plugins.sh --install taiga --with-needs
bash core/scripts/plugins.sh --configure taiga
```

## What it needs

- A sites folder: one of the `dev`, `test`, `sandboxes` or `demos` plugins. The commands are placed there.
- The AI folders `ai-agents`, `ai-skills`, `ai-commands` and `ai-prompts`, where its AI items land.
- A container runtime: DDEV (the default), Docker Compose, Podman or Kubernetes. On Docker Compose and Podman the
  Workspace's core must start a project's own services again when they stop on their own (webship/workspace#959, core
  1.0.45): the builder says so on an older core, and changes nothing. Lando and Docksal are not proven for Taiga yet.
- A download of about 1.3 GB for Taiga's images the first time, and memory: the builder asks for 2 GB free before it
  starts (`free -m`).

## Build a site

```bash
cd ~/workspace/sandboxes                      # or dev, test, demos
bash cmd-taiga-project.sh mysite --install --add-users --sample-content
```

| Flag | What it does |
| --- | --- |
| `--install` | Makes the workspace account (`account` of `core/config/settings.yml`) the site's administrator (its Django admin at `/admin/` too). Taiga's own forms ask a password of at least six characters. The public sign-up stays off |
| `--add-users` | With `--install`: the default accounts, in their roles of the Scrum project Webship site |
| `--sample-content` | With `--install --add-users`: Sprint 1, three user stories of Webship site (two in the sprint, one in the backlog), an assignee, a tag, a comment and a task |
| `--runtime <runtime>` | `ddev` (the default, or `container.runtime` of `settings.yml`), `docker` (Docker Compose), `podman` or `kubernetes`: see [On Docker Compose, Podman and Kubernetes](#on-docker-compose-podman-and-kubernetes) |
| `--launch` | Open the site when it is ready |

A project of the same name is deleted first, with its database and its volumes. The site is Taiga's reference setup
([taigaio/taiga-docker](https://github.com/taigaio/taiga-docker)) beside a generic project's web container, at
`https://mysite.ddev.site`: its back end, the back end's Celery worker (async), its front end, its events (the live
board), its protected media, the nginx gateway in front of them (its routes, `taiga/gateway.conf`, are the reference's,
written anew), and the two RabbitMQ, one for the worker and one for the events. Taiga's static files, its media and the
two RabbitMQ keep their data in volumes named after the project (`ddev-mysite-taiga-static`, `-taiga-media`,
`-taiga-async-rabbitmq`, `-taiga-events-rabbitmq`), which go with it. The project's web container keeps the mail
catcher, at `https://mysite.ddev.site:8026`, where the site's mail goes.

| Image | What it is | Source and licence |
| --- | --- | --- |
| `docker.io/taigaio/taiga-back:6.10.2` | Taiga's back end (Django), and its Celery worker | [taigaio/taiga-back](https://github.com/taigaio/taiga-back), MPL-2.0 |
| `docker.io/taigaio/taiga-front:6.10.3` | Taiga's front end | [taigaio/taiga-front](https://github.com/taigaio/taiga-front), AGPL-3.0 |
| `docker.io/taigaio/taiga-events:6.10.0` | Taiga's events (websockets) | [taigaio/taiga-events](https://github.com/taigaio/taiga-events), MPL-2.0 |
| `docker.io/taigaio/taiga-protected:6.10.1` | Taiga's protected media | [taigaio/taiga-protected](https://github.com/taigaio/taiga-protected), MPL-2.0 |
| `docker.io/library/nginx:1.19.10-alpine` | The gateway on DDEV (on the other runtimes Debian's nginx package, in the web container) | [nginx](https://nginx.org), BSD-2-Clause; the image's own files, [nginxinc/docker-nginx](https://github.com/nginxinc/docker-nginx), BSD-2-Clause |
| `docker.io/library/rabbitmq:3.8.34-management-alpine` | The two RabbitMQ | [rabbitmq/rabbitmq-server](https://github.com/rabbitmq/rabbitmq-server), MPL-2.0; the image's own files, [docker-library/rabbitmq](https://github.com/docker-library/rabbitmq), MIT |
| DDEV's `postgres:12` (the stack's `postgres:12` on the other runtimes) | The project's database | [PostgreSQL](https://www.postgresql.org), PostgreSQL License |

Every image is pinned, never `latest`: Taiga's at the newest 6.10 release of each, and nginx and RabbitMQ at the exact
releases the reference's tags (`1.19-alpine`, `3.8-management-alpine`) stand for today. A build runs what was proven.

**The database is PostgreSQL 12.** Taiga needs PostgreSQL. The project's own db service runs it (DDEV's `postgres:12`),
the major version Taiga's reference pins; the back end and the worker reach it as `db`.

**Settings.** Taiga's telemetry is off (`ENABLE_TELEMETRY=False`), and so is its public sign-up
(`PUBLIC_REGISTER_ENABLED=False` in the back end, `false` in the front end): the sign-in page offers no sign-up, and an
administrator makes the accounts.

**Two changes from the reference setup**, each said in the compose file:

- **The events come back on their own** (`restart: on-failure` on `taiga-events`). taiga-events 6.10.0 exits on an
  unhandled rejection ("Channel ended, no reply will be forthcoming") when a page closes its websocket right after
  subscribing, as a quick change of page does. The reference sets no restart policy, so its live updates stop, and
  every page's websocket is answered 502 until someone starts the service again.
- **The Celery worker starts after the back end** (`taiga-async` depends on `taiga-back`). Both mount the same new
  static volume, which Docker fills from the image when a container is made with it, and two made at once can fail
  ("mkdir …/_data/img: file exists"). The reference makes the two at once.

**How the accounts are made.** The builder's script (`taiga/taiga-site.py` of the project) runs with Taiga's own code
in its back end's container, through `python manage.py shell`. With `--install` the workspace account becomes the
site's administrator. The default accounts, the sample project from Taiga's own Scrum template (with Kanban on too),
its reader role (the template has none: a role that only views) and the memberships are made with Taiga's models; the
sprint, the user stories, the assignee, the tag, the comment and the task through Taiga's REST API there, as each
part's author, so Taiga keeps its history and its references as its screens would. The passwords come on the script's
input, never on a command line, never in a log.

The site's own values (its secret key, the RabbitMQ account) are kept in `taiga/*.env` of the project, which only you
can read. The builder never prints them. Taiga's events service writes the session tokens it is given into its own log
at info level: the builder never prints that log.

### On Docker Compose, Podman and Kubernetes

```bash
bash cmd-taiga-project.sh mysite --install --add-users --sample-content --runtime docker   # or podman, kubernetes
```

The builder works through the Workspace's runtime layer there, and the site is the same: Taiga 6.10 on the project's
own PostgreSQL 12, the same accounts and the same sample content, at the address the runtime gives it
(`http://127.0.0.1:<port>`, or the node's address and a NodePort on Kubernetes). The stack's Mailpit catches its mail.
The layout differs from DDEV's in one place, the back end:

- **Taiga's back-end image is the web container's** (`rt_stack image`, with nginx added). Once the project's
  PostgreSQL takes connections (the stack's start waits for it), the container runs as the host user
  (`taiga/taiga-serve.sh`, `rt_serve`) what the image's own start does: Taiga's migrations and its project templates,
  then its API. It also runs the back end's Celery worker with its scheduler, and the gateway (nginx, with the routes
  of the gateway on DDEV, in `taiga/nginx.conf`), which are containers of their own on DDEV. Two reasons: the back end
  makes its tables as it starts, so it must start once the database answers; and the gateway serves the media the back
  end writes, through the protected service's answer, from the same folder.
- **The web container stops when its API, its Celery worker or its gateway stops**, and stops the other two first,
  with a code that is not 0. On Kubernetes the pod then starts again; on Docker Compose and Podman the project's row
  shows it stopped, never half of Taiga running. Start the project again (`ddev start`, or the row's switch).
- **Taiga's other services are services of the project's own** (`rt_service`), under the names they have on DDEV, so
  the site's values are the same: the front end (`taiga-front`), the events (`taiga-events`), the protected media
  (`taiga-protected`), and the two RabbitMQ (`taiga-events-rabbitmq`, `taiga-async-rabbitmq`), each with its data in a
  volume of the project's own and a node name (`rabbit@localhost`) that stays when its container gets another host
  name. None of them needs the database or another service to start.
- **The events come back on their own** there too: Docker Compose and Podman start a project's own service again when
  it stops on its own (`restart: on-failure`, webship/workspace#959, core 1.0.45), and Kubernetes does by itself. The
  builder asks for that core on Docker Compose and Podman.
- **The database is the stack's PostgreSQL 12** (`postgres:12`), as on DDEV, reached as `db`.
- **The media** Taiga keeps beside its database are in the project's `taiga/files/media`. Taiga's static files are the
  image's own.
- **At a plain http address** Taiga's cookies are not Secure (`SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`), so a
  browser keeps them, and its events go over `ws://`.
- **The site script and Taiga's own commands** run in the web container, with the site's values, as Taiga's back end.

The project's volumes go with it when it is removed (`cmd-tools-remove.sh`), and when a project of the same name is
built again.

### Backups

Taiga's database is the project's PostgreSQL on every runtime: DDEV's, or the runtime's. The core backs it up and puts
it back itself, as for any project on PostgreSQL:

- **A backup** is the core's own dump: a gzipped PostgreSQL dump (`…-db.sql.gz`) beside the project's archive.
- **The row's Import** on Docker Compose, Podman and Kubernetes puts the dump into a database of its own and swaps it
  in, which a Taiga that is connected to its database does not stop.
- **On DDEV**, DDEV's own import drops the database first, which PostgreSQL refuses while Taiga's back end or its Celery
  worker are connected, as they can be once the site has been used. The Workspace's core 1.0.47 and later close the
  database to new connections and end its sessions first, so the Import goes through and Taiga connects again by
  itself (webship/workspace#968). On an older core, stop Taiga's back end and its worker before an Import on DDEV, and
  start them again after: `docker stop ddev-<name>-taiga-async ddev-<name>-taiga-back`, then
  `docker start ddev-<name>-taiga-back ddev-<name>-taiga-async`.
- **What Taiga keeps beside its database** (attachments, photos, exports): on DDEV in the project's media volume, which
  the backup does not hold; on the other runtimes in the project's `taiga/files/media`, which the project's archive
  holds.

### The default accounts

| Account | Name | Their role in Webship site |
| --- | --- | --- |
| `owner` | Owner Test | Its administrator, as Product Owner |
| `member` | Member Test | A member, as Back: changes user stories, tasks and issues |
| `reader` | Reader Test | A reader: a role that only views |
| `stranger` | Stranger Test | None: the project does not have them, and its pages are not found for them |

Each has the password of the workspace's other default lists, `dD.123123ddd`, signs in with its username, and shows as
its full name. They are configuration: a test suite never creates or deletes one. `bash cmd-tools-add-users.sh mysite
taiga` and `bash cmd-tools-cancel-users.sh mysite taiga` (the row's Tests menu) add them and keep them from signing
in. Keeping an account from signing in removes its application tokens too: Taiga 6.10.2 still takes the application
token of an account that may not sign in (its session token is refused, "User is inactive").

### The sample content

Webship site, a private Scrum project (Kanban on too) administered by owner, with member and reader: Sprint 1, from
three days before the build to eleven days after it, and three user stories: #1 "The greeting script says Helo instead
of Hello" (by owner, In progress in Sprint 1, assigned to member, tagged bug, with owner's comment and member's task
#4 "Fix the spelling in greeting.sh"), #2 "The usage line spells greeting as greting" (by member, New in the backlog)
and #3 "Add a test for the greeting" (by owner, Done in Sprint 1).

## The tool

```bash
bash cmd-tools-taiga-cli.sh mysite                                 # what the site is: release, address, accounts, user stories
bash cmd-tools-taiga-cli.sh mysite --sample-content                # the sample content, where it is missing
bash cmd-tools-taiga-cli.sh mysite --tidy                          # what a stopped test run left
bash cmd-tools-taiga-cli.sh mysite --add-users                     # the default accounts, their passwords and roles back
bash cmd-tools-taiga-cli.sh mysite --cancel-users                  # keep them from signing in
bash cmd-tools-taiga-cli.sh mysite --connect member                # the dashboard reads this site as member
bash cmd-tools-taiga-cli.sh mysite --run "showmigrations projects" # one of Taiga's own management commands
```

`--connect <login>` makes a new application token of the account for the Webship Workspace application, with Taiga's
own code, in the place of its earlier one, and writes it, with the account's username and the site's address, into
`core/config/plugin.taiga.settings.yml`, and the sample project (`webship-site`) as the default one when none was set.
The token is never shown. The dashboard then acts as that person. An application token does not expire: it lasts until
it is removed (connect again, cancel the account, or delete it through Taiga's API).

`--tidy` deletes for good, with no way back. It removes what a stopped test run left: the user stories, tasks and
sprints titled "Webship test …" made by one of the default accounts in Webship site, and the comments starting "Webship
test" that a default account left on its other user stories. Anything with another title or another author stays.

## The user stories as work items

The plugin is a provider of the tracker family. With a Taiga address, a username and an application token in its
settings (`--connect` writes them for a site the workspace built), the project rows of sites and code folders carry
the **TAIGA** menu, once they have a Taiga project to work against (`default_scope` as the project's slug,
`webship-site`, or one remembered from the list):

- **The list**: the open user stories (the ones whose status is not a closed one), mine (the ones the person is among
  the assigned users of), someone's, the current sprint's, and a search (Taiga's own text filter). A user story's state
  is its status (New, Ready, In progress, Ready for test, Done, Archived in the Scrum template), and its iteration the
  sprint it is in.
- **The current sprint** is the iteration view: the open sprint whose dates hold today (Taiga's milestones), the one
  that ends first when two do.
- **One user story** (its number, `#1`): its text, its author with their standing, its tags, its sprint and its
  comments. Its number comes from one series with the project's tasks and issues: a number that is a task or an
  issue is not a user story here.
- **Analyze**: the AI CLI reads it and proposes a plan, with reading tools only.
- **Do the work**: the AI CLI works it on a new branch of the project (or a worktree), made from the default branch of
  the project's remote, in a screen session you watch. The user story is saved as data, never as instructions; Taiga
  keeps Markdown.
- **Result**: the branch, its commits and the notes, the reviewer role, and the comment to post.
- With writes on (`allow_writes: true`): a comment, a change of status (the project's statuses), tags (Taiga's tags are
  free: a name the project has no tag for becomes a new one, with no colour), an assignee (`me`, or a member of the
  project, by their name or username) and a new user story in the backlog, each your click after a preview. Every
  change carries the user story's version, as Taiga asks.

Every read and write goes through Taiga's REST API (`/api/v1`), as the connected person, with an application token
(`Authorization: Application <token>`).

**The application token.** Taiga makes one per person and application: the builder's `--connect` makes it with Taiga's
own code, and on your own Taiga a person authorises the application on Taiga's own screen,
`/external-apps?application=<id>&state=<any>` ("Authorize … to use your Taiga account?"). Taiga then sends the person on
to the application's next address with a one-time code, which `POST /api/v1/application-tokens/validate` (with the
application's id and the same state) turns into the token. A person lists their tokens (no value shown) and deletes one
through `GET` and `DELETE /api/v1/application-tokens`; no screen lists them.

**Who is inside.** Each person's standing is their membership of the project: its administrators are owners of it; a
member whose role may change user stories is a member. A member whose role may not (a reader, a stakeholder), someone
no longer active, and someone the project does not have are outside. A user story made, or last edited, by someone
outside is analyze only unless you confirm it by its author's name (`outsider_items: refuse` refuses it), and each
comment's author counts on their own.

**The last editor** is the person of the newest change of the subject or the description in the user story's
history, when not its creator.

**Credentials.** The token travels in a file only you can read, never on a command line. Before anything is posted,
the text is checked for credentials: the ones the tracker family knows, the token of the settings, and anything shaped
like a Taiga application token (`eyJ…:…:…`) or a Taiga session token (a JWT).

Taiga opens no pull request: push the branch and open its pull request from the project's forge menu (GITHUB,
GITLAB) when its remote is on a forge.

### Settings

`core/config/plugin.taiga.settings.yml` (Settings → Plugins → Taiga):

| Key | What it is |
| --- | --- |
| `url` | The Taiga address, without a trailing slash |
| `username` | The username of the account the dashboard reads (and, with writes on, writes) as |
| `token` | An application token of that account. Never printed |
| `allow_writes` | Comments, status changes, tags, assignees and new user stories to Taiga; `false` by default |
| `max_agents` | Author sessions at once |
| `default_scope` | The Taiga project a workspace project works against when it remembers none: its slug, `webship-site` |
| `scopes` | The Taiga projects (their slugs) the list may be switched to; empty is any project the account is a member of |
| `work_in` | `branch` (a new branch in the project) or `worktree` (outside the workspace folders) |
| `sandbox` | `required` (the AI CLI's sandbox, and no session without it) or `off` (a person's choice) |
| `network_domains` | The domains the sandbox allows (the project's package registries) |
| `allow_web` | Web fetch and web search in the author session |
| `comments_from` | The comments a saved user story keeps: `members` (the project's administrators and the members whose role may change user stories), `all`, `none` |
| `outsider_items` | A user story from outside the project: `analyze` (work it only after a confirmation by name) or `refuse` |

## What the plugin does not do yet

- **A worklog.** Taiga has no time tracking of its own: there is no time to read or log on a user story.
- **Tasks, issues and epics as work items.** The work items are the project's user stories; their tasks show on a
  user story's page and on the taskboard.
- **Lando and Docksal.** Taiga is proven on DDEV, Docker Compose, Podman and Kubernetes.

## Testing a site

```bash
bash cmd-tools-testing.sh mysite                       # webship-js, the step pack, the users registry, a first feature
bash cmd-tools-testing.sh mysite --run
```

The testing setup adds `@webship-js/taiga-steps` to the project, its step definitions to `cucumber.js`, the managing
account (`owner`, which makes and removes the test content through the site's REST API), the project of the steps
(`Webship site`), the users registry (`owner`, `member`, `reader`, `stranger`, each signing in with its username), and
`tests/features/site.feature`, whose first scenario checks a visitor is sent to the sign-in form. The suite leaves the
site as it found it.

## AI items

| Kind | Item | What it is for |
| --- | --- | --- |
| Agent | `taiga-site-builder` | Build, look after and remove Taiga sites |
| Agent | `taiga-tester` | Test a site with the step pack: look at the screens first, write scenarios, run, read |
| Agent | `taiga-issue-worker` | Work a user story on a branch, the writes left to a person |
| Skill | `taiga-scenarios` | The pack's phrases by area, the traps found on real sites, whole features |
| Command | `/taiga-test <site>` | Set the testing stack up, run the suite, report |
| Prompt | `taiga-build-and-test` | Build a site and prove it with its first feature |
| Prompt | `taiga-issue-to-branch` | Work a user story on a branch |

## License

ISC (see `LICENSE`). Taiga's back end, events and protected media are MPL-2.0, and its front end AGPL-3.0: the plugin
runs Taiga's own images, and nginx's, RabbitMQ's and PostgreSQL's, and carries none of their code. Its gateway's routes
follow the reference setup's, written anew.
