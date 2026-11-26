#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the Taiga project in this folder.')
parser.add_argument('-r', '--run',
                    dest='RUN',
                    default="_none_",
                    help='Run one of Taiga\'s own management commands (python manage.py <command>) in its back end\'s container. Example: --run "showmigrations projects"')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Make the default accounts (owner, member, reader, stranger) and their roles in the project Webship site, or give them back their names, passwords and roles.')
parser.add_argument('-c', '--cancel-users',
                    action='store_true',
                    default=False,
                    help='Keep the default accounts from signing in: their work stays.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='Add the sample content the step pack and the tracker are tested on, where it is missing.')
parser.add_argument('-t', '--tidy',
                    action='store_true',
                    default=False,
                    help='Remove for good what a test run that was stopped half way left: its user stories, tasks and sprints, titled "Webship test …" and made by one of the default accounts in Webship site, and its comments starting "Webship test" on the other user stories. Nothing else is touched.')
parser.add_argument('--connect',
                    dest='CONNECT',
                    default="_none_",
                    help='Point the dashboard\'s Taiga at this site as this account: a new application token of it goes into core/config/plugin.taiga.settings.yml (never shown), with its username and the site\'s address. Example: --connect member')
ARGEOF
