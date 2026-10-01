#!/usr/bin/env python3
"""本階段一次性檢查：計畫與附件的欄位齊全、需求都有去處、沒有不該公開的路徑。

用法：python3 check_plan.py [計畫檔路徑]
預設檢查與本目錄同名的計畫檔。失敗時列出每個問題並以 exit 1 結束。
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_PLAN = HERE.parent / f"{HERE.name}.md"

STEP_FIELDS = ["範圍：", "消費端：", "不能動：", "驗收：", "停止條件："]
DECISION_FIELDS = ["狀態：", "擋住步驟：", "需要的事實："]
# 公開 repo 不得出現的本機絕對路徑與本機個人脈絡檔名
FORBIDDEN = ["/Users/", "/home/", "/private/", "/tmp/", "AGENTS.local"]


def split_blocks(text, header_re):
    """依標題行切出區塊：回傳 [(標題行, 區塊內容)]。"""
    lines = text.splitlines()
    blocks, cur = [], None
    for line in lines:
        if re.match(header_re, line):
            if cur:
                blocks.append(cur)
            cur = [line, []]
        elif cur is not None:
            if line.startswith("## ") or (line.startswith("- ") and not line.startswith("  ")):
                blocks.append(cur)
                cur = None
                continue
            cur[1].append(line)
    if cur:
        blocks.append(cur)
    return [(h, "\n".join(b)) for h, b in blocks]


def main():
    plan_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PLAN
    att_dir = plan_path.parent / plan_path.stem
    plan = plan_path.read_text(encoding="utf-8")
    errors = []

    if "<!--" in plan:
        errors.append("計畫仍有 HTML 註解（模板檔頭未刪）")

    # 步驟欄位
    steps = split_blocks(plan, r"^- \[[ x]\] \*\*\d+\. ")
    step_nums = set()
    for head, body in steps:
        num = re.search(r"\*\*(\d+)\. ", head).group(1)
        step_nums.add(num)
        if "收尾" in head:
            if "驗收：" not in head + body:
                errors.append(f"步驟 {num}（收尾）缺驗收")
            continue
        if "被擋於：" not in head:
            errors.append(f"步驟 {num} 標題缺「被擋於」")
        for f in STEP_FIELDS:
            if f not in body:
                errors.append(f"步驟 {num} 缺「{f.rstrip('：')}」")
    if not steps:
        errors.append("找不到任何步驟")
    elif "收尾" not in steps[-1][0]:
        errors.append("最後一步不是收尾")

    # 決定欄位
    decisions = split_blocks(plan, r"^- \*\*D\d+ ")
    dec_ids = set()
    for head, body in decisions:
        did = re.search(r"\*\*(D\d+) ", head).group(1)
        dec_ids.add(did)
        for f in DECISION_FIELDS:
            if f not in head:
                errors.append(f"{did} 缺「{f.rstrip('：')}」")
        options = re.findall(r"^  - [A-Z]：", body, re.M)
        if len(options) < 2:
            errors.append(f"{did} 選項少於 2 個")
        if "建議" not in body:
            errors.append(f"{did} 缺建議")
        if "結論：" not in body:
            errors.append(f"{did} 缺結論列")
        if "未決" not in head and not re.search(r"已決 \d{4}-\d{2}-\d{2}", head):
            errors.append(f"{did} 狀態不是未決，也沒有「已決 日期」")
    if "拍板順序：" not in plan:
        errors.append("缺拍板順序")

    # 計畫內引用的決定都存在
    for ref in sorted(set(re.findall(r"\bD\d+\b", plan)) - dec_ids):
        errors.append(f"計畫引用了不存在的決定 {ref}")

    # 需求清單：每個 R 都有對應，且引用的步驟與決定存在
    req = (att_dir / "requirements.md").read_text(encoding="utf-8")
    req_rows = re.findall(r"^\| (R\d+) \|([^\n]*)$", req, re.M)
    if not req_rows:
        errors.append("requirements.md 找不到需求列")
    for rid, rest in req_rows:
        cols = [c.strip() for c in rest.split("|")]
        target = cols[-2] if len(cols) >= 2 else ""
        if not target:
            errors.append(f"{rid} 沒有對應（步驟、決定或範圍）")
            continue
        for n in re.findall(r"步驟 ([\d、]+)", target):
            for x in n.split("、"):
                if x and x not in step_nums:
                    errors.append(f"{rid} 對應到不存在的步驟 {x}")
        for d in re.findall(r"\bD\d+\b", target):
            if d not in dec_ids:
                errors.append(f"{rid} 對應到不存在的決定 {d}")

    # 公開安全：計畫與附件不得含私人路徑
    files = [plan_path] + sorted(p for p in att_dir.rglob("*") if p.is_file() and p.name != "check_plan.py")
    for p in files:
        text = p.read_text(encoding="utf-8")
        for bad in FORBIDDEN:
            if bad in text:
                errors.append(f"{p.name} 含不應公開的路徑片段「{bad}」")

    if errors:
        print("FAIL")
        for e in errors:
            print(" -", e)
        return 1
    print(f"OK：{len(steps)} 步、{len(dec_ids)} 題決定、{len(req_rows)} 項需求")
    return 0


if __name__ == "__main__":
    sys.exit(main())
