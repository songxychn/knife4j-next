#!/usr/bin/env python3
"""Turn per-module japicmp XML reports into a stable Markdown/JSON summary."""

from __future__ import annotations

import argparse
import csv
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path


class SummaryError(RuntimeError):
    pass


CATEGORY_LABELS = {
    "breaking": "不兼容 API 变化",
    "compatible": "兼容 API 变化",
    "implementation_only": "仅实现或资源变化",
    "unchanged": "无可见变化",
    "pom": "POM 模块",
}


def boolean_attribute(node: ET.Element, name: str) -> bool:
    value = node.attrib.get(name)
    if value not in {"true", "false"}:
        raise SummaryError(
            f"invalid or missing {name} on compatibilityChange: {ET.tostring(node, encoding='unicode')}"
        )
    return value == "true"


def parse_report(path: Path) -> tuple[int, int, int]:
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError) as exc:
        raise SummaryError(f"cannot parse japicmp XML {path}: {exc}") from exc

    breaking = 0
    compatible = 0
    for change in root.findall(".//compatibilityChange"):
        binary_compatible = boolean_attribute(change, "binaryCompatible")
        source_compatible = boolean_attribute(change, "sourceCompatible")
        if binary_compatible and source_compatible:
            compatible += 1
        else:
            breaking += 1

    # A new or changed public/protected API element normally has a
    # compatibilityChange child. Keep a defensive signal for valid japicmp XML
    # where an element is marked changed without one.
    changed_api_elements = 0
    for tag in ("class", "constructor", "field", "method"):
        for node in root.findall(f".//{tag}"):
            if node.attrib.get("changeStatus") not in {None, "UNCHANGED"}:
                changed_api_elements += 1
    return breaking, compatible, changed_api_elements


def read_records(path: Path, output_dir: Path) -> list[dict[str, object]]:
    try:
        handle = path.open(encoding="utf-8", newline="")
    except OSError as exc:
        raise SummaryError(f"cannot read module records {path}: {exc}") from exc

    modules: list[dict[str, object]] = []
    seen: set[str] = set()
    with handle:
        reader = csv.DictReader(handle, delimiter="\t")
        expected = {
            "module",
            "packaging",
            "baseline_digest",
            "current_digest",
            "xml_report",
            "markdown_report",
            "archive_report",
        }
        if set(reader.fieldnames or []) != expected:
            raise SummaryError(f"invalid module record header in {path}")
        for row in reader:
            if any(row.get(field) in {None, ""} for field in expected):
                raise SummaryError(f"incomplete module record in {path}: {row}")
            module = row["module"]
            packaging = row["packaging"]
            if not module or module in seen:
                raise SummaryError(f"empty or duplicate module record in {path}: {module!r}")
            seen.add(module)
            if packaging == "pom":
                category = "pom"
                breaking = compatible = changed_elements = 0
            elif packaging == "jar":
                xml_relative = Path(row["xml_report"])
                if xml_relative.is_absolute() or ".." in xml_relative.parts:
                    raise SummaryError(f"unsafe XML report path for {module}: {xml_relative}")
                breaking, compatible, changed_elements = parse_report(output_dir / xml_relative)
                if breaking:
                    category = "breaking"
                elif compatible or changed_elements:
                    category = "compatible"
                elif row["baseline_digest"] != row["current_digest"]:
                    category = "implementation_only"
                else:
                    category = "unchanged"
            else:
                raise SummaryError(f"unsupported packaging for {module}: {packaging}")
            modules.append(
                {
                    "module": module,
                    "packaging": packaging,
                    "category": category,
                    "categoryLabel": CATEGORY_LABELS[category],
                    "breakingChanges": breaking,
                    "compatibleChanges": compatible,
                    "changedApiElements": changed_elements,
                    "baselineDigest": row["baseline_digest"],
                    "currentDigest": row["current_digest"],
                    "xmlReport": row["xml_report"],
                    "markdownReport": row["markdown_report"],
                    "archiveReport": row["archive_report"],
                }
            )
    if not modules:
        raise SummaryError(f"module record file is empty: {path}")
    return modules


def write_markdown(
    path: Path, modules: list[dict[str, object]], baseline: str, current: str
) -> None:
    counts = Counter(str(module["category"]) for module in modules)
    lines = [
        "# Java 兼容性差异报告",
        "",
        f"基线：Maven Central `com.baizhukui:*:{baseline}`；当前构建：`{current}`。",
        "",
        "> 即使版本号相同，基线也始终下载到临时文件并与本地 `target` JAR 比较，"
        "不会把当前产物同时作为新旧输入。",
        "",
        "> 本报告为 report-first 信号：检测到真实 API 或实现差异不会令 CI 失败。"
        "基线下载失败、报告工具失败、发布模块清单漂移或已登记配置/公开入口契约漂移会失败。",
        "",
        "> japicmp 使用 `--ignore-missing-classes` 分析各模块；未解析的外部依赖可能影响完整性，"
        "因此结果不能替代消费方测试与维护者审查。",
        "",
        "## 汇总",
        "",
        "| 分类 | 模块数 |",
        "| --- | ---: |",
    ]
    for category in (
        "breaking",
        "compatible",
        "implementation_only",
        "unchanged",
        "pom",
    ):
        lines.append(f"| {CATEGORY_LABELS[category]} | {counts[category]} |")
    lines.extend(
        [
            "",
            "## 模块明细",
            "",
            "| 模块 | 分类 | 不兼容项 | 兼容项 | 归一化归档 | 明细 |",
            "| --- | --- | ---: | ---: | --- | --- |",
        ]
    )
    for module in modules:
        if module["packaging"] == "pom":
            digest_state = "不适用"
            detail = "—"
        else:
            digest_state = (
                "相同" if module["baselineDigest"] == module["currentDigest"] else "不同"
            )
            detail = f"API `{module['markdownReport']}`；归档 `{module['archiveReport']}`"
        lines.append(
            f"| `{module['module']}` | {module['categoryLabel']} | "
            f"{module['breakingChanges']} | {module['compatibleChanges']} | {digest_state} | {detail} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--records", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--baseline-version", required=True)
    parser.add_argument("--current-version", required=True)
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    try:
        modules = read_records(args.records.resolve(), output_dir)
        counts = Counter(str(module["category"]) for module in modules)
        payload = {
            "formatVersion": 1,
            "baselineVersion": args.baseline_version,
            "currentVersion": args.current_version,
            "reportOnly": True,
            "ignoreMissingClasses": True,
            "totals": {
                "modules": len(modules),
                **{
                    category: counts[category]
                    for category in (
                        "breaking",
                        "compatible",
                        "implementation_only",
                        "unchanged",
                        "pom",
                    )
                },
            },
            "modules": modules,
        }
        write_markdown(
            output_dir / "summary.md",
            modules,
            args.baseline_version,
            args.current_version,
        )
        (output_dir / "summary.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    except (SummaryError, OSError) as exc:
        print(f"Java compatibility summary failed: {exc}", file=sys.stderr)
        return 1
    print(f"Java compatibility summary written for {len(modules)} modules.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
