#!/usr/bin/env bash
set -euo pipefail
umask 077

repository=ghcr.io/creator2k/beesupport
bootstrap_version=v0.1.3
# The official bootstrap image can be verified without contacting GHCR.
bootstrap_digest=sha256:6657a70c71279a83a81806fbf709ee9a344e002dd549c1a7b0f6898ca8e90aee
# Docker archives preserve the image ID (official manifest's config digest).
v014_image_id=sha256:533b7a114c68b65bd156d2128741bf925ef6bfd13f5d0d4412aaba43a6fde64d
image_source=${BEESUPPORT_IMAGE_SOURCE:-github}
version_pattern='^v(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'
runner=/usr/local/libexec/beesupport-online-updater
result_file=.beesupport-update-result
update_error=

lock_project() {
  local mode=$1 path owner permissions lock_file wait_seconds=0 status
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
  lock_file="/run/lock/beesupport-update-$project_id.lock"
  exec 9>"$lock_file"
  if [[ "$mode" == install ]]; then wait_seconds=5; fi
  flock -E 75 -w "$wait_seconds" 9 || {
    status=$?
    if [[ "$status" == 75 ]]; then
      if [[ "$mode" == run ]]; then exit 0; fi
      echo 'BeeSupport installation could not get the lock. Another updater or image pull may still be running.' >&2
      printf 'Check the lock holder: lslocks --notruncate -o PID,COMMAND,PATH | grep -F -- %s\n' "$lock_file" >&2
    else
      echo "Could not lock the BeeSupport deployment: $lock_file" >&2
    fi
    exit "$status"
  }
}

require_app_service() {
  local services
  if ! services=$(docker compose config --services); then
    echo 'Could not read the Compose configuration.' >&2
    return 1
  fi
  if ! grep -qx app <<< "$services"; then
    echo 'Compose has no app service in this directory.' >&2
    return 1
  fi
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

official_digest() {
  if [[ "$1" == "$bootstrap_version" ]]; then
    printf '%s\n' "$bootstrap_digest"
    return
  fi
  # Single-platform manifest published by the official v0.1.4 image workflow.
  if [[ "$1" == v0.1.4 ]]; then
    printf '%s\n' 'sha256:c0515b7b824833551e3570c587c118f57f147f773647df73dfa8e4027aaf71cc'
    return
  fi
  timeout 30s docker manifest inspect --verbose "$repository:$1" |
    awk '
      /"Descriptor"[[:space:]]*:/ { descriptor = 1; digest = ""; linux = amd64 = 0 }
      descriptor && /"digest"[[:space:]]*:/ && !digest {
        if (match($0, /sha256:[0-9a-f]+/)) digest = substr($0, RSTART, RLENGTH)
      }
      descriptor && /"os"[[:space:]]*:[[:space:]]*"linux"/ { linux = 1 }
      descriptor && /"architecture"[[:space:]]*:[[:space:]]*"amd64"/ { amd64 = 1 }
      descriptor && linux && amd64 && length(digest) == 71 && !selected {
        selected = digest
      }
      END { if (selected) print selected; else exit 1 }
    '
}

pull_image() {
  local version=$1 image="$repository:$1" digest mirror_image official_image source status
  if [[ "$version" == v0.1.4 ]] && docker image inspect "$v014_image_id" >/dev/null 2>&1; then
    echo "Using verified local BeeSupport $version image ($v014_image_id)."
    docker tag "$v014_image_id" "$image"
    return
  fi
  if [[ "$image_source" == github ]]; then
    timeout 25m env APP_IMAGE="$image" docker compose pull app
    return
  fi
  if ! digest=$(official_digest "$version") || [[ ! $digest =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "Could not verify the official BeeSupport $version digest." >&2
    return 1
  fi
  mirror_image="ghcr.nju.edu.cn/creator2k/beesupport@$digest"
  official_image="$repository@$digest"
  for source in "$mirror_image" "$official_image"; do
    if docker image inspect "$source" >/dev/null 2>&1; then
      echo "Using already downloaded BeeSupport $version ($source)."
      docker tag "$source" "$image"
      return
    fi
  done

  # Reserve time for GHCR and app startup inside the 40-minute systemd deadline.
  echo "Pulling BeeSupport $version via the Nanjing University mirror (10 minute limit)."
  if timeout -k 10s 10m docker pull --platform linux/amd64 "$mirror_image"; then
    docker tag "$mirror_image" "$image"
    return
  else
    status=$?
  fi
  echo "Mirror pull exited with status $status. Trying official GHCR with the same digest (18 minute limit)." >&2
  if timeout -k 10s 18m docker pull --platform linux/amd64 "$official_image"; then
    docker tag "$official_image" "$image"
    return
  else
    status=$?
  fi
  echo "Official GHCR pull exited with status $status. Could not download $version." >&2
  return 1
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
  pull_image "$version" || return 1
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
  lock_project run
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
  printf 'Installing the BeeSupport updater for %s using image source %s.\n' "$project" "$image_source"
  lock_project install
  require_app_service
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
  if ! current=$(control version); then
    echo 'Could not read the version from the running app container.' >&2
    exit 1
  fi
  printf 'Running BeeSupport version: %s\n' "$current"

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
Environment=BEESUPPORT_IMAGE_SOURCE=$image_source
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

if [[ ${BASH_SOURCE[0]} != "$0" ]]; then return; fi
unset APP_IMAGE
if [[ "${1:-}" == install && -n "${3:-}" ]]; then image_source=$3; fi
case "$image_source" in
  github|nju) ;;
  *) echo 'Image source must be github or nju.' >&2; exit 2 ;;
esac
case "${1:-}" in
  install) install_runner "${2:?Provide the existing Compose directory path}" ;;
  run) run_update ;;
  *) echo "Usage: bash $0 install /path/to/beesupport [github|nju]" >&2; exit 2 ;;
esac
