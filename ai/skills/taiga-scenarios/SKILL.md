---
name: taiga-scenarios
description: Write webship-js scenarios for a Taiga site (the open-source agile project management platform) of the Webship Workspace from phrases that exist — the Taiga step pack's steps by area (signing in and out and a refused sign-in, a visitor sent to the sign-in form, the backlog and its sprints, a new user story, one user story with its status, comments, tags, assigned users, creator and tasks, the taskboard of a sprint, the Kanban board, the search, what a reader or someone the project does not have may not do, test content), the traps found on real sites, and whole features. Use when asked to write, extend or fix scenarios for a Taiga site, or when a scenario of the site fails on a phrase.
---

# taiga-scenarios

Scenarios for a site built with the Taiga plugin (`bash cmd-taiga-project.sh <site> --install --add-users
--sample-content`) in a container-based workspace (DDEV by default), tested with webship-js and
`@webship-js/taiga-steps` once `bash cmd-tools-testing.sh <site>` set the project up. Every phrase below exists in the
pack or in webship-js; a scenario names no platform.

## Accounts

- `Given I am a logged in user with the "member" user`: `owner` (the administrator of Webship site, as Product
  Owner), `member` (a member, as Back), `reader` (a reader: a role that only views), `stranger` (not in the project).
  `Given I am not logged in` for a visitor.
- The accounts are made by the build (`cmd-tools-taiga-cli.sh <site> --add-users`); a suite never creates or deletes
  one, and never writes a password: it signs in by the handle. Each signs in with its username (`member`) and shows
  as its full name (`Member Test`).

## Phrases by area

| Area | Steps |
| --- | --- |
| Session | `I am a logged in user with the "member" user`, `I log in with the "member" user`, `I log in as "member" with the password "…"`, `the login should be refused with "your username/email or password are incorrect"`, `I am not logged in`, `I log out`, `I should be logged in as "Member Test"` (or the username), `I should not be logged in`, `I should be sent to the login form` |
| The backlog | `I open the backlog of the project "Webship site"`, `the backlog should show the user story "…"` (`should not show`), `the sprint "Sprint 1" should show the user story "…"` (`should not show`), `I add the user story "Webship test …" to the backlog` (through "+ User story"; it goes after the scenario) |
| Test content | `there is a user story "Webship test …" in the project "Webship site"`, `… with the status "Ready" in the project "…"`, `… in the sprint "Sprint 1" of the project "…"` (each goes after the scenario), `there is no user story "Webship test …" in the project "Webship site"` |
| One user story | `I open the user story "…"` (by its subject, in the scenario's project), `I change the status of the user story to "Ready"`, `the user story should have the status "Ready"`, `I add the comment "…" to the user story`, `the user story should show the comment "…"` (`… by "Member Test"`), `I add the tag "bug" to the user story`, `the user story should have the tag "bug"` (`should not have`), `I assign the user story to "Member Test"`, `the user story should be assigned to "Member Test"`, `the user story should be created by "Owner Test"`, `the user story should have the task "…"` |
| Boards and search | `I open the taskboard of the sprint "Sprint 1" of the project "Webship site"`, `the taskboard should show the user story "…"` (`should not show`), `the taskboard should show the task "…" in the column "New"`, `I open the kanban board of the project "Webship site"`, `the column "In progress" should show the user story "…"` (`should not show`), `I search the project "Webship site" for "…"`, `the search should show the user story "…"` (`should not show`) |
| What an account may not do | `I should not be able to change the user story`, `I should not be able to comment on the user story`, `I should not be able to add a user story`, `I should be refused the project "Webship site"` |

## The sample content

`--sample-content` gives the private Scrum project Webship site (Kanban on too), administered by owner, with member and
reader, Sprint 1 (from three days before the build to eleven days after it) and three user stories: #1 "The greeting
script says Helo instead of Hello" (by owner, In progress in Sprint 1, assigned to member, tagged bug, with owner's
comment "Seen on the test site: the greeting prints Helo." and member's task #4 "Fix the spelling in greeting.sh"), #2
"The usage line spells greeting as greting" (by member, New in the backlog) and #3 "Add a test for the greeting" (by
owner, Done in Sprint 1). A suite reads them and never changes them.

## Traps found on real sites

- The site is one page that draws each screen once its scripts have run: the steps wait for the screen itself (the
  backlog's rows, the taskboard, the Kanban board after its "Loading..."), not for the address.
- The comment editor turns Save on once it has the focus, and takes the text a moment later: the step waits until the
  editor's draft holds the whole text before Save, so a fast Save never posts part of it.
- The tag field takes the name a moment later: a tag the project has is picked from the list under the field.
- A user story's number comes from one series with the project's tasks and issues: the steps open a user story by
  its subject, through the site's API.
- A reader gets the user story without its status menu, Add tag, Add assigned and comment editor, and the backlog
  without "+ User story"; an account the project does not have gets "Not found" (Error 404), and a visitor is sent to
  the sign-in form: tag those scenarios `@js-off`.
- Every screen asks for the person's saved settings of it and gets 404 for each one not saved yet: the browser logs
  them, and webship-js reports them in `warn` mode without failing.
- A run that was stopped half way leaves its "Webship test …" user stories: `bash cmd-tools-taiga-cli.sh <site> --tidy`
  removes them.

## Whole features

`examples/` holds three features that pass on a site built with `--install --add-users --sample-content`: the session
(`session.feature`), a user story worked by a member (`issue.feature`) and the roles (`roles.feature`).

## The book

For any automated functional testing in this work (a Gherkin feature, a step definition, choosing a
step, a test run and its failures), read the book *Automated Functional Testing Recipes* first.

- **Where.** Use the first that exists: `.claude/automated-functional-testing-recipes/` in the project,
  `~/.claude/automated-functional-testing-recipes/` (installed by webship/webship-js-ai-agent,
  webship/webship-js-skills or webship/ai-agents), or
  https://github.com/webship/webship-js-ai-agent/tree/2.0.x/automated-functional-testing-recipes
- **How.** Its `README.md` first, then the chapter that matches the task (one file per chapter,
  named by its subject), not the single complete file.
- **Which wins.** The installed webship-js package and the step pack are the source of truth for
  step phrasing. When they differ from the book, follow them and say so.
- **For a site.** Start with `ch10-authentication-authorization.md` (logins, refusals and what each role may do),
  `ch07-waiting-dynamic-content.md` (waiting on the app's own signals) and `ch26-testing-cms-applications.md`
  (content made and removed, roles, a workflow across roles).
