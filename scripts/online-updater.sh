#!/usr/bin/env bash
set -euo pipefail
umask 077

repository=ghcr.io/creator2k/beesupport
bootstrap_version=v0.1.3
version_pattern='^v(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'
runner=/usr/local/libexec/beesupport-online-updater
result_file=.beesupport-update-result
update_error=

lock_project() {
  local path owner permissions
  [[ -f .env && ! -L .env ]] || { echo 'A regular .env file is required.' >&2; exit 1; }
  for path in . .env compose.y{a,}ml docker-compose.y{a,}ml {compose,docker-compose}.override.y{a,}ml; do
    [[ -e $path || -L $path ]] || continue
    read -r owner permissions < <(stat -c '%u %a' -- "$path")
    if [[ -L $path || $owner != 0 ]] || (( (8#$permissions & 022) != 0 )); then
      echo "The updater requires $path to be controlled by root." >&2
      exit 1
    fi
  done
  project_id=$(pwd -P | sha256sum | cut -c1-12)
  exec 9>"/run/lock/beesupport-update-$project_id.lock"
  flock -n 9 || exit 0
}

app_container() {
  docker compose ps --status running -q app
}

control() {
  docker compose exec -T app node --import tsx scripts/online-update-control.ts "$@"
}

newer() {
  [[ "$1" != "$2" && $(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1) == "$1" ]]
}

# Report after the application starts, including after a separate recovery.
report_result() {
  local id result
  IFS=$'\t' read -r id result < "$result_file"
  [[ $id =~ ^[a-f0-9-]{36}$ && $result =~ ^(success|superseded|download|startup|pin|rollback)$ ]]
  control finish "$id" "$result"
  rm -f -- "$result_file"
}

pin_image() {
  local image=$1 temporary
  temporary=$(mktemp ./.env.beesupport.XXXXXX) || return 1
  if awk '!/^([[:blank:]]*export[[:blank:]]+)?[[:blank:]]*APP_IMAGE[[:blank:]]*=/' .env > "$temporary" &&
    printf '\nAPP_IMAGE=%s\n' "$image" >> "$temporary" &&
    mv -f -- "$temporary" .env; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

start_app() {
  APP_IMAGE="$1" docker compose up -d --no-deps --no-build --pull never --wait --wait-timeout 180 app
}

migrations() {
  docker run --rm --network none --entrypoint sh "$1" -ec '
    set -o pipefail
    find prisma/migrations -type f | LC_ALL=C sort | xargs sha256sum | sha256sum
  '
}

replace_app() {
  local version=$1 image="$repository:$1" container previous target builds
  [[ $version =~ $version_pattern ]] || return 1
  container=$(app_container) || return 1
  previous=
  if [[ -n "$container" ]]; then
    previous=$(docker inspect -f '{{.Image}}' "$container") || return 1
  fi
  update_error=download
  timeout 25m env APP_IMAGE="$image" docker compose pull app || return 1
  target=$(docker image inspect -f '{{.Id}}' "$image") || return 1
  builds=$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image") || return 1
  [[ $builds == "$version" ]] || return 1

  if [[ "$previous" == "$target" ]]; then
    update_error=pin
    pin_image "$image"
    return
  fi

  update_error=startup
  if start_app "$image"; then
    if pin_image "$image"; then return 0; fi
    update_error=pin
  fi

  if [[ -n "$previous" ]]; then
    local before after
    if before=$(migrations "$previous") &&
      after=$(migrations "$image") &&
      [[ -n "$before" && "$before" == "$after" ]] &&
      start_app "$previous"; then
      return 1
    fi
  fi
  update_error=rollback
  return 1
}

run_update() {
  local container claim id target current extra result temporary
  lock_project
  container=$(app_container)
  [[ -n "$container" ]] || exit 0
  if [[ -f "$result_file" ]]; then report_result; fi
  claim=$(control claim)
  [[ -n "$claim" ]] || exit 0
  IFS=$'\t' read -r id target current extra <<< "$claim"
  [[ $id =~ ^[a-f0-9-]{36}$ && $target =~ $version_pattern &&
    $current =~ $version_pattern && -z $extra ]] || {
    echo 'Invalid BeeSupport update request.' >&2
    exit 1
  }
  result=success
  update_error=download
  if newer "$current" "$target"; then
    result=superseded
  elif ! replace_app "$target"; then
    result="$update_error"
  fi
  temporary=$(mktemp ./.beesupport-result.XXXXXX)
  printf '%s\t%s\n' "$id" "$result" > "$temporary"
  mv -f -- "$temporary" "$result_file"
  report_result
  if [[ "$result" != success ]]; then
    echo "BeeSupport update to $target failed ($result)." >&2
    exit 1
  fi
}

install_runner() {
  [[ $EUID == 0 ]] || { echo 'Run install as root.' >&2; exit 1; }
  local project unit container current script_path
  script_path=$(realpath -- "$0")
  cd -- "$1"
  project=$(pwd -P)
  [[ $project =~ ^/[A-Za-z0-9._/-]+$ ]] || {
    echo 'The Compose directory path contains unsupported characters.' >&2
    exit 1
  }
  lock_project
  docker compose config --services | grep -qx app
  container=$(app_container)
  current=
  if [[ -n "$container" ]]; then
    current=$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$container")
  fi
  if [[ ! $current =~ $version_pattern ]] || newer "$bootstrap_version" "$current"; then
    if ! replace_app "$bootstrap_version"; then
      echo "BeeSupport bootstrap failed ($update_error)" >&2
      exit 1
    fi
  fi
  control version >/dev/null

  unit="beesupport-update-$project_id"
  install -d -m 0755 /usr/local/libexec
  if [[ "$script_path" != "$runner" ]]; then
    install -m 0755 -- "$script_path" "$runner"
  fi
  cat > "/etc/systemd/system/$unit.service" <<EOF
[Unit]
Description=BeeSupport online updater
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$project
ExecStart=$runner run
TimeoutStartSec=40min
EOF
  cat > "/etc/systemd/system/$unit.timer" <<EOF
[Unit]
Description=Check for BeeSupport update requests

[Timer]
OnBootSec=15s
OnUnitInactiveSec=20s
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$unit.timer"
  systemctl start --no-block "$unit.service"
  echo "BeeSupport updater ready. Logs: journalctl -u $unit.service"
}

unset APP_IMAGE
case "${1:-}" in
  install) install_runner "${2:?Provide the existing Compose directory path}" ;;
  run) run_update ;;
  *) echo "Usage: bash $0 install /path/to/beesupport" >&2; exit 2 ;;
esac
