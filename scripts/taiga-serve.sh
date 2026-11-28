#!/usr/bin/env bash
# Taiga on Docker Compose, Podman and Kubernetes (rt_serve, webship/workspace#841): the web container, built from
# Taiga's back-end image, runs this as the host user, from the project's folder, once the project's PostgreSQL takes
# connections. It does what the image's own start does (Taiga's migrations, its project templates, then its API),
# without changing owners or users, and also runs the back end's Celery worker and the gateway (nginx), which DDEV runs
# as services of their own. The media Taiga keeps beside its database are in the project's taiga/files/media.
# On DDEV Taiga's services start as their images say, and this is not used.
here="$(cd "$(dirname "$0")" && pwd)"
set -a
# shellcheck disable=SC1091
. "${here}/env" || exit 1
set +a
# The image's own Python (its virtual environment) and Taiga's settings, whatever the user's environment says.
export PATH="/opt/venv/bin:${PATH}" DJANGO_SETTINGS_MODULE='settings.config'
mkdir -p "${here}/files/media" /tmp/taiga-nginx || exit 1
# The addresses of Taiga's services are looked up again while nginx runs, by the container's own DNS server: on Docker
# Compose and Podman a container started again on its own can come back on another address, which a name looked up
# once when nginx starts would miss. Kubernetes's DNS answers a Service by its whole name, under the pod's first search
# domain (<namespace>.svc.<cluster domain>); Docker's and Podman's answer the service's own name.
nameserver="$(awk '/^nameserver/ { print $2 ; exit }' /etc/resolv.conf)"
case "${nameserver}" in *:*) nameserver="[${nameserver}]" ;; esac
domain="$(awk '/^search/ { print $2 ; exit }' /etc/resolv.conf)"
suffix=''
case "${domain}" in *.svc.*) suffix=".${domain}" ;; esac
printf 'resolver %s valid=5s ipv6=off;\nset $taiga_front http://taiga-front%s:80;\nset $taiga_events http://taiga-events%s:8888;\nset $taiga_protected http://taiga-protected%s:8003;\n' \
  "${nameserver:?no DNS server in /etc/resolv.conf}" "${suffix}" "${suffix}" "${suffix}" > /tmp/taiga-nginx/services.conf || exit 1
# nginx opens /dev/stderr by its name, which the host user cannot open again when the container's own output belongs to
# root (the stack starts this through runuser): it becomes a pipe of this user's, which copies to the container's output.
exec > >(cat) 2>&1
cd /taiga-back || exit 1
echo "Taiga: its migrations, then its project templates."
python manage.py migrate --noinput || exit 1
python manage.py loaddata initial_project_templates || exit 1
# Taiga's API behind the gateway (only the gateway and Taiga's own commands in this container reach it), as the image
# starts it.
gunicorn taiga.wsgi:application --name taiga_api --bind 127.0.0.1:8000 --workers 3 --worker-tmp-dir /dev/shm \
  --log-level=info --access-logfile - &
api=$!
# The Celery worker with its scheduler, as the image's async start runs it: its schedule is kept in /tmp.
celery -A taiga.celery worker -B --concurrency 4 -l INFO --schedule /tmp/taiga-celerybeat-schedule &
worker=$!
# The gateway on the project's port, with the project's own settings (taiga/nginx.conf).
nginx -e stderr -c "${here}/nginx.conf" -p /tmp/taiga-nginx -g 'daemon off;' &
gateway=$!
# The container is asked to stop: the three stop with it.
trap 'kill -TERM "${api}" "${worker}" "${gateway}" 2> /dev/null ; wait "${api}" "${worker}" "${gateway}" ; exit 143' TERM INT
# One of the three stops on its own: the others stop too, and so does the container, with a code that is not 0. A
# container that keeps half of Taiga running is not left: Kubernetes starts the pod again, and on Docker Compose and
# Podman the project shows stopped until it is started again.
wait -n "${api}" "${worker}" "${gateway}"
status=$?
echo "Taiga's API, its Celery worker or its gateway stopped (code ${status}): the others stop, and the container with them."
kill -TERM "${api}" "${worker}" "${gateway}" 2> /dev/null
wait "${api}" "${worker}" "${gateway}"
[ "${status}" -eq 0 ] && status=1
exit "${status}"
