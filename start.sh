#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$ROOT_DIR/client/noobot-chat"
SERVICE_DIR="$ROOT_DIR/service"
AGENT_PROXY_DIR="$ROOT_DIR/agent-proxy"
MODEL_PROXY_DIR="$ROOT_DIR/model-proxy"
PM2_HOME_DIR="$ROOT_DIR/.pm2"
PM2_CLEAN_START="${PM2_CLEAN_START:-0}"
CLIENT_APP_NAME="noobot-client"
SERVICE_APP_NAME="noobot-service"
AGENT_PROXY_APP_NAME="noobot-agent-proxy"
MODEL_PROXY_APP_NAME="noobot-model-proxy"
CADDY_ADDR="${CADDY_ADDR:-:10060}"
AGENT_PROXY_UPSTREAM="${AGENT_PROXY_UPSTREAM:-127.0.0.1:10062}"
API_UPSTREAM="${API_UPSTREAM:-127.0.0.1:10061}"
AGENT_PROXY_PORT="${AGENT_PROXY_PORT:-10062}"
AGENT_PROXY_HOST="${AGENT_PROXY_HOST:-127.0.0.1}"
AGENT_PROXY_UPSTREAM_WS_URL="${AGENT_PROXY_UPSTREAM_WS_URL:-ws://127.0.0.1:10061/chat/ws}"
AGENT_PROXY_UPSTREAM_HTTP_BASE="${AGENT_PROXY_UPSTREAM_HTTP_BASE:-http://127.0.0.1:10061}"
CLIENT_CADDY_BIN="$CLIENT_DIR/deploy/bin/caddy"
CLIENT_CADDY_CONFIG="$CLIENT_DIR/deploy/Caddyfile"
CLIENT_DIST_DIR="$CLIENT_DIR/dist"
PROJECT_LAUNCHER_SCRIPT="$ROOT_DIR/scripts/project-launcher.mjs"
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
    agent_proxy_dir_missing_zh) echo "代理目录不存在: $2" ;;
    agent_proxy_dir_missing_en) echo "Agent proxy directory not found: $2" ;;
    model_proxy_dir_missing_zh) echo "模型代理目录不存在: $2" ;;
    model_proxy_dir_missing_en) echo "Model proxy directory not found: $2" ;;
    step_launcher_zh) echo "1/5 执行项目启动引导" ;;
    step_launcher_en) echo "1/5 Run project launcher" ;;
    step_install_zh) echo "2/5 安装依赖" ;;
    step_install_en) echo "2/5 Install dependencies" ;;
    step_build_zh) echo "3/5 构建前端" ;;
    step_build_en) echo "3/5 Build frontend" ;;
    step_rebuild_zh) echo "4/5 重建 PM2 服务" ;;
    step_rebuild_en) echo "4/5 Rebuild PM2 services" ;;
    step_start_zh) echo "5/5 用 PM2 启动服务" ;;
    step_start_en) echo "5/5 Start services with PM2" ;;
    step_clean_pm2_zh) echo "清理 PM2 缓存与旧进程" ;;
    step_clean_pm2_en) echo "Clean PM2 cache and stale processes" ;;
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

is_pm2_runtime_error_text() {
  grep -qiE "Cannot find module .*pm2|ProcessContainerFork\\.js|pm2: not found|could not determine executable to run"
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
  local err_file out_file
  err_file="$(mktemp)"
  out_file="$(mktemp)"

  # With `set -e` enabled, a failing PM2 command would normally abort the
  # whole script before we can inspect stderr and repair a broken local PM2
  # runtime. Capture the exit code explicitly so the recovery path below can
  # run on deployment machines with stale PM2 daemon/module paths.
  set +e
  (cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx --no-install pm2 "$@" >"$out_file" 2>"$err_file")
  local exit_code=$?
  set -e
  if [[ "$exit_code" -eq 0 ]]; then
    cat "$out_file"
    rm -f "$out_file"
    rm -f "$err_file"
    return 0
  fi

  local err_text=""
  local out_text=""
  err_text="$(cat "$err_file" 2>/dev/null || true)"
  out_text="$(cat "$out_file" 2>/dev/null || true)"
  rm -f "$out_file"
  rm -f "$err_file"

  local combined_text=""
  combined_text="${out_text}"$'\n'"${err_text}"

  if echo "$combined_text" | is_pm2_runtime_error_text; then
    repair_pm2_runtime "pm2 command failed with missing/broken runtime"
    set +e
    (cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx --no-install pm2 "$@")
    exit_code=$?
    set -e
    return "$exit_code"
  fi

  echo "$combined_text" >&2
  return "$exit_code"
}

