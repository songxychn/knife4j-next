#!/usr/bin/env python3
"""Exercise the real UI Maven resource-copy/JAR steps with two dist generations."""

import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

WEBJAR_PREFIX = "META-INF/resources/webjars/knife4j-ui-react/"
MODULE = Path(__file__).resolve().parents[3]


def write_files(directory, files):
    for name, content in files.items():
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)


def read_jar(module):
    jars = [path for path in (module / "target").glob("*.jar")
            if not path.name.endswith(("-sources.jar", "-javadoc.jar"))]
    if len(jars) != 1:
        raise AssertionError(f"Expected one UI JAR, found {jars}")
    with zipfile.ZipFile(jars[0]) as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
        if len(names) != len(set(names)):
            raise AssertionError("Duplicate JAR entries")
        return {name: archive.read(name) for name in names}


def assert_webjar(entries, expected):
    actual = {
        name[len(WEBJAR_PREFIX):]: content
        for name, content in entries.items()
        if name.startswith(WEBJAR_PREFIX)
    }
    if actual != expected:
        extra = sorted(set(actual) - set(expected))
        missing = sorted(set(expected) - set(actual))
        changed = sorted(name for name in actual.keys() & expected.keys()
                         if actual[name] != expected[name])
        raise AssertionError(f"WebJar mismatch: extra={extra}, missing={missing}, changed={changed}")


def package_resources(module, dist):
    # Invoke the existing lifecycle cleanup and configured copy execution, then
    # package the result. Fixtures isolate this regression from Vite compilation.
    subprocess.run([
        "mvn", "-B", "-ntp", "-f", str(module / "pom.xml"),
        f"-Dknife4j-ui-react.outDir={dist}", "initialize",
        "clean:clean@wipe-react-webjar-output",
        "resources:resources", "resources:copy-resources@copy-react-dist", "jar:jar",
        "source:jar@attach-sources",
    ], check=True)
    copied = module / "target/classes" / WEBJAR_PREFIX
    actual = {path.relative_to(copied).as_posix(): path.read_bytes()
              for path in copied.rglob("*") if path.is_file()}
    expected = {path.relative_to(dist).as_posix(): path.read_bytes()
                for path in dist.rglob("*") if path.is_file()}
    if actual != expected:
        raise AssertionError("Copied WebJar output changed after the source JAR lifecycle fork")
    return read_jar(module)


def main():
    with tempfile.TemporaryDirectory(prefix="knife4j-incremental-webjar-") as temporary:
        root = Path(temporary)
        module = root / "knife4j-openapi3-ui"
        module.mkdir()
        # Keep both actual POMs unchanged, including parent/plugin inheritance.
        shutil.copy2(MODULE.parent / "pom.xml", root / "pom.xml")
        shutil.copy2(MODULE / "pom.xml", module / "pom.xml")
        shutil.copytree(MODULE / "src/main/resources", module / "src/main/resources")
        dist = root / "dist"
        first = {
            "index.html": b'<script src="./assets/index.js"></script>',
            "assets/index.js": b'import "./old.js";',
            "assets/old.js": b"export const old = 1;",
            "assets/nested/old.css": b".old { color: red; }",
        }
        write_files(dist, first)
        assert_webjar(package_resources(module, dist), first)
        print("First generation WebJar matches complete dist", flush=True)

        # A later Vite build removes/renames chunks and overwrites its dist.
        shutil.rmtree(dist)
        second = {
            "index.html": b'<script src="./assets/index.js"></script>',
            "assets/index.js": b'import "./new.js";',
            "assets/new.js": b"export const next = 2;",
            "assets/index.css": b".next { color: blue; }",
        }
        write_files(dist, second)
        target = module / "target"
        preserved = {
            "classes/META-INF/resources/webjars/other-ui/keep.txt": b"other webjar",
            "classes/META-INF/keep.txt": b"other classpath output",
            "test-classes/keep.txt": b"test output",
            "keep.txt": b"other target output",
        }
        write_files(target, preserved)
        legacy = module / "src/main/resources/webjars/knife4j-ui-react"
        write_files(legacy, {"assets/legacy.js": b"stale source-tree output"})
        external = root / "external"
        write_files(external, {"keep.txt": b"external symlink target"})
        (target / "classes" / WEBJAR_PREFIX / "external").symlink_to(external, target_is_directory=True)

        entries = package_resources(module, dist)
        assert_webjar(entries, second)
        for name, content in preserved.items():
            if (target / name).read_bytes() != content:
                raise AssertionError(f"Unrelated output changed: {name}")
            if name.startswith("classes/") and entries.get(name[len("classes/"):]) != content:
                raise AssertionError(f"Unrelated classpath output missing from JAR: {name}")
        doc_html = (module / "src/main/resources/doc.html").read_bytes()
        if entries.get("META-INF/resources/doc.html") != doc_html:
            raise AssertionError("doc.html entry changed")
        if legacy.exists():
            raise AssertionError("Legacy source-tree WebJar output was not cleaned")
        if (external / "keep.txt").read_bytes() != b"external symlink target":
            raise AssertionError("Cleanup followed a symlink outside the WebJar")

        # The fileset root must also be safe: followSymlinks=false alone does
        # not protect a symlink used directly as a Maven fileset directory.
        webjar = target / "classes" / WEBJAR_PREFIX
        shutil.rmtree(webjar)
        webjar.symlink_to(external, target_is_directory=True)
        entries = package_resources(module, dist)
        if (external / "keep.txt").read_bytes() != b"external symlink target":
            raise AssertionError("Cleanup followed the WebJar root symlink")
        if webjar.is_symlink():
            raise AssertionError("WebJar root symlink was not replaced with a directory")
        assert_webjar(entries, second)
        for name, content in preserved.items():
            if (target / name).read_bytes() != content:
                raise AssertionError(f"Root symlink cleanup changed unrelated output: {name}")
        print("Incremental WebJar regression PASS: exact files/bytes, unrelated output and nested/root symlink targets preserved", flush=True)


if __name__ == "__main__":
    main()
