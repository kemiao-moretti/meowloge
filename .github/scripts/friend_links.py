#!/usr/bin/env python3
"""友链自动化处理器：add / remove / move / retry。
输入：环境变量 ACTION / FIELDS_JSON / ISSUE_NUMBER / MOVE_GROUP / MOVE_TYPE
输出：result.json（status + 附加信息），供工作流回写 Issue。
所有操作幂等：不存在时移除为 noop，已存在时添加为 rejected（去重）。

默认可配置项见下方 DEFAULT_GROUP / DEFAULT_GROUP_TYPE：决定新友链写入哪个分组、
以及该分组的卡片类型（type）。"""
import json
import os
from datetime import date
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import yaml

LINKS_FILE = "data/links.yaml"
RESULT_FILE = "result.json"
TIMEOUT = 10

# ============ 可配置项 ============
# 新友链默认写入的分组名，以及该分组的卡片类型（对应 links.yaml 里的 type）。
# item  —— 紧凑列表，不渲染 topimg，无需网站封面图
# discn —— 断联列表，不渲染 topimg，无需网站封面图
# card  —— 封面大卡片，渲染 topimg，网站封面图为必填
DEFAULT_GROUP = "网上邻居"
DEFAULT_GROUP_TYPE = "item"
GROUP_TYPES = ("item", "discn", "card")
# 哪些类型必须有网站封面图，其余类型 topimg 选填
TOPIMG_REQUIRED_TYPES = ("card",)

# 失联友链墓碑：默认友链分组中连续失败达阈值的条目会搬进该分组（保留全部原字段，
# 额外记录 lost_from / lost_since / lost_reason），站点恢复可达后搬回原分组。
LOST_GROUP = "友链墓碑"
LOST_GROUP_DESC = "久未谋面，愿君安好"
LOST_TYPE = "lost"
BURY_THRESHOLD = 2


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


def validate_config() -> None:
    """配置写错时直接报错退出，避免静默写入非法 type。"""
    if DEFAULT_GROUP_TYPE not in GROUP_TYPES:
        raise SystemExit(
            f"配置错误：DEFAULT_GROUP_TYPE={DEFAULT_GROUP_TYPE!r} 无效，"
            f"可选值为 {' / '.join(GROUP_TYPES)}"
        )


def ensure_group(data: dict, class_name: str):
    group = find_group(data, class_name)
    if group is None:
        group = {"class_name": class_name,
                 "class_desc": f"{class_name}的伙伴们~",
                 "type": DEFAULT_GROUP_TYPE, "link_list": []}
        data["links"].append(group)
    return group


def ensure_lost_group(data: dict) -> dict:
    """墓碑分组固定排在末尾，且永不被 ensure_group 的 DEFAULT_GROUP_TYPE 影响。"""
    group = find_group(data, LOST_GROUP)
    if group is None:
        group = {"class_name": LOST_GROUP,
                 "class_desc": LOST_GROUP_DESC,
                 "type": LOST_TYPE, "link_list": []}
        data["links"].append(group)
    else:
        group["type"] = LOST_TYPE
    return group


def bury_entry(data: dict, group: dict, item: dict, reason: str) -> None:
    """把失联条目从原分组搬进墓碑，保留全部原字段并记录失联元数据。"""
    lost_group = ensure_lost_group(data)
    item.pop("fail_count", None)
    item["lost_from"] = group["class_name"]
    item["lost_since"] = date.today().isoformat()
    item["lost_reason"] = reason
    group["link_list"].remove(item)
    lost_group["link_list"].append(item)


def revive_entry(data: dict, lost_group: dict, item: dict) -> str:
    """把恢复可达的条目搬回原分组末尾，并清除全部墓碑字段。"""
    origin_name = item.pop("lost_from", "") or DEFAULT_GROUP
    item.pop("lost_since", None)
    item.pop("lost_reason", None)
    item.pop("fail_count", None)
    group = find_group(data, origin_name) or ensure_group(data, DEFAULT_GROUP)
    lost_group["link_list"].remove(item)
    group["link_list"].append(item)
    return group["class_name"]


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
    topimg = fields.get("topimg", "").strip()
    topimg_required = DEFAULT_GROUP_TYPE in TOPIMG_REQUIRED_TYPES

    if not name:
        errors.append("网站名称不能为空")
    if not is_url(link):
        errors.append("网站链接需要是 http(s):// 开头的完整 URL")
    if not descr:
        errors.append("网站描述不能为空")
    if topimg and not is_url(topimg):
        errors.append("网站封面图必须是 http(s):// 开头的图片 URL")
    if not topimg and topimg_required:
        errors.append(f"网站封面图不能为空（当前友链卡片类型为 {DEFAULT_GROUP_TYPE}）")
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

    if not errors and topimg and not reachable(topimg):
        errors.append("网站封面图 URL 无法访问")

    if errors:
        write_result("rejected", errors=errors)
        return

    group = ensure_group(data, DEFAULT_GROUP)
    group["type"] = DEFAULT_GROUP_TYPE
    entry = {"name": name, "link": link}
    if linkpage:
        entry["linkpage"] = linkpage
    entry["avatar"] = avatar or favicon_for(link)
    entry["descr"] = descr
    if topimg:
        entry["topimg"] = topimg
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


# ============ 定时巡检（do_check） ============

PROBE_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36")
PROBE_TIMEOUT = 15
PROBE_RETRIES = 2
PROBE_RETRY_DELAY = 5
CHECK_RESULT_FILE = "result-check.json"

