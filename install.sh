#!/usr/bin/env bash
set -euo pipefail

# Research Reader macOS installer
#
# Default usage (latest release):
#   curl -fsSL https://raw.githubusercontent.com/ayushdeolasee/research-reader/main/scripts/install-macos.sh | bash
#
# Options:
#   --repo owner/name    GitHub repository (default: ayushdeolasee/research-reader)
#   --tag vX.Y.Z         Install a specific release tag
#   --no-launch          Do not launch the app after install
#   --keep-quarantine    Keep macOS quarantine attribute on installed app
#   -h, --help           Show help

DEFAULT_REPO="ayushdeolasee/research-reader"
REPO="$DEFAULT_REPO"
TAG=""
LAUNCH_AFTER_INSTALL=1
STRIP_QUARANTINE=1

log() {
  printf '[install] %s\n' "$*"
}

error() {
  printf '[install] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Research Reader macOS installer

Usage:
  install-macos.sh [options]

Options:
  --repo owner/name    GitHub repository (default: ayushdeolasee/research-reader)
  --tag vX.Y.Z         Install a specific release tag (default: latest release)
  --no-launch          Do not launch app after install
  --keep-quarantine    Keep quarantine attribute on installed app
  -h, --help           Show this help
EOF
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      [[ $# -ge 2 ]] || error "--repo requires a value"
      REPO="$2"
      shift 2
      ;;
    --tag)
      [[ $# -ge 2 ]] || error "--tag requires a value"
      TAG="$2"
      shift 2
      ;;
    --no-launch)
      LAUNCH_AFTER_INSTALL=0
      shift
      ;;
    --keep-quarantine)
      STRIP_QUARANTINE=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || error "This installer only supports macOS."
need_cmd curl
need_cmd python3
need_cmd hdiutil
need_cmd ditto
need_cmd tar
need_cmd open

ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64)
    ARCH="arm64"
    ;;
  x86_64|amd64)
    ARCH="x86_64"
    ;;
  *)
    log "Unknown architecture '$ARCH'. Will try best-match asset."
    ;;
esac

TMP_DIR="$(mktemp -d)"
MOUNT_DIR=""
INSTALLED_APP=""

cleanup() {
  if [[ -n "$MOUNT_DIR" && -d "$MOUNT_DIR" ]]; then
    hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

API_URL="https://api.github.com/repos/${REPO}/releases/latest"
if [[ -n "$TAG" ]]; then
  API_URL="https://api.github.com/repos/${REPO}/releases/tags/${TAG}"
fi

log "Fetching release metadata from ${REPO}..."

CURL_HEADERS=(-H "Accept: application/vnd.github+json")
if [[ -n "${GH_TOKEN:-}" ]]; then
  CURL_HEADERS+=(-H "Authorization: Bearer ${GH_TOKEN}")
fi

RELEASE_JSON="${TMP_DIR}/release.json"
curl -fsSL "${CURL_HEADERS[@]}" "$API_URL" -o "$RELEASE_JSON" || {
  error "Failed to fetch release metadata. Check repository/tag and access permissions."
}

SELECTED_ASSET="$(
  python3 - "$RELEASE_JSON" "$ARCH" <<'PY'
import json
import pathlib
import sys

release_path = pathlib.Path(sys.argv[1])
arch = sys.argv[2].lower()

data = json.loads(release_path.read_text())
assets = data.get("assets", [])

if not assets:
    print("")
    sys.exit(0)

arch_tokens = {
    "arm64": ["arm64", "aarch64"],
    "x86_64": ["x86_64", "x64", "amd64"],
}
other_arch_tokens = {
    "arm64": arch_tokens["x86_64"],
    "x86_64": arch_tokens["arm64"],
}

def extension_score(name: str) -> int:
    if name.endswith(".dmg"):
        return 500
    if name.endswith(".app.tar.gz"):
        return 400
    if name.endswith(".zip"):
        return 300
    return -1

def score(asset):
    name = asset.get("name", "").lower()
    ext = extension_score(name)
    if ext < 0:
        return None

    s = ext

    if any(token in name for token in ("mac", "darwin", "osx")):
        s += 40
    if "universal" in name:
        s += 35

    for token in arch_tokens.get(arch, []):
        if token in name:
            s += 55
            break

    for token in other_arch_tokens.get(arch, []):
        if token in name:
            s -= 80
            break

    return s

best = None
for asset in assets:
    s = score(asset)
    if s is None:
        continue
    if best is None or s > best[0]:
        best = (s, asset)

if not best:
    print("")
    sys.exit(0)

asset = best[1]
name = asset.get("name", "")
url = asset.get("browser_download_url", "")
if not name or not url:
    print("")
    sys.exit(0)

print(f"{name}\t{url}")
PY
)"

