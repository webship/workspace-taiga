#!/usr/bin/env bash

# Taiga for the Webship Workspace: build a site of Taiga (the open-source agile project management platform) from its
# own images, as Taiga's reference setup (taiga-docker) runs them, on the project's own PostgreSQL, add its default
# accounts and their roles in a sample project, add its sample content, and wire its step pack into the testing setup.
#
# Placed by `plugins.sh --install taiga` in core/scripts/plugins/taiga/functions/, where bootstrap sources it after the
# core's own functions. Everything runs in containers, never on the host:
#   - DDEV (the default): Taiga's services (its back end, the back end's Celery worker, its front end, its events, its
#     protected media, the nginx gateway in front of them, and the two RabbitMQ) beside a generic project's web
#     container, at https://<name>.ddev.site. The database is the project's own db service on PostgreSQL 12, the major
#     version Taiga's reference pins: Taiga needs PostgreSQL. The project's web container keeps the mail catcher.
#   - Docker Compose, Podman and Kubernetes (--runtime docker|podman|kubernetes), through the core's runtime layer:
#     Taiga's back-end image is the web container's (rt_stack image). Once the project's PostgreSQL 12 takes
#     connections, the container runs Taiga's migrations, then its API, its Celery worker and the gateway, as the host
#     user (taiga-serve.sh, rt_serve), and stops when one of the three stops. Its front end, its events, its protected
#     media and the two RabbitMQ are services of the project's own (rt_service), under the names they have on DDEV. The
#     media Taiga keeps beside its database are in the project's taiga/files/media. Why the back end is in the web
#     container there: it makes its tables as it starts, so it starts once the database answers, and the gateway serves
#     the media the back end writes, from the same folder.
# Lando and Docksal are not proven yet: asked for one, the builder says so and changes nothing.
# The site's accounts, project, roles and token are made with Taiga's own code in its back end's container
# (taiga-site.py, through Taiga's shell), and its content through Taiga's REST API there, as each part's author. What
# the script reads (accounts, passwords) comes on its input, never on a command line. Taiga's own images only.
#
# The container tool has no project type for Taiga, so a site of this plugin is recognised by a file on DDEV
# (.ddev/config.taiga.yaml, written by the builder), and by the plugin's claim on another runtime (rt_claim).
# Four names are the ones the core's tools look for:
#   set_taiga_users          the default accounts                     (cmd-tools-add-users.sh <project> taiga)
#   add_taiga_users          make them, and their roles               (the same tool, and --add-users of the builder)
#   cancel_taiga_users       keep them from signing in                (cmd-tools-cancel-users.sh <project> taiga)
#   testing_configure_taiga  the step pack in the testing stack       (cmd-tools-testing.sh <project>)

# The step pack a site is tested with, and the release line it is required at.
readonly TAIGA_STEPS_PACKAGE='@webship-js/taiga-steps';
readonly TAIGA_STEPS_VERSION='^2.0.0';

# The images of Taiga's reference setup, pinned, never "latest": Taiga's own (each at its newest 6.10 release), and
# RabbitMQ and nginx at the exact releases the reference's tags (3.8-management-alpine, 1.19-alpine) stand for.
readonly TAIGA_BACK_IMAGE='docker.io/taigaio/taiga-back:6.10.2';
readonly TAIGA_FRONT_IMAGE='docker.io/taigaio/taiga-front:6.10.3';
readonly TAIGA_EVENTS_IMAGE='docker.io/taigaio/taiga-events:6.10.0';
readonly TAIGA_PROTECTED_IMAGE='docker.io/taigaio/taiga-protected:6.10.1';
readonly TAIGA_RABBITMQ_IMAGE='docker.io/library/rabbitmq:3.8.34-management-alpine';
readonly TAIGA_GATEWAY_IMAGE='docker.io/library/nginx:1.19.10-alpine';
# The release the builder runs, as Taiga's back end names it.
readonly TAIGA_RELEASE='6.10.2';

# The port of Taiga's gateway in the web container, on a runtime other than DDEV (rt_serve).
readonly TAIGA_SERVE_PORT=8080;

# The database of the project: Taiga needs PostgreSQL, and its reference pins major version 12.
readonly TAIGA_DATABASE='postgres:12';

# The sample project the default accounts are in, and the folder of a site with the plugin's scripts and the site's
# own values.
readonly TAIGA_PROJECT_NAME='Webship site';
readonly TAIGA_FILES='taiga';

# The free memory a build asks for, in MB: Taiga's services and PostgreSQL.
readonly TAIGA_MEMORY_MB=2048;

# The default accounts, the ones a scenario signs in as, each with a role in the sample project: its administrator
# (owner, as Product Owner), a member (member, as Back), a reader (reader, in a role that only views), and an account
# the project does not have (stranger). Taiga signs in by username (or email) and shows the full name. Accounts are
# configuration, made once on the site; a test suite never creates or deletes one. The workspace account the builder
# makes with --install is the site's administrator and is not in this list.
function set_taiga_users() {
  users=(owner member reader stranger);
  local user ;
  for user in "${users[@]}" ; do
    printf -v "user_${user}_name" '%s' "${user}" ;
    printf -v "user_${user}_mail" '%s' "${user}@example.com" ;
    printf -v "user_${user}_password" '%s' 'dD.123123ddd' ;
    printf -v "user_${user}_fullname" '%s' "${user^} Test" ;
    printf -v "user_${user}_role" '%s' "${user}" ;
  done
  user_stranger_role='' ;
}

