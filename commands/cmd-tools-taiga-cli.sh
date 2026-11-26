#!/usr/bin/env bash

# Installed by the Taiga plugin (plugins.sh --install taiga); __WORKSPACE__ is the workspace it was installed into.
#
# A Taiga site of this folder: what it is and its accounts; --run one of Taiga's own management commands in its back
# end's container; --add-users and --cancel-users the default accounts; --sample-content the sample content; --tidy what
# a stopped test run left; --connect the dashboard's Taiga to this site.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

ARGPARSE_DESCRIPTION="A Taiga site of __WORKSPACE__: what it is, its accounts, Taiga's own commands"
# The args file comes with the plugin: core/scripts/plugins/taiga/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/taiga/args/arg-taiga-cli.sh || exit 1 ;

shift $#;

taiga_cli_tool ;
