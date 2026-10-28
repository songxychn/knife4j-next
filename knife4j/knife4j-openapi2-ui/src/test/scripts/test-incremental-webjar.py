#!/usr/bin/env python3
"""Exercise OAS2 resource copying, lifecycle forks and real cold/hot package (#880)."""

import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
MODULE_PATH = Path("knife4j/knife4j-openapi2-ui")
PREFIX = "META-INF/resources/"
ROOT_FILES = {"doc.html", "favicon.ico", "knife4j-next-mark.svg", "knife4j-next-logo.svg"}


def run(*args, cwd):
    subprocess.run(args, cwd=cwd, check=True)


def files(directory):
    return {p.relative_to(directory).as_posix(): p.read_bytes()
            for p in directory.rglob("*") if p.is_file()}


def mapped(dist):
    return {name: content for name, content in files(dist).items()
            if name in ROOT_FILES or name.startswith(("webjars/", "img/icons/"))}


def write(directory, values):
    for name, content in values.items():
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)


def equal(actual, expected, label):
    if actual != expected:
        extra = sorted(actual.keys() - expected.keys())
        missing = sorted(expected.keys() - actual.keys())
        changed = sorted(n for n in actual.keys() & expected.keys() if actual[n] != expected[n])
        raise AssertionError(f"{label}: extra={extra}, missing={missing}, changed={changed}")


def jar_files(module):
    jars = [p for p in (module / "target").glob("*.jar")
            if not p.name.endswith(("-sources.jar", "-javadoc.jar"))]
    if len(jars) != 1:
        raise AssertionError(f"Expected one production JAR: {jars}")
    with zipfile.ZipFile(jars[0]) as archive:
        names = [n for n in archive.namelist() if not n.endswith("/")]
        if len(names) != len(set(names)):
            raise AssertionError("Duplicate JAR entries")
        return {n[len(PREFIX):]: archive.read(n) for n in names if n.startswith(PREFIX)}


def check(module, expected, label):
    equal(files(module / "target/classes" / PREFIX), expected, label + " classes")
    equal(jar_files(module), expected, label + " JAR")


def copy_inputs(root):
    paths = subprocess.check_output([
        "git", "ls-files", "--cached", "--others", "--exclude-standard", "-z",
        "front/package.json", "front/scripts/check-node.cjs", "front/vue3",
        "knife4j/pom.xml", "knife4j/src/main/resources",
        str(MODULE_PATH / "pom.xml"), str(MODULE_PATH / "src/main/resources"),
        str(MODULE_PATH / "src/test/java"),
    ], cwd=REPO).decode().split("\0")
    for name in filter(None, paths):
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / name, target)