# The runtime of the project in this folder, or of a new build (--runtime, else the workspace's setting, else DDEV).
# A core without the runtime layer has DDEV only.
function taiga_runtime() {
  if declare -f runtime_of > /dev/null ; then runtime_of "$@" ; else echo 'ddev' ; fi
}

# The address of the site in this folder (or of a new build named PROJECT_NAME, on DDEV); on another runtime the one
# the runtime gives it.
function taiga_url() {
  if [ "$(taiga_runtime)" != 'ddev' ] && declare -f rt_url > /dev/null ; then rt_url ; return ; fi
  echo "https://${1:-${PROJECT_NAME}}.ddev.site" ;
}

# Is this folder a Taiga site of this plugin? On DDEV the builder leaves .ddev/config.taiga.yaml in it; on another
# runtime the project carries the plugin's claim.
function taiga_is_project() {
  local project_path="$1" ;
  [ -f "${project_path}/.ddev/config.taiga.yaml" ] && return 0 ;
  if declare -f rt_is_platform > /dev/null ; then rt_is_platform "${project_path}" taiga ; return $? ; fi
  return 1 ;
}

# Go to the project a tool was asked about, or say why not.
function taiga_enter_project() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  if [ ! -d "${project_path}" ] ; then
    echo "No project ${PROJECT_NAME} in ${WORKSPACE_ROOT}/${doc_name}." ;
    return 1 ;
  fi
  if ! taiga_is_project "${project_path}" ; then
    echo "${doc_name}/${PROJECT_NAME} is not a Taiga site of this plugin." ;
    return 1 ;
  fi
  taiga_refresh_files "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;
}

# The site's copy of the plugin's scripts (taiga/), brought up to the installed plugin's, so a plugin updated with
# --install reaches the sites built before it: the site script, and on another runtime than DDEV the web container's
# start and its gateway's settings (taken when the project starts again). The site's own values (taiga/*env) are left
# as they are.
function taiga_refresh_files() {
  local project_path="$1" from="${WORKSPACE_SCRIPTS}/plugins/taiga" f to ;
  [ -d "${project_path}/${TAIGA_FILES}" ] || return 0 ;
  for f in taiga-site.py:taiga-site.py taiga-serve.sh:taiga-serve.sh taiga-proxy.conf:nginx.conf ; do
    to="${project_path}/${TAIGA_FILES}/${f#*:}" ; f="${from}/${f%%:*}" ;
    [ "${to##*/}" = 'taiga-site.py' ] || [ -f "${to}" ] || continue ;
    if [ -f "${f}" ] && ! cmp -s "${f}" "${to}" ; then
      cp "${f}" "${to}" || return 1 ;
    fi
  done
}

# The free memory of this machine, in MB (what the kernel says is available).
function taiga_free_memory() {
  awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null ;
}

# A secret made for this site, letters and digits.
function taiga_secret() {
  head -c 400 /dev/urandom | base64 -w0 | tr -dc 'A-Za-z0-9' | head -c "$1" ;
}

