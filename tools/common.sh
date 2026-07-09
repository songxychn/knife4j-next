#!/usr/bin/env bash
# tools/common.sh — 供其他 tools/*.sh source 的通用辅助函数
# 不直接执行；用法: source "$(dirname "$0")/common.sh"
#
# 要求在 bash 下 source（tools 入口脚本均为 #!/usr/bin/env bash）。

# shellcheck disable=SC2034
_common_self="${BASH_SOURCE[0]:-}"
if [ -z "$_common_self" ] || [ "$_common_self" = "bash" ] || [ "$_common_self" = "-bash" ]; then
  echo "tools/common.sh must be sourced from a bash script (BASH_SOURCE missing)." >&2
  return 1 2>/dev/null || exit 1
fi
tools_dir="$(cd "$(dirname "$_common_self")" && pwd)"
repo_root="$(cd "${tools_dir}/.." && pwd)"
unset _common_self

# 读取以 # 为注释、空行忽略的列表文件，逐行打印到 stdout。
# 用法: mapfile -t ARR < <(read_list_file /path/to/list.txt)
#   或: while IFS= read -r line; do ...; done < <(read_list_file ...)
read_list_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "list file not found: $file" >&2
    return 1
  fi
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    # trim leading/trailing whitespace
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    if [ -n "$line" ]; then
      printf '%s\n' "$line"
    fi
  done <"$file"
}

# 可移植地解析 JAVA_HOME（macOS / Linux / 已设置环境变量）。
# 优先使用已有 JAVA_HOME；否则 macOS java_home；再否则从 java 属性读取。
resolve_java_home() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
    printf '%s\n' "$JAVA_HOME"
    return 0
  fi

  if [ -x /usr/libexec/java_home ]; then
    local home
    home="$(/usr/libexec/java_home 2>/dev/null || true)"
    if [ -n "$home" ] && [ -x "${home}/bin/java" ]; then
      printf '%s\n' "$home"
      return 0
    fi
  fi

  if command -v java >/dev/null 2>&1; then
    local home
    home="$(java -XshowSettings:properties -version 2>&1 \
      | sed -n 's/.*java\.home = //p' \
      | head -n1 \
      | tr -d '\r')"
    # 某些发行版 java.home 指向 jre 子目录，往上一级找 bin/java
    if [ -n "$home" ] && [ ! -x "${home}/bin/java" ] && [ -x "${home}/../bin/java" ]; then
      home="$(cd "${home}/.." && pwd)"
    fi
    if [ -n "$home" ] && [ -x "${home}/bin/java" ]; then
      printf '%s\n' "$home"
      return 0
    fi
  fi

  return 1
}

ensure_java_home() {
  local home
  if ! home="$(resolve_java_home)"; then
    echo "Unable to resolve JAVA_HOME. Install a JDK or export JAVA_HOME." >&2
    return 1
  fi
  export JAVA_HOME="$home"
}

# 解析当前 GitHub 仓库 owner/name。优先 GH_REPO / GITHUB_REPOSITORY，再 gh，再 origin remote。
resolve_github_repo() {
  if [ -n "${GH_REPO:-}" ]; then
    printf '%s\n' "$GH_REPO"
    return 0
  fi
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    printf '%s\n' "$GITHUB_REPOSITORY"
    return 0
  fi
  if command -v gh >/dev/null 2>&1; then
    local name
    name="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
    if [ -n "$name" ]; then
      printf '%s\n' "$name"
      return 0
    fi
  fi
  if command -v git >/dev/null 2>&1; then
    local url
    url="$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)"
    if [ -n "$url" ]; then
      # git@host:owner/repo.git 或 https://host/owner/repo.git
      url="${url%.git}"
      url="${url#git@}"
      url="${url#https://}"
      url="${url#http://}"
      url="${url#ssh://git@}"
      url="${url/://}" # host:owner/repo -> host/owner/repo
      # 取最后两段 owner/repo
      printf '%s\n' "$url" | awk -F/ '{print $(NF-1)"/"$NF}'
      return 0
    fi
  fi
  return 1
}
