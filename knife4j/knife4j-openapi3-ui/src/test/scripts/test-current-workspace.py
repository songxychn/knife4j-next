#!/usr/bin/env python3
"""Compare real cold/hot Maven UI builds with an explicit workspace build (#870)."""

import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
MODULE_PATH = Path("knife4j/knife4j-openapi3-ui")
WEBJAR_PREFIX = "META-INF/resources/webjars/knife4j-ui-react/"
PACKAGES = ("core", "schema-engine")


def run(*arguments, cwd):
    subprocess.run(arguments, cwd=cwd, check=True)


def files(directory):
    return {path.relative_to(directory).as_posix(): path.read_bytes()
            for path in directory.rglob("*") if path.is_file()}


def assert_equal(actual, expected, label):
    if actual != expected:
        extra = sorted(actual.keys() - expected.keys())
        missing = sorted(expected.keys() - actual.keys())
        changed = sorted(name for name in actual.keys() & expected.keys()
                         if actual[name] != expected[name])
        raise AssertionError(f"{label}: extra={extra}, missing={missing}, changed={changed}")


def package(module):
    # Use the actual lifecycle, including install, compilation, copying and JAR
    # packaging. Do not inject exec commands or mock the workspace packages.
    run("mvn", "-B", "-ntp", "-f", str(module / "pom.xml"),
        "-Dknife4j-skipTests=false", "package", cwd=module.parent)
    jars = [path for path in (module / "target").glob("*.jar")
            if not path.name.endswith(("-sources.jar", "-javadoc.jar"))]
    if len(jars) != 1:
        raise AssertionError(f"Expected one production UI JAR, found {jars}")
    with zipfile.ZipFile(jars[0]) as archive:
        return {name[len(WEBJAR_PREFIX):]: archive.read(name)
                for name in archive.namelist()
                if name.startswith(WEBJAR_PREFIX) and not name.endswith("/")}


def assert_compile_failure(module, front, name):
    source = front / name / "src/index.ts"
    original = source.read_bytes()
    try:
        source.write_bytes(original + b"\nexport const = ;\n")
        result = subprocess.run([
            "mvn", "-B", "-ntp", "-f", str(module / "pom.xml"), "generate-resources",
        ], cwd=module.parent, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        execution = "core-build" if name == "core" else "schema-build"
        if (result.returncode == 0 or f"({execution})" not in result.stdout
                or "src/index.ts" not in result.stdout or "error TS" not in result.stdout
                or "(vite-build)" in result.stdout):
            raise AssertionError(f"{name} compilation must fail before Vite:\n{result.stdout}")
        print(f"Invalid {name} source PASS: Maven fails before Vite", flush=True)
    finally:
        source.write_bytes(original)


def main():
    with tempfile.TemporaryDirectory(prefix="knife4j-current-workspace-") as temporary:
        root = Path(temporary)
        # Copy current source inputs, including unstaged/new files, never the
        # caller's ignored lib/node_modules/target output or local environment.
        paths = subprocess.check_output([
            "git", "ls-files", "--cached", "--others", "--exclude-standard", "-z",
            "front/package.json", "front/bun.lock", "front/scripts",
            "front/core", "front/schema-engine", "front/ui-react",
            "knife4j/pom.xml", "knife4j/src/main/resources", str(MODULE_PATH / "pom.xml"),
            str(MODULE_PATH / "src/main/resources"),
            str(MODULE_PATH / "src/test/java"),
        ], cwd=REPO).decode().split("\0")
        for name in filter(None, paths):
            source = REPO / name
            if not source.is_file():
                continue
            destination = root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

        module = root / MODULE_PATH
        front = root / "front"
        cold = package(module)
        cold_libs = {name: files(front / name / "lib") for name in PACKAGES}

        for name in PACKAGES:
            run("bun", "run", "--bun", "--filter", f"knife4j-{name}", "build", cwd=front)
        expected_libs = {name: files(front / name / "lib") for name in PACKAGES}
        reference_dist = root / "reference-dist"
        run("bun", "x", "--bun", "vite", "build", f"--outDir={reference_dist}",
            "--emptyOutDir", cwd=front / "ui-react")
        expected = files(reference_dist)
        assert_equal(cold, expected, "Cold Maven WebJar differs from explicit build")
        for name in PACKAGES:
            assert_equal(cold_libs[name], expected_libs[name], f"Cold {name}/lib")
        print(f"Cold workspace PASS: {len(expected)} WebJar files match explicit build", flush=True)

        # Valid but stale compiled JS must survive Vite bundling if Maven fails
        # to rebuild it. Poison both JS and declarations while keeping current
        # sources, installed dependencies and lockfile untouched.
        for name in PACKAGES:
            library = front / name / "lib"
            index = library / "index.js"
            index.write_bytes(f'console.warn("knife4j-870-stale-{name}");\n'.encode() + index.read_bytes())
            declaration = library / "index.d.ts"
            declaration.write_bytes(declaration.read_bytes() + b"\nexport type Knife4j870StaleDeclaration = true;\n")

        hot = package(module)
        assert_equal(hot, expected, "Hot Maven WebJar consumed stale workspace output")
        for name in PACKAGES:
            assert_equal(files(front / name / "lib"), expected_libs[name], f"Hot {name}/lib")
        print(f"Hot workspace PASS: {len(expected)} WebJar files and both package outputs match explicit build", flush=True)

        for name in PACKAGES:
            assert_compile_failure(module, front, name)


if __name__ == "__main__":
    main()