resolve_pm2_package_dir() {
  (cd "$SERVICE_DIR" && node -e '
const path = require("path");
try {
  console.log(path.dirname(require.resolve("pm2/package.json")));
} catch {
  process.exit(1);
}
' 2>/dev/null)
}

ensure_service_pm2_compat_link() {
  local pm2_pkg_dir service_pm2_dir service_bin_dir service_pm2_bin
  pm2_pkg_dir="$(resolve_pm2_package_dir || true)"
  [[ -n "$pm2_pkg_dir" && -d "$pm2_pkg_dir" ]] || return 0

  service_pm2_dir="$SERVICE_DIR/node_modules/pm2"
  service_bin_dir="$SERVICE_DIR/node_modules/.bin"
  service_pm2_bin="$service_bin_dir/pm2"

  # Older PM2 daemons may have cached .../service/node_modules/pm2 as their
  # own runtime location. In npm workspaces pm2 is usually hoisted to the repo
  # root, so provide a compatibility symlink as well.
  if [[ -L "$service_pm2_dir" && ! -e "$service_pm2_dir" ]]; then
    rm -f "$service_pm2_dir"
  fi
  if [[ "$pm2_pkg_dir" != "$service_pm2_dir" && ! -e "$service_pm2_dir" ]]; then
    mkdir -p "$SERVICE_DIR/node_modules"
    ln -s "$pm2_pkg_dir" "$service_pm2_dir"
  fi
  if [[ -L "$service_pm2_bin" && ! -e "$service_pm2_bin" ]]; then
    rm -f "$service_pm2_bin"
  fi
  if [[ -x "$pm2_pkg_dir/bin/pm2" && ! -e "$service_pm2_bin" ]]; then
    mkdir -p "$service_bin_dir"
    ln -s "$pm2_pkg_dir/bin/pm2" "$service_pm2_bin"
  fi
}

install_or_repair_pm2_package() {
  local pm2_pkg_dir pm2_fork_file
  pm2_pkg_dir="$(resolve_pm2_package_dir || true)"
  pm2_fork_file="${pm2_pkg_dir}/lib/ProcessContainerFork.js"

  if [[ -z "$pm2_pkg_dir" || ! -f "$pm2_fork_file" ]]; then
    log "pm2 runtime package missing/broken, reinstall pm2@latest"
    rm -rf "$SERVICE_DIR/node_modules/pm2" "$SERVICE_DIR/node_modules/.bin/pm2"
    (cd "$SERVICE_DIR" && npm install pm2@latest --no-save)
  fi

  ensure_service_pm2_compat_link
}

kill_pm2_daemon_best_effort() {
  set +e
  (cd "$SERVICE_DIR" && PM2_HOME="$PM2_HOME_DIR" npx --no-install pm2 kill >/dev/null 2>&1)
  set -e
}

repair_pm2_runtime() {
  local reason="${1:-pm2 runtime repair requested}"
  log "$reason; clean PM2 cache, reinstall/repair pm2, and retry once"
  kill_pm2_daemon_best_effort
  rm -rf "$PM2_HOME_DIR"
  mkdir -p "$PM2_HOME_DIR"
  install_or_repair_pm2_package
  kill_pm2_daemon_best_effort
}

ensure_pm2_runtime_preflight() {
  install_or_repair_pm2_package
  # Always restart PM2 daemon before rebuild/start to avoid stale runtime path cache.
  kill_pm2_daemon_best_effort
}

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

clean_pm2_cache() {
  log "$(msg step_clean_pm2)"
  run_pm2 delete all >/dev/null 2>&1 || true
  run_pm2 kill >/dev/null 2>&1 || true
  rm -rf "$PM2_HOME_DIR"
  mkdir -p "$PM2_HOME_DIR"
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

start_or_restart_pm2_apps() {
  local has_service_app=0
  local has_client_app=0
  local has_agent_proxy_app=0
  local has_model_proxy_app=0
  if pm2_has_app "$SERVICE_APP_NAME"; then
    has_service_app=1
  fi
  if pm2_has_app "$CLIENT_APP_NAME"; then
    has_client_app=1
  fi
  if pm2_has_app "$AGENT_PROXY_APP_NAME"; then
    has_agent_proxy_app=1
  fi
  if pm2_has_app "$MODEL_PROXY_APP_NAME"; then
    has_model_proxy_app=1
  fi

  export CADDY_ADDR AGENT_PROXY_UPSTREAM
  export AGENT_PROXY_PORT AGENT_PROXY_HOST AGENT_PROXY_UPSTREAM_WS_URL AGENT_PROXY_UPSTREAM_HTTP_BASE
  if [[ "$has_service_app" -eq 1 ]]; then
    run_pm2 restart "$SERVICE_APP_NAME" --update-env
  else
    start_pm2 "$SERVICE_APP_NAME" npm --name "$SERVICE_APP_NAME" --cwd "$SERVICE_DIR" -- start
  fi
  if [[ "$has_agent_proxy_app" -eq 1 ]]; then
    run_pm2 restart "$AGENT_PROXY_APP_NAME" --update-env
  else
    start_pm2 "$AGENT_PROXY_APP_NAME" npm --name "$AGENT_PROXY_APP_NAME" --cwd "$AGENT_PROXY_DIR" -- start
  fi
  if [[ "$has_model_proxy_app" -eq 1 ]]; then
    run_pm2 restart "$MODEL_PROXY_APP_NAME" --update-env
  else
    start_pm2 "$MODEL_PROXY_APP_NAME" npm --name "$MODEL_PROXY_APP_NAME" --cwd "$MODEL_PROXY_DIR" -- start
  fi
  if [[ "$has_client_app" -eq 1 ]]; then
    run_pm2 restart "$CLIENT_APP_NAME" --update-env
  else
    start_pm2 "$CLIENT_APP_NAME" npm --name "$CLIENT_APP_NAME" --cwd "$CLIENT_DIR" -- run serve:caddy
  fi
}

pm2_recent_logs_have_runtime_error() {
  local logs_text
  logs_text="$(run_pm2 logs --lines 120 --nostream 2>&1 || true)"
  echo "$logs_text" | is_pm2_runtime_error_text
}

wait_for_apps_and_ports_ready() {
  local max_wait_seconds="${START_WAIT_TIMEOUT_SECONDS:-25}"
  local interval_seconds=1
  local elapsed=0
  local apps_json=""
  local check_cmd=(
    node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const required = ["noobot-service", "noobot-agent-proxy", "noobot-model-proxy", "noobot-client"];
const bad = required.filter((name) => !data.find((item) => item.name === name && item.pm2_env && item.pm2_env.status === "online"));
if (bad.length) {
  console.error("PM2 apps not online:", bad.join(", "));
  process.exit(1);
}
'
  )

  while [[ "$elapsed" -lt "$max_wait_seconds" ]]; do
    if apps_json="$(run_pm2 jlist 2>/dev/null)"; then
      if echo "$apps_json" | "${check_cmd[@]}" >/dev/null 2>&1; then
        if command -v ss >/dev/null 2>&1; then
          if ss -lnt | egrep ':10060|:10061|:10062' >/dev/null 2>&1; then
            log "Health check passed: apps online and ports 10060/10061/10062 listening."
            return 0
          fi
        else
          log "Health check passed: apps online (skip port check, 'ss' not found)."
          return 0
        fi
      fi
    fi
    sleep "$interval_seconds"
    elapsed=$((elapsed + interval_seconds))
  done

  echo "Startup health check failed after ${max_wait_seconds}s." >&2
  run_pm2 ls || true
  if command -v ss >/dev/null 2>&1; then
    ss -lntp | egrep ':10060|:10061|:10062' || true
  fi
  run_pm2 logs --lines 80 --nostream || true
  return 1
}

main() {
  require_cmd node
  require_cmd npm
  local missing_deps=()
  command -v libreoffice >/dev/null 2>&1 || missing_deps+=("libreoffice")
  command -v ffmpeg >/dev/null 2>&1 || missing_deps+=("ffmpeg")
  command -v docker >/dev/null 2>&1 || missing_deps+=("docker")
  command -v bwrap >/dev/null 2>&1 || missing_deps+=("bubblewrap")
  command -v firejail >/dev/null 2>&1 || missing_deps+=("firejail")

  [[ -d "$CLIENT_DIR" ]] || { echo "$(msg client_dir_missing "$CLIENT_DIR")" >&2; exit 1; }
  [[ -d "$SERVICE_DIR" ]] || { echo "$(msg service_dir_missing "$SERVICE_DIR")" >&2; exit 1; }
  [[ -d "$AGENT_PROXY_DIR" ]] || { echo "$(msg agent_proxy_dir_missing "$AGENT_PROXY_DIR")" >&2; exit 1; }
  [[ -d "$MODEL_PROXY_DIR" ]] || { echo "$(msg model_proxy_dir_missing "$MODEL_PROXY_DIR")" >&2; exit 1; }
  [[ -f "$PROJECT_LAUNCHER_SCRIPT" ]] || { echo "Project launcher script not found: $PROJECT_LAUNCHER_SCRIPT" >&2; exit 1; }
  mkdir -p "$PM2_HOME_DIR"

  # log "1/5 更新代码"
  # update_code

  log "$(msg step_launcher)"
  (cd "$ROOT_DIR" && node "./scripts/project-launcher.mjs")

  log "$(msg step_install)"
  unset PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD || true
  if node -e "const p=require(process.argv[1]); process.exit(Array.isArray(p.workspaces)&&p.workspaces.length>0?0:1)" "$ROOT_DIR/package.json" >/dev/null 2>&1; then
    npm --prefix "$ROOT_DIR" install --workspaces
  else
    npm --prefix "$CLIENT_DIR" install
    npm --prefix "$SERVICE_DIR" install
    npm --prefix "$AGENT_PROXY_DIR" install
    npm --prefix "$MODEL_PROXY_DIR" install
    npm --prefix "$SERVICE_DIR" run postinstall --if-present
  fi

  log "$(msg step_build)"
  npm --prefix "$CLIENT_DIR" run build

  log "$(msg step_rebuild)"
  ensure_pm2_runtime_preflight
  if is_truthy "$PM2_CLEAN_START"; then
    clean_pm2_cache
  fi

  log "$(msg step_start)"
  start_or_restart_pm2_apps

  if ! wait_for_apps_and_ports_ready; then
    if pm2_recent_logs_have_runtime_error; then
      repair_pm2_runtime "detected PM2 runtime module error in startup logs"
      log "$(msg step_start) (retry)"
      start_or_restart_pm2_apps
      wait_for_apps_and_ports_ready
    else
      return 1
    fi
  fi

  log "$(msg done_list)"
  run_pm2 ls

  log "$(msg path_info)"
  log "ROOT_DIR=$ROOT_DIR"
  log "CLIENT_DIR=$CLIENT_DIR"
  log "SERVICE_DIR=$SERVICE_DIR"
  log "AGENT_PROXY_DIR=$AGENT_PROXY_DIR"
  log "MODEL_PROXY_DIR=$MODEL_PROXY_DIR"
  log "PM2_HOME_DIR=$PM2_HOME_DIR"
  log "CLIENT_DIST_DIR=$CLIENT_DIST_DIR"
  log "CLIENT_CADDY_CONFIG=$CLIENT_CADDY_CONFIG"
  log "CLIENT_CADDY_BIN=$CLIENT_CADDY_BIN"
  log "$(msg frontend_url "${FRONTEND_URL_ADDR}")"
  log "$(msg api_url "${AGENT_PROXY_UPSTREAM}")"

  print_missing_dependency_hints "${missing_deps[@]}"
}

main "$@"