if [[ -z "$SELECTED_ASSET" ]]; then
  error "No suitable macOS release asset found (.dmg, .app.tar.gz, or .zip)."
fi

ASSET_NAME="${SELECTED_ASSET%%$'\t'*}"
ASSET_URL="${SELECTED_ASSET#*$'\t'}"

ARCHIVE_PATH="${TMP_DIR}/${ASSET_NAME}"
log "Downloading ${ASSET_NAME}..."
curl -fL "${CURL_HEADERS[@]}" "$ASSET_URL" -o "$ARCHIVE_PATH" || {
  error "Failed to download release asset."
}

install_app_bundle() {
  local app_source="$1"
  local app_name
  local app_dest

  app_name="$(basename "$app_source")"
  app_dest="/Applications/${app_name}"

  log "Installing ${app_name} to /Applications..."

  if [[ -e "$app_dest" ]]; then
    if [[ -w "/Applications" ]]; then
      rm -rf "$app_dest"
    else
      sudo rm -rf "$app_dest"
    fi
  fi

  if [[ -w "/Applications" ]]; then
    ditto "$app_source" "$app_dest"
  else
    sudo ditto "$app_source" "$app_dest"
  fi

  INSTALLED_APP="$app_dest"
}

extract_and_find_app() {
  local source_dir="$1"
  find "$source_dir" -maxdepth 4 -type d -name "*.app" | head -n 1
}

if [[ "$ASSET_NAME" == *.dmg ]]; then
  MOUNT_DIR="${TMP_DIR}/mount"
  mkdir -p "$MOUNT_DIR"
  log "Mounting DMG..."
  hdiutil attach "$ARCHIVE_PATH" -nobrowse -quiet -mountpoint "$MOUNT_DIR"

  APP_PATH="$(extract_and_find_app "$MOUNT_DIR")"
  [[ -n "$APP_PATH" ]] || error "No .app bundle found inside DMG."

  install_app_bundle "$APP_PATH"

  hdiutil detach "$MOUNT_DIR" -quiet
  MOUNT_DIR=""
elif [[ "$ASSET_NAME" == *.app.tar.gz ]]; then
  EXTRACT_DIR="${TMP_DIR}/extract"
  mkdir -p "$EXTRACT_DIR"
  log "Extracting app archive..."
  tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"

  APP_PATH="$(extract_and_find_app "$EXTRACT_DIR")"
  [[ -n "$APP_PATH" ]] || error "No .app bundle found in .app.tar.gz archive."

  install_app_bundle "$APP_PATH"
elif [[ "$ASSET_NAME" == *.zip ]]; then
  EXTRACT_DIR="${TMP_DIR}/extract"
  mkdir -p "$EXTRACT_DIR"
  log "Extracting zip..."
  ditto -xk "$ARCHIVE_PATH" "$EXTRACT_DIR"

  APP_PATH="$(extract_and_find_app "$EXTRACT_DIR")"
  [[ -n "$APP_PATH" ]] || error "No .app bundle found in zip archive."

  install_app_bundle "$APP_PATH"
else
  error "Unsupported asset type: ${ASSET_NAME}"
fi

if [[ -z "$INSTALLED_APP" || ! -d "$INSTALLED_APP" ]]; then
  error "Install completed but app bundle not found."
fi

if [[ "$STRIP_QUARANTINE" -eq 1 ]] && command -v xattr >/dev/null 2>&1; then
  log "Removing quarantine attribute..."
  if [[ -w "$INSTALLED_APP" ]]; then
    xattr -dr com.apple.quarantine "$INSTALLED_APP" >/dev/null 2>&1 || true
  else
    sudo xattr -dr com.apple.quarantine "$INSTALLED_APP" >/dev/null 2>&1 || true
  fi
fi

log "Installed: ${INSTALLED_APP}"

if [[ "$LAUNCH_AFTER_INSTALL" -eq 1 ]]; then
  log "Launching app..."
  open -a "$INSTALLED_APP" || true
fi

log "Done."
