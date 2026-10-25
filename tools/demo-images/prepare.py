"""Stage exactly one executable Demo JAR and enforce the deployed patch floor."""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
FLOORS = {
    2: {"spring-boot": ["2.7.18"], "spring-core": ["5.3.39"],
        "spring-web": ["5.3.39"], "spring-webmvc": ["5.3.39"],
        "tomcat-embed-core": ["9.0.123"], "tomcat-embed-el": ["9.0.123"],
        "tomcat-embed-websocket": ["9.0.123"], "jackson-databind": ["2.18.12"],
        "logback-core": ["1.2.13"], "logback-classic": ["1.2.13"],
        "log4j-api": ["2.25.5"], "log4j-to-slf4j": ["2.25.5"],
        "snakeyaml": ["1.33"], "classgraph": ["4.8.112"]},
    3: {"spring-boot": ["4.1.2"], "spring-core": ["7.0.10"],
        "spring-web": ["7.0.10"], "spring-webmvc": ["7.0.10"],
        "tomcat-embed-core": ["11.0.27"], "tomcat-embed-el": ["11.0.27"],
        "tomcat-embed-websocket": ["11.0.27"], "jackson-databind": ["2.22.4", "3.1.8"],
        "logback-core": ["1.5.38"], "logback-classic": ["1.5.38"],
        "log4j-api": ["2.25.5"], "log4j-to-slf4j": ["2.25.5"], "snakeyaml": ["2.6"]},
}


def version(value):
    if not re.fullmatch(r"\d+(?:\.\d+)*", value):
        raise ValueError("Non-release dependency version: " + value)
    return tuple(map(int, value.split(".")))


def check_libraries(names, demo):
    result = {}
    for artifact, floors in FLOORS[demo].items():
        matches = [m.group(1) for name in names
                   if (m := re.fullmatch(re.escape(artifact) + r"-(\d[^/]*)\.jar", name))]
        if len(matches) != len(floors):
            raise ValueError("Missing/duplicate security dependency: " + artifact)
        expected = {version(f)[0]: version(f) for f in floors}
        actual = [version(v) for v in matches]
        if {v[0] for v in actual} != set(expected) or any(v < expected[v[0]] for v in actual):
            raise ValueError("Security dependency regressed or changed major: " + artifact)
        result[artifact] = sorted(matches)
    return result


def prepare(demo):
    module = ROOT / "knife4j" / ("knife4j-demo-openapi" + str(demo))
    candidates = []
    for path in (module / "target").glob("*.jar"):
        with zipfile.ZipFile(path) as jar:
            if "BOOT-INF/classes/application.yml" in jar.namelist():
                candidates.append(path)
    if len(candidates) != 1:
        raise ValueError("Expected exactly one executable Demo JAR")
    jar_path = candidates[0]
    with zipfile.ZipFile(jar_path) as jar:
        libraries = [n.removeprefix("BOOT-INF/lib/") for n in jar.namelist()
                     if n.startswith("BOOT-INF/lib/") and n.endswith(".jar")]
    versions = check_libraries(libraries, demo)
    stage = module / "target/demo-image"
    stage.mkdir(exist_ok=True)
    shutil.copyfile(jar_path, stage / "app.jar")
    shutil.copyfile(ROOT / "tools/demo-images/Dockerfile", stage / "Dockerfile")
    subprocess.run(["javac", "--release", "8", "-d", str(stage),
                    str(ROOT / "tools/demo-images/DemoProbe.java")], check=True)
    base = json.loads((ROOT / "tools/demo-images/bases.json").read_text())[str(demo)]
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    manifest = dict(base, demo=demo, revision=revision, libraries=versions,
                    jar_sha256=hashlib.sha256(jar_path.read_bytes()).hexdigest())
    (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return stage, manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("demo", type=int, choices=[2, 3])
    prepare(parser.parse_args().demo)
