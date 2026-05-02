#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$ROOT_DIR/client/noobot-chat"
SERVICE_DIR="$ROOT_DIR/service"
PM2_HOME_DIR="$ROOT_DIR/.pm2"
CLIENT_APP_NAME="noobot-client"
SERVICE_APP_NAME="noobot-service"
CADDY_ADDR="${CADDY_ADDR:-:10060}"
API_UPSTREAM="${API_UPSTREAM:-127.0.0.1:10061}"
CLIENT_CADDY_BIN="$CLIENT_DIR/deploy/bin/caddy"
CLIENT_CADDY_CONFIG="$CLIENT_DIR/deploy/Caddyfile"
CLIENT_DIST_DIR="$CLIENT_DIR/dist"
FRONTEND_URL_ADDR="$CADDY_ADDR"
if [[ "$FRONTEND_URL_ADDR" == :* ]]; then
  FRONTEND_URL_ADDR="127.0.0.1$FRONTEND_URL_ADDR"
fi
NOOBOT_LANG="${NOOBOT_LANG:-${LANG:-}}"
if [[ "$NOOBOT_LANG" == zh* || "$NOOBOT_LANG" == *"zh_CN"* || "$NOOBOT_LANG" == *"zh-CN"* ]]; then
  NOOBOT_LANG="zh"
else
  NOOBOT_LANG="en"
fi

msg() {
  local key="$1"
  case "${key}_${NOOBOT_LANG}" in
    missing_cmd_zh) echo "缺少命令: $2" ;;
    missing_cmd_en) echo "Missing command: $2" ;;
    optional_missing_title_zh) echo "检测到以下可选依赖未安装（不会自动安装，请按提示手动安装）:" ;;
    optional_missing_title_en) echo "Detected missing optional dependencies (won't be auto-installed, please install manually):" ;;
    install_hint_title_zh) echo "建议安装命令（按你的系统选择执行）：" ;;
    install_hint_title_en) echo "Suggested install commands (choose one for your system):" ;;
    update_code_zh) echo "更新代码: git pull --rebase (branch: $2, upstream: $3)" ;;
    update_code_en) echo "Updating code: git pull --rebase (branch: $2, upstream: $3)" ;;
    no_upstream_zh) echo "当前分支($2)未设置 upstream，跳过 git pull" ;;
    no_upstream_en) echo "Current branch ($2) has no upstream, skip git pull" ;;
    not_git_zh) echo "非 git 仓库，跳过代码更新" ;;
    not_git_en) echo "Not a git repository, skip code update" ;;
    start_pm2_zh) echo "启动 PM2 服务: $2" ;;
    start_pm2_en) echo "Starting PM2 service: $2" ;;
    client_dir_missing_zh) echo "前端目录不存在: $2" ;;
    client_dir_missing_en) echo "Frontend directory not found: $2" ;;
    service_dir_missing_zh) echo "后端目录不存在: $2" ;;
    service_dir_missing_en) echo "Backend directory not found: $2" ;;
    step_install_zh) echo "2/5 安装依赖" ;;
    step_install_en) echo "2/5 Install dependencies" ;;
    step_build_zh) echo "3/5 构建前端" ;;
    step_build_en) echo "3/5 Build frontend" ;;
    step_rebuild_zh) echo "4/5 重建 PM2 服务" ;;
    step_rebuild_en) echo "4/5 Rebuild PM2 services" ;;
    step_start_zh) echo "5/5 用 PM2 启动服务" ;;
    step_start_en) echo "5/5 Start services with PM2" ;;
    done_list_zh) echo "完成。当前 PM2 进程列表:" ;;
    done_list_en) echo "Done. Current PM2 process list:" ;;
    path_info_zh) echo "路径信息:" ;;
    path_info_en) echo "Path info:" ;;
    frontend_url_zh) echo "前端访问地址: http://$2" ;;
    frontend_url_en) echo "Frontend URL: http://$2" ;;
    api_url_zh) echo "后端 API(供前端反代): http://$2" ;;
    api_url_en) echo "Backend API (for frontend reverse proxy): http://$2" ;;
    *) echo "$key" ;;
  esac
}

log() {
  echo "[$(date '+%F %T')] $*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$(msg missing_cmd "$1")" >&2
    exit 1
  fi
}

detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt"
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    echo "dnf"
    return
  fi
  if command -v yum >/dev/null 2>&1; then
    echo "yum"
    return
  fi
  if command -v pacman >/dev/null 2>&1; then
    echo "pacman"
    return
  fi
  if command -v brew >/dev/null 2>&1; then
    echo "brew"
    return
  fi
  echo "unknown"
}

