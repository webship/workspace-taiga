#!/usr/bin/env bash

# workspace-name: Taiga (agile projects)

# Installed by the Taiga plugin (plugins.sh --install taiga); __WORKSPACE__ is the workspace it was installed into.
#
# Build a Taiga site in containers from Taiga's own images, as its reference setup runs them, on the project's own
# PostgreSQL 12: on DDEV at https://<name>.ddev.site. With --install the workspace account is the site's administrator,
# and the public sign-up stays off; with --add-users the default accounts are in their roles of the project Webship
# site; with --sample-content its sprint and user stories, an assignee, a tag, a comment and a task.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

# Distribution.
distribution_name="taiga";
distribution_title="Taiga";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} site in __WORKSPACE__"
# The args file comes with the plugin: core/scripts/plugins/taiga/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/taiga/args/arg-taiga.sh || exit 1 ;

shift $#;

taiga_build ;
