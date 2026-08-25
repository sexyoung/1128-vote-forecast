#!/usr/bin/env bash
# Claude Code status line script

input=$(cat)

# --- Colors (ANSI) ---
RESET="\033[0m"
BOLD="\033[1m"
DIM="\033[2m"

GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
WHITE="\033[37m"

BG_BLUE="\033[44m"

# --- Helper: pick color by percentage (0-100) ---
pct_color() {
  local pct="${1:-0}"
  local low="${2:-40}"   # threshold: green → yellow
  local high="${3:-75}"  # threshold: yellow → red
  if   awk "BEGIN{exit !($pct >= $high)}"; then printf '%s' "$RED"
  elif awk "BEGIN{exit !($pct >= $low)}";  then printf '%s' "$YELLOW"
  else printf '%s' "$GREEN"
  fi
}

# --- Helper: compact progress bar (10 chars wide) ---
progress_bar() {
  local pct="${1:-0}"
  local width=10
  local filled
  filled=$(awk "BEGIN{printf \"%d\", ($pct/100)*$width}")
  local empty=$(( width - filled ))
  local bar=""
  local i
  for (( i=0; i<filled; i++ )); do bar+="█"; done
  for (( i=0; i<empty;  i++ )); do bar+="░"; done
  printf '%s' "$bar"
}

# --- Extract fields from JSON ---
model=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
cwd=$(echo "$input" | jq -r '.cwd // empty')

# --- Git info (skip lock files to avoid blocking) ---
git_branch=""
git_changes=""
if [ -n "$cwd" ]; then
  git_branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
  if [ -n "$git_branch" ]; then
    # Count staged + unstaged changed files (excludes untracked)
    changed=$(git -C "$cwd" --no-optional-locks diff --name-only HEAD 2>/dev/null | wc -l | tr -d ' ')
    # Count untracked files
    untracked=$(git -C "$cwd" --no-optional-locks ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
    if [ "$changed" -gt 0 ] || [ "$untracked" -gt 0 ]; then
      git_changes="${changed}~ ${untracked}?"
    fi
  fi
fi


# Context window used percentage
ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# 5-hour rate limit
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')

# 7-day rate limit
seven_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
seven_resets=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

# --- Build output ---
parts=()

sep="$(printf "${DIM} | ${RESET}")"

# 1. Git branch and local changes
if [ -n "$git_branch" ]; then
  branch_str="$(printf "${BOLD}${WHITE}${BG_BLUE} %s ${RESET}" "$git_branch")"
  if [ "$changed" -gt 0 ] || [ "$untracked" -gt 0 ]; then
    change_str=""
    [ "$changed" -gt 0 ] && change_str="${YELLOW}${changed}~${RESET}"
    [ "$untracked" -gt 0 ] && { [ -n "$change_str" ] && change_str+=" "; change_str+="${GREEN}${untracked}?${RESET}"; }
    parts+=("$(printf "${branch_str} ${change_str}")")
  else
    parts+=("$(printf "${branch_str}")")
  fi
fi

# 2. Context window with progress bar
if [ -n "$ctx_pct" ]; then
  ctx_int=$(printf '%.0f' "$ctx_pct")
  col=$(pct_color "$ctx_pct" 50 80)
  bar=$(progress_bar "$ctx_pct")
  parts+=("$(printf "ctx:${col}%s %d%%${RESET}" "$bar" "$ctx_int")")
fi

# 3. 5-hour rate limit
if [ -n "$five_pct" ]; then
  five_int=$(printf '%.0f' "$five_pct")
  col=$(pct_color "$five_pct" 50 80)
  bar=$(progress_bar "$five_pct")
  reset_str=""
  if [ -n "$five_resets" ]; then
    now=$(date +%s)
    remaining=$(( five_resets - now ))
    if [ "$remaining" -gt 0 ]; then
      hours=$(( remaining / 3600 ))
      mins=$(( (remaining % 3600) / 60 ))
      if [ "$hours" -gt 0 ]; then
        reset_str=" ${hours}h${mins}m"
      else
        reset_str=" ${mins}m"
      fi
    fi
  fi
  parts+=("$(printf "5h:${col}%s %d%%${DIM}%s${RESET}" "$bar" "$five_int" "$reset_str")")
fi

# 4. 7-day rate limit
if [ -n "$seven_pct" ]; then
  seven_int=$(printf '%.0f' "$seven_pct")
  col=$(pct_color "$seven_pct" 50 80)
  bar=$(progress_bar "$seven_pct")
  reset_str=""
  if [ -n "$seven_resets" ]; then
    reset_str=" $(TZ='Asia/Taipei' date -d "@$seven_resets" '+%a %-I:%M%p' 2>/dev/null || TZ='Asia/Taipei' date -r "$seven_resets" '+%a %-I:%M%p' 2>/dev/null)"
  fi
  parts+=("$(printf "7d:${col}%s %d%%${DIM}%s${RESET}" "$bar" "$seven_int" "$reset_str")")
fi

# 5. Model name (cyan, bold) — last
parts+=("$(printf "${BOLD}${CYAN}%s${RESET}" "$model")")

# Join with separator
result=""
for part in "${parts[@]}"; do
  if [ -z "$result" ]; then result="$part"; else result="${result}${sep}${part}"; fi
done

printf '%b\n' "$result"
