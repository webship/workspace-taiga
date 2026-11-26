#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project: its folder, its project in containers and its host name.')
parser.add_argument('--runtime',
                    dest='RUNTIME',
                    default="_none_",
                    choices=['ddev'],
                    help='The container runtime to build on: ddev (the default). Taiga is not proven on the other runtimes yet.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Set Taiga up with the workspace account as its administrator; the public sign-up stays off.')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='With --install, add the default accounts (owner: the administrator of the project Webship site, member: a member, reader: a reader that only views; stranger: not in it): the ones the test scenarios sign in as.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='With --install and --add-users, add the sample content the step pack and the tracker are tested on: Sprint 1 and the user stories of Webship site, an assignee, a tag, a comment and a task.')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the site in a browser when it is ready.')
ARGEOF