def fixtures(root):
    module = root / MODULE_PATH
    dist = root / "fixture-dist"
    resources = module / "src/main/resources"
    # Keep legacy source icons: default-resources must not copy these generated paths.
    static = {"custom/keep.txt": b"static resource", "img/custom/keep.txt": b"static image"}
    write(resources, static)
    output = module / "target/classes" / PREFIX
    preserved = {"classes/META-INF/keep.txt": b"classpath", "test-classes/keep.txt": b"tests",
                 "keep.txt": b"other target"}

    def package(expected):
        # Real configured cleanup/copy/JAR goals; source:jar forks to generate-sources.
        run("mvn", "-B", "-ntp", "-f", str(module / "pom.xml"),
            f"-Dknife4j-vue3.outDir={dist}", "initialize",
            "resources:resources", "clean:clean@wipe-vue3-webjar-output",
            "resources:copy-resources@copy-vue3-doc-html",
            "resources:copy-resources@copy-vue3-img-icons",
            "resources:copy-resources@copy-vue3-webjars", "jar:jar", "source:jar@attach-sources",
            cwd=module.parent)
        check(module, {**expected, **static}, "Fixture after source lifecycle fork")

    first = {"doc.html": b"first", "favicon.ico": b"old icon", "knife4j-next-logo.svg": b"old logo",
             "knife4j-next-mark.svg": b"old mark", "img/icons/retired.png": b"old icon",
             "webjars/js/old.js": b"old", "webjars/js/old.js.gz": b"old gzip",
             "webjars/css/nested/old.css": b"old css", "webjars/oauth/old.html": b"old oauth",
             "webjars/fonts/old.woff": b"legacy font", "webjars/img/old.png": b"legacy image"}
    write(dist, first)
    package(first)
    shutil.rmtree(dist)
    second = {"doc.html": b"second", "favicon.ico": b"new icon", "knife4j-next-mark.svg": b"new mark",
              "img/icons/current.png": b"new icon", "webjars/js/current.js": b"current",
              "webjars/css/current.css": b"current css", "webjars/oauth/oauth2.html": b"current oauth"}
    write(dist, second)
    write(module / "target", preserved)
    external = root / "external"
    write(external, {"keep.txt": b"external"})
    (output / "webjars/external").symlink_to(external, target_is_directory=True)
    (output / "img/icons/external").symlink_to(external, target_is_directory=True)
    package(second)
    # Parent fileset includes the generated roots themselves, protecting root links too.
    for name in ("webjars", "img/icons"):
        generated = output / name
        shutil.rmtree(generated)
        generated.symlink_to(external, target_is_directory=True)
    (output / "knife4j-next-logo.svg").symlink_to(external / "keep.txt")
    package(second)
    for name in ("webjars", "img/icons"):
        if (output / name).is_symlink():
            raise AssertionError(f"Generated root symlink retained: {name}")
    equal(files(external), {"keep.txt": b"external"}, "External symlink target")
    for name, content in preserved.items():
        if (module / "target" / name).read_bytes() != content:
            raise AssertionError(f"Unrelated output changed: {name}")
    print("OAS2 fixture PASS: generation removal/rename, exact bytes, source fork, static output, nested/root/file symlinks", flush=True)


def workspace(root):
    module = root / MODULE_PATH
    dist = module / "target/knife4j-vue3-dist"
    output = module / "target/classes" / PREFIX
    static = files(module / "src/main/resources")
    def package(label):
        run("mvn", "-B", "-ntp", "-f", str(module / "pom.xml"),
            "-Dknife4j-skipTests=false", "package", cwd=module.parent)
        expected = {**static, **mapped(dist)}
        check(module, expected, label)
        print(f"OAS2 {label} PASS: {len(expected)} mapped/static files, exact classes/JAR bytes", flush=True)

    package("cold package")
    write(output, {"webjars/js/retired-880.js": b"stale", "webjars/css/retired.css.gz": b"stale gzip",
                   "webjars/fonts/retired.woff": b"stale font", "img/icons/retired-880.png": b"stale icon"})
    # Corrupt files that must be overwritten as well as adding obsolete files.
    write(output, {"doc.html": b"stale doc", "knife4j-next-logo.svg": b"stale logo"})
    package("hot package")
    external = root / "external"
    write(external, {"keep.txt": b"external target must stay unchanged"})
    for name in ("webjars", "img/icons"):
        generated = output / name
        shutil.rmtree(generated)
        generated.symlink_to(external, target_is_directory=True)
    # Prove default-resources cannot write legacy root assets through file links either.
    write(module / "src/main/resources", {"knife4j-next-logo.svg": b"legacy source logo"})
    (output / "knife4j-next-logo.svg").unlink()
    (output / "knife4j-next-logo.svg").symlink_to(external / "keep.txt")
    package("hot package with root symlinks")
    equal(files(external), {"keep.txt": b"external target must stay unchanged"},
          "Real package external symlink target")
    for name in ("webjars", "img/icons", "knife4j-next-logo.svg"):
        if (output / name).is_symlink():
            raise AssertionError(f"Real package retained generated symlink: {name}")


def main():
    with tempfile.TemporaryDirectory(prefix="knife4j-oas2-incremental-") as temporary:
        root = Path(temporary)
        for name, test in (("fixtures", fixtures), ("workspace", workspace)):
            area = root / name
            copy_inputs(area)
            test(area)


if __name__ == "__main__":
    main()
