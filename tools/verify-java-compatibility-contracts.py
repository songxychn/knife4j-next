#!/usr/bin/env python3
"""Verify the committed Java configuration and public-entry contract manifest."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


METADATA_ENTRY = "META-INF/spring-configuration-metadata.json"
MODULE_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+$")
HEADER = """# type<TAB>module<TAB>key-or-class<TAB>field-or-entry<TAB>expected-value
# `config` rows are generated from built Spring Boot metadata with
# `./tools/verify-java-compatibility-contracts.py --update-config`.
"""


class ContractError(RuntimeError):
    pass


def first_project_value(path: Path, element: str, default: str | None = None) -> str:
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError) as exc:
        raise ContractError(f"cannot parse POM {path}: {exc}") from exc
    namespace = ""
    if root.tag.startswith("{"):
        namespace = root.tag.split("}", 1)[0] + "}"
    node = root.find(f"{namespace}{element}")
    if node is None or not (node.text or "").strip():
        if default is not None:
            return default
        raise ContractError(f"POM {path} has no project {element}")
    return (node.text or "").strip()


def release_modules(repo_root: Path) -> list[str]:
    modules_file = repo_root / "tools/release-modules.txt"
    try:
        lines = modules_file.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ContractError(f"cannot read release module list {modules_file}: {exc}") from exc
    modules = []
    for line in lines:
        value = line.split("#", 1)[0].strip()
        if value:
            if not MODULE_PATTERN.fullmatch(value) or value in {".", ".."}:
                raise ContractError(f"invalid release module name: {value}")
            modules.append(value)
    if not modules or len(modules) != len(set(modules)):
        raise ContractError("release module list must be non-empty and contain no duplicates")
    return modules


def module_jar(repo_root: Path, module: str, version: str) -> Path | None:
    if not MODULE_PATTERN.fullmatch(module) or module in {".", ".."}:
        raise ContractError(f"invalid release module name: {module}")
    pom_file = repo_root / "knife4j" / module / "pom.xml"
    if not pom_file.is_file():
        raise ContractError(f"release module POM is missing: {pom_file}")
    packaging = first_project_value(pom_file, "packaging", "jar")
    if packaging == "pom":
        return None
    if packaging != "jar":
        raise ContractError(f"unsupported packaging for {module}: {packaging}")
    jar_file = repo_root / "knife4j" / module / "target" / f"{module}-{version}.jar"
    if not jar_file.is_file():
        raise ContractError(f"built binary JAR is missing: {jar_file}")
    return jar_file


def actual_configuration_rows(repo_root: Path) -> set[tuple[str, str]]:
    version = first_project_value(repo_root / "knife4j/pom.xml", "version")
    rows: set[tuple[str, str]] = set()
    for module in release_modules(repo_root):
        jar_file = module_jar(repo_root, module, version)
        if jar_file is None:
            continue
        try:
            with zipfile.ZipFile(jar_file) as archive:
                try:
                    payload = archive.read(METADATA_ENTRY)
                except KeyError:
                    continue
        except (OSError, zipfile.BadZipFile) as exc:
            raise ContractError(f"cannot read built JAR {jar_file}: {exc}") from exc
        try:
            metadata = json.loads(payload)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ContractError(f"invalid configuration metadata in {jar_file}: {exc}") from exc
        properties = metadata.get("properties")
        if not isinstance(properties, list):
            raise ContractError(f"configuration metadata has no properties array: {jar_file}")
        for item in properties:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                raise ContractError(f"configuration metadata contains an invalid property: {jar_file}")
            rows.add((module, item["name"]))
    if not rows:
        raise ContractError("no Spring Boot configuration keys were found in built release JARs")
    return rows


def manifest_rows(path: Path) -> list[tuple[int, tuple[str, ...]]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ContractError(f"cannot read contract manifest {path}: {exc}") from exc
    rows: list[tuple[int, tuple[str, ...]]] = []
    for number, line in enumerate(lines, 1):
        if not line or line.startswith("#"):
            continue
        fields = tuple(line.split("\t"))
        expected_lengths = {"config": 3, "constant": 5, "resource": 4}
        expected = expected_lengths.get(fields[0])
        if expected is None or len(fields) != expected or any(not field for field in fields):
            raise ContractError(f"invalid contract manifest row at {path}:{number}")
        rows.append((number, fields))
    if not rows:
        raise ContractError(f"contract manifest is empty: {path}")
    if len({fields for _, fields in rows}) != len(rows):
        raise ContractError(f"contract manifest contains duplicate rows: {path}")
    return rows


def update_config(repo_root: Path, manifest: Path) -> None:
    actual = actual_configuration_rows(repo_root)
    retained = [fields for _, fields in manifest_rows(manifest) if fields[0] != "config"]
    lines = [HEADER.rstrip("\n")]
    lines.extend(f"config\t{module}\t{key}" for module, key in sorted(actual))
    lines.extend("\t".join(fields) for fields in retained)
    manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Updated Java compatibility contracts: {len(actual)} configuration keys.")


def verify(repo_root: Path, manifest: Path) -> None:
    rows = manifest_rows(manifest)
    published_modules = set(release_modules(repo_root))
    expected_config = {(fields[1], fields[2]) for _, fields in rows if fields[0] == "config"}
    actual_config = actual_configuration_rows(repo_root)
    missing = sorted(expected_config - actual_config)
    added = sorted(actual_config - expected_config)
    failures: list[str] = []
    for module, key in missing:
        failures.append(f"missing configuration key: {module}\t{key}")
    for module, key in added:
        failures.append(f"unrecorded configuration key: {module}\t{key}")

    version = first_project_value(repo_root / "knife4j/pom.xml", "version")
    javap_bin = os.environ.get("JAVA_COMPATIBILITY_JAVAP_BIN", "javap")
    javap_cache: dict[tuple[str, str], str] = {}
    constants = 0
    resources = 0
    for number, fields in rows:
        if fields[0] == "constant":
            _, module, class_name, field, expected_value = fields
            if module not in published_modules:
                failures.append(f"line {number}: contract module is not published: {module}")
                continue
            jar_file = module_jar(repo_root, module, version)
            if jar_file is None:
                failures.append(f"line {number}: constant module is POM-only: {module}")
                continue
            cache_key = (str(jar_file), class_name)
            if cache_key not in javap_cache:
                result = subprocess.run(
                    [javap_bin, "-classpath", str(jar_file), "-constants", class_name],
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=False,
                )
                if result.returncode != 0:
                    failures.append(
                        f"line {number}: javap failed for {module}:{class_name}: {result.stderr.strip()}"
                    )
                    continue
                javap_cache[cache_key] = result.stdout
            pattern = re.compile(
                rf'^\s*public static final java\.lang\.String {re.escape(field)} = "{re.escape(expected_value)}";$',
                re.MULTILINE,
            )
            if not pattern.search(javap_cache[cache_key]):
                failures.append(
                    f"line {number}: constant drift: {module}:{class_name}#{field} != {expected_value}"
                )
            constants += 1
        elif fields[0] == "resource":
            _, module, entry, public_path = fields
            if module not in published_modules:
                failures.append(f"line {number}: contract module is not published: {module}")
                continue
            jar_file = module_jar(repo_root, module, version)
            if jar_file is None:
                failures.append(f"line {number}: resource module is POM-only: {module}")
                continue
            try:
                with zipfile.ZipFile(jar_file) as archive:
                    archive.getinfo(entry)
            except (OSError, KeyError, zipfile.BadZipFile):
                failures.append(
                    f"line {number}: public entry {public_path} is missing archive resource {module}:{entry}"
                )
            resources += 1

    if failures:
        raise ContractError("\n".join(failures))
    print(
        "Java compatibility contracts OK: "
        f"{len(expected_config)} configuration keys, {constants} constants, {resources} resources."
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
    )
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--update-config", action="store_true")
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    manifest = (args.manifest or repo_root / "tools/java-compatibility-contracts.tsv").resolve()
    try:
        if args.update_config:
            update_config(repo_root, manifest)
        else:
            verify(repo_root, manifest)
    except (ContractError, OSError) as exc:
        print(f"Java compatibility contract verification failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
