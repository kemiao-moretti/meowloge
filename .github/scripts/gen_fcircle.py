#!/usr/bin/env python3
"""由 data/links.yaml 生成 static/fcircle.json（FCircle 抓取格式）。

输出结构（与 https://blog.liushen.fun/friend.json 一致）：
    {"friends": [[name, link, linkpage, avatar], ...]}

仅读取 links.yaml，不访问 GitHub API；写入后自校验，失败则非零退出。
"""
import json
import os
import sys
from urllib.parse import urlparse

import yaml

LINKS_FILE = "data/links.yaml"
OUT_FILE = "static/fcircle.json"
FRIEND_GROUP = "网上邻居"


def is_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def favicon_for(link: str) -> str:
    return f"https://favicon.im/{urlparse(link).netloc}?larger=true"


def load_links() -> list:
    with open(LINKS_FILE, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data.get("links") or []


def resolve_linkpage(item: dict, link: str) -> str:
    linkpage = str(item.get("linkpage") or "").strip()
    if linkpage and is_url(linkpage):
        return linkpage
    return link


def resolve_avatar(item: dict, link: str) -> str:
    avatar = str(item.get("avatar") or "").strip()
    if is_url(avatar):
        return avatar
    return favicon_for(link)


def build_friends() -> tuple:
    friends = []
    skipped = []
    seen = set()

    for group in load_links():
        if group.get("class_name") != FRIEND_GROUP:
            continue
        for item in group.get("link_list") or []:
            name = str(item.get("name") or "").strip()
            link = str(item.get("link") or "").strip()

            if not name or not is_url(link):
                skipped.append(name or link or "<空条目>")
                continue

            key = link.rstrip("/")
            if key in seen:
                skipped.append(f"{name}（重复链接 {link}）")
                continue
            seen.add(key)

            friends.append([
                name,
                link,
                resolve_linkpage(item, link),
                resolve_avatar(item, link),
            ])

    return friends, skipped


def validate(payload: dict) -> list:
    errors = []
    friends = payload.get("friends")
    if not isinstance(friends, list):
        return ["顶层缺少 friends 数组"]
    if not friends:
        errors.append("friends 数组为空")
    for idx, item in enumerate(friends):
        if not isinstance(item, list) or len(item) != 4:
            errors.append(f"第 {idx} 条不是 4 元组：{item!r}")
            continue
        name, link, linkpage, avatar = item
        if not name:
            errors.append(f"第 {idx} 条 name 为空")
        for field, value in (("link", link), ("linkpage", linkpage), ("avatar", avatar)):
            if not is_url(value):
                errors.append(f"第 {idx} 条 {field} 非合法 URL：{value!r}")
    return errors


def write_summary(friends: list, skipped: list, errors: list) -> None:
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary:
        return
    with open(summary, "a", encoding="utf-8") as f:
        f.write("## FCircle 友链生成结果\n\n")
        f.write(f"输出 {len(friends)} 条 | 跳过 {len(skipped)} 条 | 校验错误 {len(errors)} 条\n\n")
        if skipped:
            f.write("### 已跳过\n\n")
            for s in skipped:
                f.write(f"- {s}\n")
            f.write("\n")
        if errors:
            f.write("### 校验错误\n\n")
            for e in errors:
                f.write(f"- {e}\n")


def main() -> int:
    friends, skipped = build_friends()
    payload = {"friends": friends}

    errors = validate(payload)
    write_summary(friends, skipped, errors)

    if errors:
        print("自校验失败：", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"已生成 {OUT_FILE}：{len(friends)} 条友链，跳过 {len(skipped)} 条")
    for s in skipped:
        print(f"  跳过：{s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
