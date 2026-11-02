#!/usr/bin/env python3
"""Fail when current-entry docs reference a Java version other than knife4j/pom.xml."""

from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET


POM_NAMESPACE = "{http://maven.apache.org/POM/4.0.0}"
VERSION = r"\d+\.\d+\.\d+(?:-[\w.]+)?"
COORDINATE_PATTERNS = (
    re.compile(
        r"<groupId>com\.baizhukui</groupId>\s*<artifactId>[^<]+</artifactId>\s*<version>(?P<version>[^<]+)</version>"
    ),
    re.compile(r"com\.baizhukui:[\w-]+:(?P<version>" + VERSION + ")"),
)
CURRENT_MARKER_PATTERNS = (
    re.compile(r"示例使用 Java `(?P<version>" + VERSION + ")`"),
    re.compile(r"The example uses published Java `(?P<version>" + VERSION + ")`"),
    re.compile(r"当前源码版本 \|(?:[^\n]*\|)? `(?P<version>" + VERSION + ")` \|$", re.MULTILINE),
)
LATEST_HEADING = re.compile(r"^### (?P<version>" + VERSION + r") <Badge [^>]*text=\"最新[^\"]*\"", re.MULTILINE)
RELEASE_NOTES = "docs/release-notes/index.md"


def pom_version(root):
    version = ET.parse(root / "knife4j/pom.xml").getroot().find(POM_NAMESPACE + "version")
    if version is None or not version.text:
        raise SystemExit("knife4j/pom.xml has no project version")
    return version.text.strip()


def tracked_markdown(root):
    output = subprocess.check_output(["git", "-C", str(root), "ls-files", "*.md"], text=True)
    return [path for path in output.splitlines() if not path.startswith("legacy/")]


def line_number(text, offset):
    return text.count("\n", 0, offset) + 1


def verify(root):
    expected = pom_version(root)
    failures = []
    for path in tracked_markdown(root):
        text = (root / path).read_text(encoding="utf-8")
        for pattern in COORDINATE_PATTERNS + CURRENT_MARKER_PATTERNS:
            for match in pattern.finditer(text):
                if match.group("version") != expected:
                    failures.append(
                        f"{path}:{line_number(text, match.start())}: {match.group('version')} != {expected}"
                    )

    notes = root / RELEASE_NOTES
    if notes.is_file():
        latest = LATEST_HEADING.findall(notes.read_text(encoding="utf-8"))
        if latest != [expected]:
            failures.append(f"{RELEASE_NOTES}: latest badge on {latest or 'no heading'}, expected [{expected!r}]")
    return expected, failures


def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
    expected, failures = verify(root)
    if failures:
        print(f"Current-entry docs must use Java {expected} from knife4j/pom.xml:", file=sys.stderr)
        for failure in failures:
            print("  " + failure, file=sys.stderr)
        sys.exit(1)
    print(f"Current-entry docs use Java {expected}.")


if __name__ == "__main__":
    main()