print_missing_dependency_hints() {
  local missing=("$@")
  [[ "${#missing[@]}" -gt 0 ]] || return

  local pm
  pm="$(detect_pkg_manager)"

  echo ""
  log "$(msg optional_missing_title)"
  for dep in "${missing[@]}"; do
    case "$dep" in
      libreoffice)
        echo "- libreoffice：未安装将影响 Office 文档（doc/docx/xls/ppt 等）转换能力。"
        ;;
      ffmpeg)
        echo "- ffmpeg：未安装将影响音视频处理与相关解析能力。"
        ;;
      docker)
        echo "- docker：未安装本身不影响系统启动；仅当你在配置中启用 script.sandboxMode=true 且 script.sandboxProvider.default=docker 时，执行脚本 的 docker 沙箱模式才不可用。"
        echo "  官方安装文档: https://docs.docker.com/engine/install/"
        ;;
      bubblewrap)
        echo "- bubblewrap(bwrap)：未安装本身不影响系统启动；仅当你在配置中启用 script.sandboxMode=true 且 script.sandboxProvider.default=bubblewrap 时，执行脚本 的 Bubblewrap+overlayfs 沙箱模式才不可用。"
        ;;
      firejail)
        echo "- firejail：未安装本身不影响系统启动；仅当你在配置中启用 script.sandboxMode=true 且 script.sandboxProvider.default=firejail 时，执行脚本 的 Firejail 沙箱模式才不可用。"
        ;;
    esac
  done

  echo ""
  log "$(msg install_hint_title)"
  case "$pm" in
    apt)
      echo "  sudo apt-get update && sudo apt-get install -y libreoffice ffmpeg bubblewrap firejail"
      ;;
    dnf)
      echo "  sudo dnf install -y libreoffice ffmpeg bubblewrap firejail"
      ;;
    yum)
      echo "  sudo yum install -y libreoffice ffmpeg bubblewrap firejail"
      ;;
    pacman)
      echo "  sudo pacman -Sy --noconfirm libreoffice-fresh ffmpeg bubblewrap firejail"
      ;;
    brew)
      echo "  brew install --cask libreoffice"
      echo "  brew install ffmpeg bubblewrap firejail"
      ;;
    *)
      echo "  请使用你的系统包管理器安装：libreoffice ffmpeg bubblewrap firejail"
      ;;
  esac
  echo ""
}

run_pm2() {
  (cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx pm2 "$@")
}

pm2_has_app() {
  run_pm2 describe "$1" >/dev/null 2>&1
}

update_code() {
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local branch upstream
    branch="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
    upstream="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || true)"

    if [[ -n "$upstream" ]]; then
      log "$(msg update_code "$branch" "$upstream")"
      git -C "$ROOT_DIR" pull --rebase
    else
      log "$(msg no_upstream "$branch")"
    fi
  else
    log "$(msg not_git)"
  fi
}

start_pm2() {
  local app_name="$1"
  shift

  log "$(msg start_pm2 "$app_name")"
  run_pm2 start "$@"
}

main() {
  require_cmd npm
  local missing_deps=()
  command -v libreoffice >/dev/null 2>&1 || missing_deps+=("libreoffice")
  command -v ffmpeg >/dev/null 2>&1 || missing_deps+=("ffmpeg")
  command -v docker >/dev/null 2>&1 || missing_deps+=("docker")
  command -v bwrap >/dev/null 2>&1 || missing_deps+=("bubblewrap")
  command -v firejail >/dev/null 2>&1 || missing_deps+=("firejail")

  [[ -d "$CLIENT_DIR" ]] || { echo "$(msg client_dir_missing "$CLIENT_DIR")" >&2; exit 1; }
  [[ -d "$SERVICE_DIR" ]] || { echo "$(msg service_dir_missing "$SERVICE_DIR")" >&2; exit 1; }
  mkdir -p "$PM2_HOME_DIR"

  # log "1/5 更新代码"
  # update_code

  log "$(msg step_install)"
  unset PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD || true
  npm --prefix "$CLIENT_DIR" install
  npm --prefix "$SERVICE_DIR" install
  npm --prefix "$SERVICE_DIR" run postinstall --if-present

  log "$(msg step_build)"
  npm --prefix "$CLIENT_DIR" run build

  log "$(msg step_rebuild)"
  local has_service_app=0
  local has_client_app=0
  if pm2_has_app "$SERVICE_APP_NAME"; then
    has_service_app=1
  fi
  if pm2_has_app "$CLIENT_APP_NAME"; then
    has_client_app=1
  fi

  log "$(msg step_start)"
  export CADDY_ADDR API_UPSTREAM
  if [[ "$has_service_app" -eq 1 ]]; then
    run_pm2 restart "$SERVICE_APP_NAME" --update-env
  else
    start_pm2 "$SERVICE_APP_NAME" npm --name "$SERVICE_APP_NAME" --cwd "$SERVICE_DIR" -- start
  fi
  if [[ "$has_client_app" -eq 1 ]]; then
    run_pm2 restart "$CLIENT_APP_NAME" --update-env
  else
    start_pm2 "$CLIENT_APP_NAME" npm --name "$CLIENT_APP_NAME" --cwd "$CLIENT_DIR" -- run serve:caddy
  fi

  log "$(msg done_list)"
  run_pm2 ls

  log "$(msg path_info)"
  log "ROOT_DIR=$ROOT_DIR"
  log "CLIENT_DIR=$CLIENT_DIR"
  log "SERVICE_DIR=$SERVICE_DIR"
  log "PM2_HOME_DIR=$PM2_HOME_DIR"
  log "CLIENT_DIST_DIR=$CLIENT_DIST_DIR"
  log "CLIENT_CADDY_CONFIG=$CLIENT_CADDY_CONFIG"
  log "CLIENT_CADDY_BIN=$CLIENT_CADDY_BIN"
  log "$(msg frontend_url "${FRONTEND_URL_ADDR}")"
  log "$(msg api_url "${API_UPSTREAM}")"

  print_missing_dependency_hints "${missing_deps[@]}"
}

main "$@"
