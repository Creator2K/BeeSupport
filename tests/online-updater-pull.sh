#!/usr/bin/env bash
# Simulate slow or unavailable registries without waiting for real timeouts.
set -euo pipefail
source "$(dirname "$0")/../scripts/online-updater.sh"
image_source=nju
version=v0.1.4
digest=$(official_digest "$version")
official="$repository@$digest"
mirror="ghcr.nju.edu.cn/creator2k/beesupport@$digest"
target="$repository:$version"

docker() {
  case "$1 $2" in
    "image inspect") [[ "$3" == "$cached" ]] ;;
    "tag "*) tagged="$2 $3" ;;
    *) echo "Unexpected docker command: $*" >&2; return 1 ;;
  esac
}
timeout() {
  [[ "$1 $2 $4 $5 $6 $7" == "-k 10s docker pull --platform linux/amd64" ]] || return 1
  attempted+=("$3 $8")
  if [[ "$8" == "$mirror" ]]; then return "$mirror_status"; fi
  [[ "$8" == "$official" ]] || return 1
  return "$official_status"
}

for cached in "$mirror" "$official" "$v014_image_id"; do
  attempted=() tagged=""
  pull_image "$version"
  [[ ${#attempted[@]} == 0 && "$tagged" == "$cached $target" ]]
done

cached="" mirror_status=0 official_status=1 attempted=() tagged=""
pull_image "$version"
[[ ${#attempted[@]} == 1 && "${attempted[0]}" == "10m $mirror" && "$tagged" == "$mirror $target" ]]

mirror_status=124 official_status=0 attempted=() tagged=""
pull_image "$version"
[[ "${attempted[*]}" == "10m $mirror 18m $official" && "$tagged" == "$official $target" ]]

official_status=1 attempted=() tagged=""
if pull_image "$version"; then exit 1; fi
[[ "${attempted[*]}" == "10m $mirror 18m $official" && -z "$tagged" ]]
