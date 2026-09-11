#!/usr/bin/env python3
"""友链自动化处理器：add / remove / move / retry。
输入：环境变量 ACTION / FIELDS_JSON / ISSUE_NUMBER / MOVE_GROUP / MOVE_TYPE
输出：result.json（status + 附加信息），供工作流回写 Issue。
所有操作幂等：不存在时移除为 noop，已存在时添加为 rejected（去重）。"""
import json
import os
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import yaml

LINKS_FILE = "data/links.yaml"
RESULT_FILE = "result.json"
DEFAULT_GROUP = "网上邻居"
TIMEOUT = 10


def load_links() -> dict:
    with open(LINKS_FILE, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    data.setdefault("links", [])
    return data


def save_links(data: dict) -> None:
    with open(LINKS_FILE, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, sort_keys=False,
                  default_flow_style=False, width=1000)


def is_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def reachable(url: str) -> bool:
    for method in ("HEAD", "GET"):
        try:
            req = Request(url, method=method,
                          headers={"User-Agent": "Mozilla/5.0 friend-links-bot"})
            with urlopen(req, timeout=TIMEOUT) as resp:
                if 200 <= resp.status < 400:
                    return True
        except Exception:
            continue
    return False


def favicon_for(link: str) -> str:
    """favicon 兜底：favicon.im 稳定且跟随重定向可达；
    运行环境（GitHub Actions / 用户浏览器）均在境外或可达，不选国内不稳的服务。"""
    domain = urlparse(link).netloc
    return f"https://favicon.im/{domain}?larger=true"


def find_group(data: dict, class_name: str):
    for group in data["links"]:
        if group.get("class_name") == class_name:
            return group
    return None


def ensure_group(data: dict, class_name: str):
    group = find_group(data, class_name)
    if group is None:
        group = {"class_name": class_name,
                 "class_desc": f"{class_name}的伙伴们~",
                 "type": "card", "link_list": []}
        data["links"].append(group)
    return group


def find_entry(data: dict, issue_number: int):
    for group in data["links"]:
        for item in group.get("link_list", []):
            if item.get("issue_id") == issue_number:
                return group, item
    return None, None


def write_result(status: str, **extra) -> None:
    with open(RESULT_FILE, "w", encoding="utf-8") as f:
        json.dump({"status": status, **extra}, f, ensure_ascii=False)
    # 写 GitHub Output 供工作流的 if 条件使用
    git_output = os.environ.get("GITHUB_OUTPUT")
    if git_output:
        changed = "true" if status in ("added", "removed", "moved") else "false"
        with open(git_output, "a", encoding="utf-8") as f:
            f.write(f"changed={changed}\n")


def do_add(fields: dict, issue_number: int) -> None:
    errors = []
    name = fields.get("name", "").strip()
    link = fields.get("link", "").strip()
    avatar = fields.get("avatar", "").strip()
    linkpage = fields.get("linkpage", "").strip()
    descr = fields.get("descr", "").strip()
    screenshot = fields.get("screenshot", "").strip()

    if not name:
        errors.append("网站名称不能为空")
    if not is_url(link):
        errors.append("网站链接需要是 http(s):// 开头的完整 URL")
    if not descr:
        errors.append("网站描述不能为空")
    if not is_url(screenshot):
        errors.append("网站截图必须是 http(s):// 开头的图片 URL")
    if avatar and not is_url(avatar):
        errors.append("头像 URL 格式错误")
    if linkpage and not is_url(linkpage):
        errors.append("友链页面 URL 格式错误")

    data = load_links()
    if not errors:
        for group in data["links"]:
            for item in group.get("link_list", []):
                if str(item.get("link", "")).rstrip("/") == link.rstrip("/"):
                    errors.append("该网站已在友链列表中，请勿重复申请")
                    break

    if not errors and not reachable(avatar or favicon_for(link)):
        errors.append("头像 URL 无法访问")

    if not errors and not reachable(screenshot):
        errors.append("网站截图 URL 无法访问")

    if errors:
        write_result("rejected", errors=errors)
        return

    group = ensure_group(data, DEFAULT_GROUP)
    entry = {"name": name, "link": link}
    if linkpage:
        entry["linkpage"] = linkpage
    entry["avatar"] = avatar or favicon_for(link)
    entry["descr"] = descr
    entry["screenshot"] = screenshot
    entry["issue_id"] = issue_number
    group.setdefault("link_list", []).append(entry)
    save_links(data)
    write_result("added", group=group["class_name"], name=name)


def do_remove(issue_number: int) -> None:
    data = load_links()
    group, entry = find_entry(data, issue_number)
    if entry is None:
        write_result("noop")
        return
    group["link_list"].remove(entry)
    save_links(data)
    write_result("removed", name=entry.get("name", ""))


def do_move(issue_number: int, move_group: str, move_type: str) -> None:
    data = load_links()
    source, entry = find_entry(data, issue_number)
    if entry is None:
        write_result("noop")
        return
    move_type = move_type.lower()
    target = ensure_group(data, move_group)
    target["type"] = move_type
    if source is target:
        write_result("noop")
        return
    source["link_list"].remove(entry)
    target.setdefault("link_list", []).append(entry)
    save_links(data)
    write_result("moved", group=move_group, type=move_type,
                 name=entry.get("name", ""))


def main() -> None:
    action = os.environ.get("ACTION", "none")
    issue_number = int(os.environ.get("ISSUE_NUMBER", "0") or 0)
    fields = json.loads(os.environ.get("FIELDS_JSON", "{}"))
    move_group = os.environ.get("MOVE_GROUP", "")
    move_type = os.environ.get("MOVE_TYPE", "")

    if action in ("add", "retry"):
        do_add(fields, issue_number)
    elif action == "remove":
        do_remove(issue_number)
    elif action == "move":
        do_move(issue_number, move_group, move_type)
    else:
        write_result("noop")


if __name__ == "__main__":
    main()