# Write the project's files. On DDEV: Taiga's services (.ddev/docker-compose.taiga.yaml), their pinned images in
# .ddev/.env, the claim (.ddev/config.taiga.yaml), the gateway's routes and the plugin's script. On another runtime: the
# plugin's claim, the web container built from Taiga's back-end image and started by taiga-serve.sh, the gateway's
# settings, and Taiga's other services as services of the project's own.
function taiga_write_config() {
  local project_path="$1" runtime="${2:-ddev}" ;
  local from="${WORKSPACE_SCRIPTS}/plugins/taiga" f ;
  for f in docker-compose.taiga.yaml taiga-gateway.conf taiga-site.py taiga-serve.sh taiga-proxy.conf ; do
    if [ ! -f "${from}/${f}" ] ; then
      echo "${f} is not in ${from}: install the plugin (plugins.sh --install taiga)." ;
      return 1 ;
    fi
  done
  mkdir -p "${project_path}/${TAIGA_FILES}" || return 1 ;
  cp "${from}/taiga-site.py" "${project_path}/${TAIGA_FILES}/" || return 1 ;

  if [ "${runtime}" != 'ddev' ] ; then
    cp "${from}/taiga-serve.sh" "${project_path}/${TAIGA_FILES}/" || return 1 ;
    cp "${from}/taiga-proxy.conf" "${project_path}/${TAIGA_FILES}/nginx.conf" || return 1 ;
    # The site's values are there from the start, only their owner's: taiga_write_env fills them once the runtime has
    # given the project its address.
    for f in env rabbitmq.env front.env events.env protected.env ; do
      ( umask 077 && : >> "${project_path}/${TAIGA_FILES}/${f}" ) || return 1 ;
    done
    ( cd "${project_path}" \
      && rt_claim taiga \
      && rt_stack image "${TAIGA_BACK_IMAGE}" \
      && rt_web_build taiga <<'DOCKEREOF'
# Taiga's back-end image is the web container's here (rt_stack image): the stack's start runs Taiga's API, its Celery
# worker and the gateway (nginx) in it as the host user (taiga/taiga-serve.sh, rt_serve), not the image's own start,
# which runs them as its taiga user. The media Taiga keeps beside its database live in the project's taiga/files/media.
ENTRYPOINT []
RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf /var/lib/apt/lists/* \
  && rm -rf /taiga-back/media && ln -s /var/www/html/taiga/files/media /taiga-back/media
DOCKEREOF
    ) || return 1 ;
    # Taiga's other services under the names they have on DDEV, so the site's values are the same: each RabbitMQ keeps
    # its data in a volume of its own, under a node name that stays when its container gets another host name.
    ( cd "${project_path}" \
      && rt_service taiga-front "${TAIGA_FRONT_IMAGE}" --port 80 --env-file "${TAIGA_FILES}/front.env" \
      && rt_service taiga-events "${TAIGA_EVENTS_IMAGE}" --port 8888 --env-file "${TAIGA_FILES}/events.env" \
      && rt_service taiga-protected "${TAIGA_PROTECTED_IMAGE}" --port 8003 --env-file "${TAIGA_FILES}/protected.env" \
      && rt_service taiga-events-rabbitmq "${TAIGA_RABBITMQ_IMAGE}" --port 5672 --env-file "${TAIGA_FILES}/rabbitmq.env" --volume /var/lib/rabbitmq \
      && rt_service taiga-async-rabbitmq "${TAIGA_RABBITMQ_IMAGE}" --port 5672 --env-file "${TAIGA_FILES}/rabbitmq.env" --volume /var/lib/rabbitmq \
      && rt_serve "${TAIGA_SERVE_PORT}" "bash ${TAIGA_FILES}/taiga-serve.sh" ) || return 1 ;
    return 0 ;
  fi

  cp "${from}/taiga-gateway.conf" "${project_path}/${TAIGA_FILES}/gateway.conf" || return 1 ;
  cp "${from}/docker-compose.taiga.yaml" "${project_path}/.ddev/docker-compose.taiga.yaml" || return 1 ;
  printf '%s\n' "TAIGA_BACK_IMAGE=${TAIGA_BACK_IMAGE}" "TAIGA_FRONT_IMAGE=${TAIGA_FRONT_IMAGE}" "TAIGA_EVENTS_IMAGE=${TAIGA_EVENTS_IMAGE}" \
    "TAIGA_PROTECTED_IMAGE=${TAIGA_PROTECTED_IMAGE}" "TAIGA_RABBITMQ_IMAGE=${TAIGA_RABBITMQ_IMAGE}" "TAIGA_GATEWAY_IMAGE=${TAIGA_GATEWAY_IMAGE}" \
    > "${project_path}/.ddev/.env" || return 1 ;
  cat > "${project_path}/.ddev/config.taiga.yaml" <<YAMLEOF
# Taiga in this project: its services (docker-compose.taiga.yaml), their images in .env, the site's own values in
# ../taiga/*.env. Written by the Taiga builder of the workspace; build again rather than editing.
web_environment:
  - TAIGA_RELEASE=${TAIGA_RELEASE}
YAMLEOF
}

# The site's own values (taiga/*env, which only you can read): the address, the project's database, the mail catcher,
# the RabbitMQ account and the secret key the back end, the events and the protected media share. Taiga's telemetry is
# off, and so is its public sign-up. On another runtime than DDEV: the stack's own mail catcher (mail), and at a plain
# http address Taiga's cookies without Secure (a browser keeps none of them otherwise) and its events over ws://; each
# RabbitMQ's node name is its own host, so its data stays its own when its container gets another host name.
function taiga_write_env() {
  local project_path="$1" base_url="$2" runtime="${3:-ddev}" ;
  local scheme="${base_url%%://*}" host="${base_url#*://}" mail='web' ws='wss' cookies='' node='' secret rabbit cookie ;
  host="${host%/}" ;
  if [ "${runtime}" != 'ddev' ] ; then
    mail='mail' ; node=$'\nRABBITMQ_NODENAME=rabbit@localhost' ;
  fi
  if [ "${scheme}" = 'http' ] ; then
    ws='ws' ; cookies=$'\nSESSION_COOKIE_SECURE=False\nCSRF_COOKIE_SECURE=False' ;
  fi
  secret="$(taiga_secret 50)" ; rabbit="$(taiga_secret 24)" ; cookie="$(taiga_secret 32)" ;
  ( umask 077
    cat > "${project_path}/${TAIGA_FILES}/env" <<ENVEOF
# The values of this Taiga site's back end and its Celery worker, made by the Taiga builder of the workspace. Never
# printed.
POSTGRES_DB=db
POSTGRES_USER=db
POSTGRES_PASSWORD=db
POSTGRES_HOST=db
TAIGA_SECRET_KEY=${secret}
TAIGA_SITES_SCHEME=${scheme}
TAIGA_SITES_DOMAIN=${host}
TAIGA_SUBPATH=
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
DEFAULT_FROM_EMAIL=taiga@example.com
EMAIL_USE_TLS=False
EMAIL_USE_SSL=False
EMAIL_HOST=${mail}
EMAIL_PORT=1025
EMAIL_HOST_USER=
EMAIL_HOST_PASSWORD=
RABBITMQ_USER=taiga
RABBITMQ_PASS=${rabbit}
ENABLE_TELEMETRY=False
PUBLIC_REGISTER_ENABLED=False${cookies}
ENVEOF
    cat > "${project_path}/${TAIGA_FILES}/rabbitmq.env" <<ENVEOF
RABBITMQ_ERLANG_COOKIE=${cookie}
RABBITMQ_DEFAULT_USER=taiga
RABBITMQ_DEFAULT_PASS=${rabbit}
RABBITMQ_DEFAULT_VHOST=taiga${node}
ENVEOF
    cat > "${project_path}/${TAIGA_FILES}/front.env" <<ENVEOF
TAIGA_URL=${base_url}
TAIGA_WEBSOCKETS_URL=${ws}://${host}
TAIGA_SUBPATH=
PUBLIC_REGISTER_ENABLED=false
ENVEOF
    cat > "${project_path}/${TAIGA_FILES}/events.env" <<ENVEOF
RABBITMQ_USER=taiga
RABBITMQ_PASS=${rabbit}
TAIGA_SECRET_KEY=${secret}
ENVEOF
    cat > "${project_path}/${TAIGA_FILES}/protected.env" <<ENVEOF
MAX_AGE=360
SECRET_KEY=${secret}
ENVEOF
  ) ;
  secret='' ; rabbit='' ; cookie='' ;
}

# The answer of Taiga's API through its gateway, asked inside the project's network from the web container: 200 once
# the back end has made its tables and started. On another runtime than DDEV the gateway is in the web container.
function taiga_probe() {
  local gateway='http://taiga-gateway' ;
  [ "$(taiga_runtime)" != 'ddev' ] && gateway="http://127.0.0.1:${TAIGA_SERVE_PORT}" ;
  ddev exec "curl -s -o /dev/null -m 15 -w '%{http_code}' ${gateway}/api/v1/" < /dev/null 2>/dev/null | tr -d '\r' | tail -1 ;
}

# Wait until the site answers, in the project's folder: up to ten minutes (the first start makes Taiga's tables).
function taiga_wait() {
  local attempt code="" ;
  for attempt in $(seq 1 200) ; do
    code="$(taiga_probe)" ;
    [ "${code}" = '200' ] && return 0 ;
    sleep 3 ;
  done
  echo "Taiga did not answer (its API: ${code:-none}); the end of its back end's log:" ;
  taiga_service_log taiga-back 40 ;
  return 1 ;
}

# The end of the log of a service of the project in this folder (taiga-back, taiga-front, taiga-events, ...): DDEV's
# for its services; on another runtime the runtime's own, as the runtime layer runs the project, where the back end is
# the web container.
function taiga_service_log() {
  local service="$1" lines="$2" found rt root ;
  if [ "$(taiga_runtime)" = 'ddev' ] ; then ddev logs -s "${service}" --tail "${lines}" < /dev/null 2>/dev/null ; return 0 ; fi
  [ "${service}" = 'taiga-back' ] && service='web' ;
  found="$(rt_find_project "$PWD" 2>/dev/null)" || return 0 ;
  rt="${found%% *}" ; root="${found#* }" ;
  case "${rt}" in
    docker|podman) rt_dc "${rt}" "${root}" logs --tail "${lines}" "${service}" < /dev/null 2>/dev/null ;;
    kubernetes) rt_kubectl -n "$(rt_k8s_ns "${root}")" logs "deploy/${service}" --tail "${lines}" < /dev/null 2>/dev/null ;;
  esac
  return 0 ;
}

# A command line with Taiga's back-end code, in the project in this folder: in the back end's container on DDEV; on
# another runtime in the web container, which is built from the same image, with the site's values and the image's own
# Python.
function taiga_back_exec() {
  if [ "$(taiga_runtime)" = 'ddev' ] ; then
    ddev exec -s taiga-back "cd /taiga-back && ${1}" ;
  else
    ddev exec "set -a ; . /var/www/html/${TAIGA_FILES}/env ; set +a ; export PATH=/opt/venv/bin:\$PATH DJANGO_SETTINGS_MODULE=settings.config ; cd /taiga-back && ${1}" ;
  fi
}

# Run a verb of taiga-site.py (version, install, accounts, content, tidy, list, token, counts) with Taiga's own code
# (taiga_back_exec). Its payload (accounts, passwords, a login) travels on the input, never on a command line.
function taiga_site() {
  local verb="$1" flag="${2:-}" script='/opt/webship/taiga-site.py' ;
  [ "$(taiga_runtime)" != 'ddev' ] && script="/var/www/html/${TAIGA_FILES}/taiga-site.py" ;
  taiga_back_exec "TAIGA_SITE_VERB=${verb} TAIGA_SITE_FLAG=${flag} python manage.py shell -c \"exec(open('${script}').read())\"" ;
}

# The release Taiga's back end says it runs.
function taiga_version() {
  ( cd "${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" 2>/dev/null && taiga_site version < /dev/null 2>/dev/null ) | tr -d '\r' | sed -n 's/^VERSION //p' | tail -n 1 ;
}

# The payload of taiga-site.py, as the base64 of its JSON. For install: the workspace account (its login, address,
# password and name in TAIGA_LOGIN, _MAIL, _PASSWORD, _NAME). For the other verbs: the rows of the default accounts
# ("login|mail|password|name|role|action" lines in TAIGA_ROWS) and a login (TAIGA_LOGIN). All travel to Python in the
# environment, never on a command line.
function taiga_install_payload() {
  TAIGA_LOGIN="$1" TAIGA_MAIL="$2" TAIGA_PASSWORD="$3" TAIGA_NAME="$4" python3 -c '
import base64, json, os
print(base64.b64encode(json.dumps({"login": os.environ["TAIGA_LOGIN"], "mail": os.environ["TAIGA_MAIL"],
      "password": os.environ["TAIGA_PASSWORD"], "name": os.environ["TAIGA_NAME"]}).encode()).decode())' ;
}

function taiga_payload() {
  TAIGA_ROWS="$1" TAIGA_LOGIN="${2:-}" python3 -c '
import base64, json, os
rows = []
for line in os.environ["TAIGA_ROWS"].split("\x1e"):
    if not line:
        continue
    login, mail, password, name, role, action = line.split("\x1f")
    rows.append({"login": login, "mail": mail, "password": password, "name": name, "role": role, "action": action})
print(base64.b64encode(json.dumps({"rows": rows, "login": os.environ["TAIGA_LOGIN"]}).encode()).decode())' ;
}

# The rows of the default accounts (set_taiga_users), with an action.
function taiga_rows() {
  local action="$1" user user_name user_mail user_password user_fullname user_role rows="" ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail"; user_password="user_${user}_password";
    user_fullname="user_${user}_fullname"; user_role="user_${user}_role";
    rows="${rows}${!user_name}"$'\x1f'"${!user_mail}"$'\x1f'"${!user_password}"$'\x1f'"${!user_fullname}"$'\x1f'"${!user_role}"$'\x1f'"${action}"$'\x1e' ;
  done
  printf '%s' "${rows}" ;
}

# Build a Taiga site from nothing: the project, PostgreSQL and Taiga's services; with --install the workspace account
# as the site's administrator; with --add-users the default accounts in their roles of the sample project; with
# --sample-content its sprint and user stories, an assignee, a tag, a comment and a task.
function taiga_build() {
  trim_project_name ;
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" ;
  local runtime ; runtime="$(cd "${WORKSPACE_ROOT}/${doc_name}" && taiga_runtime)" ;

  case "${runtime}" in
    ddev|docker|podman|kubernetes) ;;
    *) echo "Taiga builds on DDEV, Docker Compose, Podman and Kubernetes for now (--runtime ddev, docker, podman or kubernetes), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed." ; exit 1 ;;
  esac
  if [ "${runtime}" != 'ddev' ] && { ! declare -f rt_serve > /dev/null || ! declare -f rt_service > /dev/null ; } ; then
    echo "--runtime ${runtime} needs a Webship Workspace whose runtimes serve an application of its own and its services (rt_serve and rt_service, webship/workspace#841 and #900): update the workspace, or build on DDEV. Nothing was changed." ;
    exit 1 ;
  fi
  # Taiga's events service stops on its own in normal use (a page that closes its websocket right after subscribing), and
  # comes back only where the runtime starts it again: on Docker Compose and Podman that is the core's restart policy of
  # a project's own services (webship/workspace#959); Kubernetes starts it again by itself.
  if { [ "${runtime}" = 'docker' ] || [ "${runtime}" = 'podman' ] ; } && ! declare -f rt_service_restart > /dev/null ; then
    echo "--runtime ${runtime} needs a Webship Workspace that starts a project's own services again when they stop on their own (rt_service_restart, webship/workspace#959, core 1.0.45): Taiga's events service stops on its own when a page closes its websocket early. Update the workspace, or build on DDEV or Kubernetes. Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${ADD_USERS}" == 'yes' ] && [ "${INSTALL}" != 'yes' ] ; then
    echo "--add-users needs --install: the default accounts go into the site --install sets up." ;
    exit 1 ;
  fi
  if [ "${SAMPLE_CONTENT}" == 'yes' ] && [ "${ADD_USERS}" != 'yes' ] ; then
    echo "--sample-content needs --add-users: the sample project's people are the default accounts." ;
    exit 1 ;
  fi
  if [ ${#PROJECT_NAME} -gt 40 ] || ! [[ "${PROJECT_NAME}" =~ ^[a-z0-9][a-z0-9-]*$ ]] ; then
    echo "The project name ${PROJECT_NAME} must be small letters, digits and dashes (its address and its containers take it). Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${INSTALL}" == 'yes' ] && [ ${#account_pass} -lt 6 ] ; then
    echo "The workspace account's password (core/config/settings.yml) has fewer than six characters, which Taiga's own forms ask of a password: --install makes it the site's administrator. Nothing was changed." ;
    exit 1 ;
  fi
  local free ; free="$(taiga_free_memory)" ;
  if [ -n "${free}" ] && [ "${free}" -lt "${TAIGA_MEMORY_MB}" ] ; then
    echo "Taiga needs about ${TAIGA_MEMORY_MB} MB of free memory (its services and PostgreSQL); this machine has ${free} MB available now. Stop a site you do not need, then build again. Nothing was changed." ;
    exit 1 ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name} || exit 1 ;

  # A project of the same name goes first, with its containers and its volumes (its database, Taiga's files, RabbitMQ's).
  drop_database ;
  local volume ;
  for volume in "ddev-${PROJECT_NAME}-taiga-static" "ddev-${PROJECT_NAME}-taiga-media" "ddev-${PROJECT_NAME}-taiga-async-rabbitmq" "ddev-${PROJECT_NAME}-taiga-events-rabbitmq" ; do
    if docker volume inspect "${volume}" > /dev/null 2>&1 ; then
      docker volume rm -f "${volume}" > /dev/null 2>&1 \
        && echo "  removed the leftover ${volume} volume" \
        || echo "  could not remove ${volume}: a container may still hold it" ;
    fi
  done
  rm -rf "${PROJECT_NAME:?}" ;
  mkdir -p "${PROJECT_NAME}" ;
  cd "${project_path}" || exit 1 ;

  if [ "${runtime}" = 'ddev' ] ; then
    ddev config --project-type=generic --project-name=${PROJECT_NAME} --database=${TAIGA_DATABASE} \
      --nodejs-version=$(ddev_nodejs_version) < /dev/null || exit 1 ;
  else
    # The runtime's own project: Docker Compose, Podman or Kubernetes, through the runtime layer, on PostgreSQL 12 too.
    ddev config --project-type=generic --webserver-type=generic --project-name=${PROJECT_NAME} --database=${TAIGA_DATABASE} --auto < /dev/null || exit 1 ;
  fi
  taiga_write_config "${project_path}" "${runtime}" || exit 1 ;
  # The address once the runtime has given the project its port.
  local base_url ; base_url="$(taiga_url)" ;
  taiga_write_env "${project_path}" "${base_url}" "${runtime}" || exit 1 ;
  # Kubernetes takes the services' env files into Secrets of the project's own when the runtime writes the project's
  # files: once more, now that the site's values are there (Docker Compose and Podman read them when the project starts).
  if [ "${runtime}" = 'kubernetes' ] ; then
    ( cd "${project_path}" && ddev config < /dev/null > /dev/null ) || exit 1 ;
  fi

  if [ "${runtime}" = 'ddev' ] ; then
    echo "Starting the project, PostgreSQL 12 and Taiga ${TAIGA_RELEASE}'s services: their images are a download of about 1.3 GB the first time, and the first start makes Taiga's tables." ;
  else
    echo "Starting the project, PostgreSQL 12 and Taiga ${TAIGA_RELEASE}'s services: their images are a download of about 1.3 GB the first time, the project's web image is built from Taiga's back end, and the first start makes Taiga's tables." ;
  fi
  ddev_up start -y < /dev/null || exit 1 ;
  taiga_wait || exit 1 ;

  if [ "${INSTALL}" == 'yes' ] ; then
    echo "Setting Taiga up: the workspace account as the site's administrator." ;
    taiga_install_payload "${account_name}" "${account_mail:-${account_name}@example.com}" "${account_pass}" "${account_name^} Workspace" \
      | taiga_site install || { echo "Taiga could not be set up." ; exit 1 ; } ;
    if [ "${ADD_USERS}" == 'yes' ] ; then
      set_taiga_users ;
      add_taiga_users || exit 1 ;
      if [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
        echo "Adding the sample content: Sprint 1 and the user stories of ${TAIGA_PROJECT_NAME}, an assignee, a tag, a comment and a task." ;
        ( cd "${project_path}" && taiga_payload "$(taiga_rows '')" | taiga_site content ) || exit 1 ;
      fi
      users=() ;
    fi
    echo "${doc_name} ${PROJECT_NAME} has been installed: Taiga $(taiga_version) on PostgreSQL 12.";
    echo "The site: ${base_url}" ;
    echo "The workspace account signs in as ${account_name}, the site's administrator; the public sign-up is off: an administrator makes the accounts." ;
  else
    echo "${doc_name} ${PROJECT_NAME} is ready at ${base_url}: Taiga has no account yet." ;
    echo "Build it again with --install (and --add-users) for the workspace account as its administrator and the default accounts.";
  fi

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}

# Make the default accounts, or give them back their names, passwords and roles: each in its role of the sample
# project, the stranger in none. The list is loaded by the caller (set_taiga_users): the core's add_users, the builder,
# the tool.
function add_taiga_users() {
  taiga_enter_project || return 1 ;
  local user user_name user_mail user_password user_role ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail"; user_password="user_${user}_password"; user_role="user_${user}_role";
    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo "  User password: ${!user_password}";
    echo "      User role: $([ -n "${!user_role}" ] && echo "${!user_role} of ${TAIGA_PROJECT_NAME}" || echo "not in ${TAIGA_PROJECT_NAME}")";
    echo " ================================================================= ";
  done
  taiga_payload "$(taiga_rows '')" | taiga_site accounts ;
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Keep the default accounts from signing in (their work stays), never the workspace account. Their application tokens
# are removed too: Taiga 6.10 still takes the application token of an account that may not sign in.
function cancel_taiga_users() {
  taiga_enter_project || return 1 ;
  local user user_name user_mail ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail";
    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo " ================================================================= ";
  done
  taiga_payload "$(taiga_rows 'lock')" | taiga_site accounts ;
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Point the dashboard's Taiga (core/config/plugin.taiga.settings.yml) at this site, as an account of it: a new
# application token of that account for the Webship Workspace (made with Taiga's own code in its back end's container,
# in the place of its earlier one) goes into the settings file, which only you can read, never on a screen or in a log;
# with it the account's username and the site's address, and the sample project (its slug) as the default one when none
# was set. A person can make the same token on Taiga's own screen: /external-apps?application=<id>&state=<any>.
function taiga_connect() {
  local login="$1" settings="${WORKSPACE_CONFIG}/plugin.taiga.settings.yml" out token url scope ;
  if ! [[ "${login}" =~ ^[A-Za-z0-9._@-]+$ ]] ; then echo "--connect takes the username of an account of the site." ; return 1 ; fi
  if [ ! -f "${settings}" ] ; then echo "No ${settings}: install the plugin first (plugins.sh --install taiga)." ; return 1 ; fi
  out="$(taiga_payload '' "${login}" | taiga_site token 2>/dev/null)" ;
  token="$(printf '%s\n' "${out}" | tr -d '\r' | sed -n 's/^TOKEN //p' | tail -n 1)" ;
  scope="$(printf '%s\n' "${out}" | tr -d '\r' | sed -n 's/^SCOPE //p' | tail -n 1)" ;
  out='' ;
  if ! [[ "${token}" =~ ^[A-Za-z0-9_:-]{20,}$ ]] ; then echo "No token could be made for ${login} (is it an active account of the site?)." ; return 1 ; fi
  [[ "${scope}" =~ ^[a-z0-9][a-z0-9-]{0,99}$ ]] || scope='' ;
  url="$(taiga_url)" ;
  TAIGA_NEW_TOKEN="${token}" python3 - "${settings}" "${url}" "${login}" "${scope}" <<'PYEOF' || return 1
import os, re, sys
path, url, login, scope = sys.argv[1:5]
token = os.environ['TAIGA_NEW_TOKEN']
text = open(path).read()
def put(text, key, value):
    line = '%s: %s' % (key, value)
    if re.search(r'^%s:.*$' % key, text, re.M):
        return re.sub(r'^%s:.*$' % key, lambda m: line, text, count=1, flags=re.M)
    return text.rstrip('\n') + '\n' + line + '\n'
text = put(text, 'url', url)
text = put(text, 'username', login)
text = put(text, 'token', token)
if scope and not re.search(r'^default_scope:[ \t]*[^ \t\n"]', text, re.M) and not re.search(r'^default_scope:[ \t]*"[^"]', text, re.M):
    text = put(text, 'default_scope', '"%s"' % scope)
fd = os.open(path + '.new', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(text)
os.replace(path + '.new', path)
PYEOF
  token='' ;
  echo "The dashboard reads the user stories of ${url} as ${login} now: a new application token of that account is in ${settings} (not shown here, its earlier one replaced)$([ -n "${scope}" ] && echo ", and ${TAIGA_PROJECT_NAME} (${scope}) is the default project when none was set")." ;
}

# What cmd-tools-taiga-cli.sh does: the first of --run, --add-users, --cancel-users, --sample-content, --tidy, --connect
# that was asked for; with none of them, what the site is and its accounts.
function taiga_cli_tool() {
  trim_project_name ;
  taiga_enter_project || exit 1 ;

  [ "$(taiga_probe)" = '200' ] || ddev start -y < /dev/null || exit 1 ;
  taiga_wait > /dev/null || { echo "Taiga of ${PROJECT_NAME} does not answer; start it again (ddev restart in ${doc_name}/${PROJECT_NAME})." ; exit 1 ; } ;

  if [ ! "${RUN}" == '_none_' ] ; then
    # One of Taiga's own management commands (python manage.py <command>), with its back end's code.
    local words ; read -r -a words <<< "${RUN}" ;
    taiga_back_exec "python manage.py $(printf '%q ' "${words[@]}")" < /dev/null ;
    exit $? ;
  fi

  set_taiga_users ;
  if [ "${ADD_USERS}" == 'yes' ] ; then
    add_taiga_users ;
  elif [ "${CANCEL_USERS}" == 'yes' ] ; then
    cancel_taiga_users ;
  elif [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
    taiga_payload "$(taiga_rows '')" | taiga_site content ;
  elif [ "${TIDY}" == 'yes' ] ; then
    # What a test run that was stopped half way left: its user stories ("Webship test …"), tasks, sprints and comments.
    taiga_payload "$(taiga_rows '')" | taiga_site tidy ;
  elif [ "${CONNECT}" != '_none_' ] ; then
    taiga_connect "${CONNECT}" ;
  else
    echo "${doc_name}/${PROJECT_NAME}: Taiga $(taiga_version) on PostgreSQL 12" ;
    echo "  the site:  $(taiga_url)" ;
    echo "" ;
    taiga_site list < /dev/null ;
  fi
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# The step pack in the testing stack of a Taiga site. The core's testing_configure calls this in the project folder
# once webship-js is scaffolded and before the dependencies are installed; for a project that is not one of this
# plugin's it changes nothing.
#
# It adds the pack to package.json, lists its step definitions in cucumber.js after webship-js's own, gives cucumber.js
# the tags that keep the pack's assertions that must fail out of a normal run, the account that prepares and removes
# test content (manager), the project the steps work in when they name none, and the users registry of the default
# accounts (a handle a scenario reads, mapped to an account; never the workspace account), and writes a first feature
# when the project has none of its own. Every part is skipped when it is already there, so a second run adds what the
# first missed and never resets a suite.
function testing_configure_taiga() {
  local project_path="$1";
  taiga_is_project "${project_path}" || return 0 ;
  if [ ! -f "${project_path}/cucumber.js" ] || [ ! -f "${project_path}/package.json" ] ; then
    echo "  Taiga: cucumber.js is not here yet — run the testing setup again once webship-js is scaffolded." ;
    return 1 ;
  fi

  echo "Adding the Taiga step pack (${TAIGA_STEPS_PACKAGE} ${TAIGA_STEPS_VERSION}).";
  set_taiga_users ;
  # Taiga signs in with the username, and shows the person's full name.
  local registry="" user user_name user_password user_fullname ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_password="user_${user}_password"; user_fullname="user_${user}_fullname";
    registry="${registry}${user}|${!user_name}|${!user_password}|${!user_fullname}"$'\n' ;
  done

  local address ;
  address="$(cd "${project_path}" && taiga_url "$(sed -n 's/^name:[[:space:]]*"\{0,1\}\([A-Za-z0-9._-]*\)"\{0,1\}[[:space:]]*$/\1/p' .ddev/config.yaml 2>/dev/null | head -n 1)")" ;

  python3 - "${project_path}" "${TAIGA_STEPS_PACKAGE}" "${TAIGA_STEPS_VERSION}" 'TAIGA' "${registry}" "${address}" "${TAIGA_PROJECT_NAME}" <<'PYEOF' || return 1
import json, re, sys

project, pack, version, prefix, registry, address, sample = sys.argv[1:8]

# package.json: the pack as a dev dependency, at the release line this plugin was proven on.
pkg_file = project + '/package.json'
pkg = json.load(open(pkg_file))
if pack not in pkg.get('dependencies', {}) and pack not in pkg.get('devDependencies', {}):
    pkg.setdefault('devDependencies', {})[pack] = version
    open(pkg_file, 'w').write(json.dumps(pkg, indent=4) + '\n')
    print('  package.json: %s %s' % (pack, version))

cucumber_file = project + '/cucumber.js'
src = open(cucumber_file).read()
before = src

if ('node_modules/%s/' % pack) not in src:
    line = "'node_modules/%s/tests/step-definitions/**/*.js'," % pack
    core = re.search(r"^([ \t]*)'node_modules/webship-js/tests/step-definitions/[^']*',.*$", src, re.M)
    opening = re.search(r"^([ \t]*)require:[ \t]*\[[ \t]*$", src, re.M)
    if core:
        src = src[:core.end()] + '\n' + core.group(1) + line + src[core.end():]
    elif opening:
        src = src[:opening.end()] + '\n' + opening.group(1) + '  ' + line + src[opening.end():]
    else:
        sys.exit("  cucumber.js has no require list this can add to. Add this line to it:\n    " + line)
    print('  cucumber.js: the step definitions of %s' % pack)

if not re.search(r"^[ \t]*tags:", src, re.M):
    default = re.search(r"^([ \t]*)default:[ \t]*\{[ \t]*$", src, re.M)
    if default:
        pad = default.group(1) + '  '
        block = [
            pad + "// The pack's assertions that must fail are no part of a normal run.",
            pad + "tags: process.env.CUCUMBER_TAGS || 'not @wip and not @must-fail',",
        ]
        src = src[:default.end()] + '\n' + '\n'.join(block) + src[default.end():]
        print('  cucumber.js: the tags that keep the assertions that must fail out of a normal run')

world = re.search(r"^([ \t]*)worldParameters:[ \t]*\{[ \t]*$", src, re.M)
if not world:
    sys.exit("  cucumber.js has no worldParameters block to add the users registry to.")
pad = world.group(1) + '  '
additions = []
if not re.search(r"^[ \t]*manager:", src, re.M):
    additions += [
        pad + "// The account that prepares and removes test content through the site's API: the project's administrator.",
        pad + "manager: process.env.MANAGER || 'owner',",
    ]
if not re.search(r"^[ \t]*project:", src, re.M):
    additions += [
        pad + "// The project the steps work in when they name none (its name).",
        pad + "project: process.env.PROJECT || '%s'," % sample,
    ]
if not re.search(r"^[ \t]*users:[ \t]*\{", src, re.M):
    rows = [r.split('|') for r in registry.splitlines() if r.strip()]
    additions += [
        pad + "// The users registry: a handle a scenario reads, mapped to an account of the site (the default accounts:",
        pad + "// cmd-tools-taiga-cli.sh --add-users). Override one with %s_<HANDLE>_USER and %s_<HANDLE>_PASSWORD." % (prefix, prefix),
        pad + "users: {",
    ]
    for handle, login, password, display in rows:
        env = '%s_%s' % (prefix, handle.upper())
        additions.append(pad + "  %s: { username: process.env.%s_USER || '%s', password: process.env.%s_PASSWORD || '%s', name: '%s' }," % (handle, env, login, env, password, display))
    additions.append(pad + "},")
    print('  cucumber.js: the users registry (%s)' % ', '.join(r[0] for r in rows))
if additions:
    src = src[:world.end()] + '\n' + '\n'.join(additions) + src[world.end():]
    print('  cucumber.js: the managing account and the project of the steps')

# The address the suite opens when LAUNCH_URL is not set: the placeholder of the scaffold becomes the site's.
placeholder = "process.env.LAUNCH_URL || 'http://localhost:8080'"
if placeholder in src:
    src = src.replace(placeholder, "process.env.LAUNCH_URL || '%s'" % address)
    print('  cucumber.js: the address of the site (%s)' % address)

if src != before:
    open(cucumber_file, 'w').write(src)
PYEOF

  # A first feature, when the project has none for the site yet.
  local feature="${WORKSPACE_SCRIPTS}/plugins/taiga/site.feature" ;
  if [ -f "${feature}" ] && [ ! -f "${project_path}/tests/features/site.feature" ] ; then
    mkdir -p "${project_path}/tests/features" && cp "${feature}" "${project_path}/tests/features/site.feature" \
      && echo "  tests/features/site.feature: a first feature for the project and its user stories" ;
  fi

  # The scenarios sign in as the default accounts and read the sample project: make sure the site has them, once it
  # answers again (installing the testing stack may restart the project, and Taiga with it). Each part says when it
  # did not work, and each runs in the project (add_taiga_users ends in the folder).
  if ! ( cd "${project_path}" && taiga_wait > /dev/null 2>&1 ) ; then
    echo "  Taiga does not answer: is the site running (ddev start in ${project_path})? The default accounts and the sample content were not checked." ;
  elif ! ( cd "${project_path}" && add_taiga_users > /dev/null 2>&1 ) ; then
    echo "  The default accounts could not be written (bash cmd-tools-taiga-cli.sh <site> --add-users says why)." ;
  elif ! ( cd "${project_path}" && taiga_payload "$(taiga_rows '')" | taiga_site content > /dev/null 2>&1 ) ; then
    echo "  The sample content could not be written (bash cmd-tools-taiga-cli.sh <site> --sample-content says why)." ;
  else
    echo "  the default accounts and the sample content are on the site (${users[*]})" ;
  fi
}