# Cloudflare 等反爬挑战页面常见特征
_CHALLENGE_MARKERS = (
    "just a moment", "attention required", "checking your browser",
    "cf-chl", "cf-browser-verification", "challenge-platform",
)


def probe(url: str):
    """发起一次 GET 探测，返回 (status, headers, body前4KB)。异常返回 (None, {}, 异常描述)。"""
    from urllib.error import HTTPError
    req = Request(url, headers={
        "User-Agent": PROBE_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    try:
        with urlopen(req, timeout=PROBE_TIMEOUT) as resp:
            body = resp.read(4096).decode("utf-8", errors="ignore")
            return resp.status, resp.headers, body
    except HTTPError as e:
        body = ""
        try:
            body = e.read(4096).decode("utf-8", errors="ignore")
        except Exception:
            pass
        return e.code, e.headers or {}, body
    except Exception as e:
        return None, {}, str(e)


def classify(url: str):
    """带重试的可达性分类：ok / dead / blocked。"""
    for attempt in range(1, PROBE_RETRIES + 1):
        status, headers, body = probe(url)
        body_lower = (body or "").lower()
        has_cf_challenge = any(m in body_lower for m in _CHALLENGE_MARKERS)

        if status is not None and 200 <= status < 400:
            return "ok", f"HTTP {status}"
        if status in (403, 429):
            return "blocked", f"HTTP {status} 反爬拦截"
        if status == 503 and has_cf_challenge:
            return "blocked", "HTTP 503 + Cloudflare 挑战页"
        if status == 404:
            return "dead", "HTTP 404"
        if status is not None and status >= 500:
            if attempt < PROBE_RETRIES:
                import time as _t
                _t.sleep(PROBE_RETRY_DELAY)
                continue
            return "dead", f"HTTP {status} 持续错误"
        # None（超时/DNS/SSL）或未知状态
        if attempt < PROBE_RETRIES:
            import time as _t
            _t.sleep(PROBE_RETRY_DELAY)
    return "dead", "连接失败（超时/DNS/SSL），已重试" + str(PROBE_RETRIES) + " 次"


def do_check() -> None:
    data = load_links()
    changed = False
    buried = []            # 本轮搬进墓碑的
    revived = []           # 本轮从墓碑恢复的
    manual_dead = []       # 非默认友链分组的死链，仅记录
    blocked_new = []       # 本轮新入白名单的
    stats = {"checked": 0, "ok": 0, "dead": 0, "blocked": 0, "skipped": 0}

    for group in list(data["links"]):
        is_lost_group = group.get("class_name") == LOST_GROUP
        is_friend_group = group.get("class_name") == DEFAULT_GROUP
        for item in group.get("link_list", [])[:]:
            link = str(item.get("link", "")).strip()
            if not link:
                continue
            if item.get("skip_check"):
                stats["skipped"] += 1
                continue
            stats["checked"] += 1
            verdict, reason = classify(link)

            if verdict == "ok":
                stats["ok"] += 1
                if is_lost_group:
                    # 墓碑中的站点恢复可达：搬回原分组并清空墓碑字段
                    origin = revive_entry(data, group, item)
                    revived.append({"name": item.get("name", ""), "link": link,
                                    "group": origin, "issue_id": item.get("issue_id")})
                    changed = True
                elif "fail_count" in item:
                    item.pop("fail_count")
                    changed = True
            elif verdict == "blocked":
                stats["blocked"] += 1
                item["skip_check"] = True
                item["skip_reason"] = reason
                if "fail_count" in item:
                    item.pop("fail_count")
                blocked_new.append({"name": item.get("name", ""), "reason": reason})
                changed = True
            else:  # dead
                stats["dead"] += 1
                fail_count = int(item.get("fail_count", 0)) + 1
                item["fail_count"] = fail_count
                changed = True
                if is_lost_group or not is_friend_group:
                    if fail_count >= BURY_THRESHOLD:
                        manual_dead.append({"name": item.get("name", ""),
                                            "link": link, "reason": reason})
                    continue
                if fail_count >= BURY_THRESHOLD:
                    record = {"name": item.get("name", ""), "link": link,
                              "reason": reason, "issue_id": item.get("issue_id")}
                    bury_entry(data, group, item, reason)
                    buried.append(record)

    if changed:
        save_links(data)

    result = {"status": "checked", "stats": stats,
              "buried": buried,
              "revived": revived,
              "manual_dead": manual_dead,
              "blocked_new": blocked_new}
    with open(CHECK_RESULT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 工作流摘要（markdown 表格）
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## 友链巡检结果\n\n")
            f.write(f"检查 {stats['checked']} 条 | 可达 {stats['ok']} | "
                    f"疑似死链 {stats['dead']} | 拦截 {stats['blocked']} | "
                    f"白名单跳过 {stats['skipped']}\n\n")
            for title, rows in (("新入墓碑", buried),
                                ("已恢复（搬回原分组）", revived),
                                ("疑似死链（非友链分组，仅记录）", manual_dead),
                                ("新入白名单", blocked_new)):
                if rows:
                    f.write(f"### {title}\n\n")
                    for r in rows:
                        extra = f" — {r.get('reason', '')}" if r.get("reason") else ""
                        if r.get("group"):
                            extra = f" — 已回到「{r['group']}」"
                        f.write(f"- **{r.get('name', '')}** — `{r.get('link', '')}`{extra}\n")
                    f.write("\n")


def main() -> None:
    validate_config()
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
    elif action == "check":
        do_check()
    else:
        write_result("noop")


if __name__ == "__main__":
    main()
