import json
import os
from datetime import datetime
from urllib.parse import urlparse

import yaml

DATA_FILE = "data/about.yaml"
RESULT_FILE = "result.json"


def is_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def write_result(status: str, **extra) -> None:
    with open(RESULT_FILE, "w", encoding="utf-8") as f:
        json.dump({"status": status, **extra}, f, ensure_ascii=False)
    git_output = os.environ.get("GITHUB_OUTPUT")
    if git_output:
        changed = "true" if status == "added" else "false"
        with open(git_output, "a", encoding="utf-8") as f:
            f.write(f"changed={changed}\n")


def find_existing_entry(donations: list, issue_number: int):
    for item in donations:
        if isinstance(item, dict) and item.get("issue_id") == issue_number:
            return item
    return None


def append_donation_line(content: str, new_line: str) -> str:
    eol = "\r\n" if "\r\n" in content else "\n"
    lines = content.splitlines(keepends=True)
    donations_idx = None
    for i, line in enumerate(lines):
        if line.rstrip("\r\n") == "  donations:":
            donations_idx = i
            break
    if donations_idx is None:
        raise ValueError(f"donations section not found in {DATA_FILE}")
    last_item_idx = None
    for i in range(donations_idx + 1, len(lines)):
        stripped = lines[i].rstrip("\r\n")
        if not stripped.strip():
            continue
        if stripped.startswith("    - "):
            last_item_idx = i
        elif stripped.lstrip().startswith("#"):
            continue
        else:
            break
    insert_idx = last_item_idx + 1 if last_item_idx is not None else donations_idx + 1
    lines.insert(insert_idx, new_line + eol)
    return "".join(lines)


def do_add(fields: dict, issue_number: int) -> None:
    errors = []
    name = str(fields.get("name", "")).strip()
    amount = str(fields.get("amount", "")).strip()
    date = str(fields.get("date", "")).strip()
    screenshot = str(fields.get("screenshot", "")).strip()

    if not name:
        errors.append("「赞助者名称」不能为空")
    if not amount:
        errors.append("「赞助金额」不能为空")
    if not date:
        errors.append("「赞助日期」不能为空")
    else:
        try:
            parsed_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            errors.append("「赞助日期」格式必须为 YYYY-MM-DD")
        else:
            date = parsed_date.isoformat()
    if not screenshot:
        errors.append("「支付截图」不能为空")
    elif not is_url(screenshot):
        errors.append("「支付截图」必须是有效的 HTTP(S) 链接")

    if errors:
        write_result("rejected", errors=errors)
        return

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    data = yaml.safe_load(content) or {}
    donations = ((data.get("reward") or {}).get("donations")) or []
    if find_existing_entry(donations, issue_number) is not None:
        write_result("noop", name=name)
        return

    entry = {"name": name, "amount": amount, "date": date, "issue_id": issue_number}
    body = yaml.dump(
        entry,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=True,
        width=10000,
    ).strip()
    updated = append_donation_line(content, f"    - {body}")
    with open(DATA_FILE, "w", encoding="utf-8", newline="") as f:
        f.write(updated)
    write_result("added", name=name, amount=amount, date=date)


def main() -> None:
    action = os.environ.get("ACTION", "none")
    issue_raw = os.environ.get("ISSUE_NUMBER", "0") or "0"
    try:
        issue_number = int(issue_raw)
    except ValueError:
        issue_number = 0
    if action != "add" or issue_number <= 0:
        write_result("skipped")
        return
    try:
        fields = json.loads(os.environ.get("FIELDS_JSON", "{}"))
    except json.JSONDecodeError as exc:
        write_result("rejected", errors=[f"FIELDS_JSON 无法解析: {exc}"])
        return
    do_add(fields, issue_number)


if __name__ == "__main__":
    main()
