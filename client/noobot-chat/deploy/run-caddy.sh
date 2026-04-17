#!/usr/bin/env bash
# Copyright (c) 2026 xiayu
# Contact: 126240622+xiayu1987@users.noreply.github.com
# SPDX-License-Identifier: MIT
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

LOCAL_CADDY_BIN="$PROJECT_DIR/deploy/bin/caddy"

detect_os_arch() {
  local os_raw arch_raw
  os_raw="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch_raw="$(uname -m | tr '[:upper:]' '[:lower:]')"

  case "$os_raw" in
    linux) CADDY_OS="linux" ;;
    darwin) CADDY_OS="darwin" ;;
    *) CADDY_OS="" ;;
  esac

  case "$arch_raw" in
    x86_64|amd64) CADDY_ARCH="amd64" ;;
    aarch64|arm64) CADDY_ARCH="arm64" ;;
    *) CADDY_ARCH="" ;;
  esac
}

download_caddy_to_local_bin() {
  detect_os_arch
  if [[ -z "${CADDY_OS:-}" || -z "${CADDY_ARCH:-}" ]]; then
    echo "[run-caddy] 不支持自动下载当前系统: $(uname -s) $(uname -m)"
    return 1
  fi

  local downloader tmp_dir release_json asset_url archive_path
  if command -v curl >/dev/null 2>&1; then
    downloader="curl"
  elif command -v wget >/dev/null 2>&1; then
    downloader="wget"
  else
    echo "[run-caddy] 自动下载需要 curl 或 wget"
    return 1
  fi

  echo "[run-caddy] 检测到本地无 caddy，准备自动下载 (${CADDY_OS}/${CADDY_ARCH})..."
  if [[ "$downloader" == "curl" ]]; then
    release_json="$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest)" || return 1
  else
    release_json="$(wget -qO- https://api.github.com/repos/caddyserver/caddy/releases/latest)" || return 1
  fi

  asset_url="$(printf '%s\n' "$release_json" \
    | grep -oE "https://[^\" ]+caddy_[0-9.]+_${CADDY_OS}_${CADDY_ARCH}\\.tar\\.gz" \
    | head -n 1)"
  if [[ -z "$asset_url" ]]; then
    echo "[run-caddy] 未找到匹配的 caddy 发布包 (${CADDY_OS}/${CADDY_ARCH})"
    return 1
  fi

  tmp_dir="$(mktemp -d)"
  archive_path="$tmp_dir/caddy.tar.gz"

  if [[ "$downloader" == "curl" ]]; then
    curl -fL "$asset_url" -o "$archive_path" || { rm -rf "$tmp_dir"; return 1; }
  else
    wget -O "$archive_path" "$asset_url" || { rm -rf "$tmp_dir"; return 1; }
  fi

  mkdir -p "$(dirname "$LOCAL_CADDY_BIN")"
  tar -xzf "$archive_path" -C "$tmp_dir" || { rm -rf "$tmp_dir"; return 1; }
  if [[ ! -f "$tmp_dir/caddy" ]]; then
    echo "[run-caddy] 解压后未找到 caddy 二进制"
    rm -rf "$tmp_dir"
    return 1
  fi

  mv "$tmp_dir/caddy" "$LOCAL_CADDY_BIN"
  chmod +x "$LOCAL_CADDY_BIN"
  rm -rf "$tmp_dir"
  echo "[run-caddy] 已下载到: $LOCAL_CADDY_BIN"
}

if [[ -n "${CADDY_BIN:-}" ]]; then
  CADDY_BIN="$CADDY_BIN"
elif [[ -x "$LOCAL_CADDY_BIN" ]]; then
  CADDY_BIN="$LOCAL_CADDY_BIN"
else
  download_caddy_to_local_bin || true
  if [[ -x "$LOCAL_CADDY_BIN" ]]; then
    CADDY_BIN="$LOCAL_CADDY_BIN"
  elif command -v caddy >/dev/null 2>&1; then
    CADDY_BIN="caddy"
  else
    echo "[run-caddy] 未找到 caddy 可执行文件。"
    echo "[run-caddy] 请将二进制放到: $LOCAL_CADDY_BIN"
    echo "[run-caddy] 或通过环境变量指定: CADDY_BIN=/path/to/caddy npm run serve:caddy"
    exit 1
  fi
fi

CONFIG_FILE="${CADDY_CONFIG:-$PROJECT_DIR/deploy/Caddyfile}"
SITE_ROOT="${SITE_ROOT:-$PROJECT_DIR/dist}"

if [[ ! -f "$SITE_ROOT/index.html" ]]; then
  echo "[run-caddy] 构建目录不存在（$SITE_ROOT），先执行构建..."
  npm run build
fi

if [[ ! -f "$SITE_ROOT/index.html" ]]; then
  echo "[run-caddy] 未找到 $SITE_ROOT/index.html，请检查 Vite build 输出目录。"
  exit 1
fi

export SITE_ROOT

echo "[run-caddy] using Caddy bin: $CADDY_BIN"
echo "[run-caddy] using config: $CONFIG_FILE"
echo "[run-caddy] site_root=$SITE_ROOT"
echo "[run-caddy] addr=${CADDY_ADDR:-0.0.0.0:10060}, api=${API_UPSTREAM:-127.0.0.1:10061}"

exec "$CADDY_BIN" run --config "$CONFIG_FILE" --adapter caddyfile
