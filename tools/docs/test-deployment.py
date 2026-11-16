#!/usr/bin/env python3
"""Exercise documented deployment snippets against the locally built WebJar."""

import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
SNIPPETS = ROOT / "docs/snippets/deployment"
IMAGE = "docker.io/library/nginx:1.28.0-alpine"


def run(command, check=True):
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    if check and result.returncode:
        raise RuntimeError(f"{command[0]} failed ({result.returncode}):\n{result.stdout}\n{result.stderr}")
    return result


def exercise(directory):
    static = directory / "static"
    static.mkdir()
    version = ET.parse(ROOT / "knife4j/pom.xml").getroot().findtext("{http://maven.apache.org/POM/4.0.0}version")
    jar = ROOT / f"knife4j/knife4j-openapi3-ui/target/knife4j-openapi3-ui-{version}.jar"
    if not jar.is_file():
        raise RuntimeError(f"Build Java first: missing {jar}")
    environment = dict(os.environ, KNIFE4J_UI_JAR=str(jar), KNIFE4J_STATIC_DIR=str(static))
    subprocess.run(["bash", str(SNIPPETS / "unpack.sh")], env=environment,
                   capture_output=True, text=True, check=True, timeout=60)
    html = (static / "doc.html").read_text()
    references = re.findall(r'(?:src|href)="([^"]+)"', html)
    if not references or not all((static / path).is_file() for path in references):
        raise RuntimeError("documented extraction loses HTML assets (do not flatten the WebJar)")
    workers = [p for p in static.rglob("*.js") if "worker" in p.name.lower()]
    if not workers:
        raise RuntimeError("documented extraction loses Schema Worker assets")
    (static / "swagger-config.json").write_bytes((SNIPPETS / "static.json").read_bytes())
    (static / "json").mkdir()
    for service in ("user", "order"):
        (static / f"json/{service}-service.json").write_text(json.dumps({
            "openapi": "3.0.3", "info": {"title": service, "version": "1"}, "paths": {}}))
    multiservice = directory / "multiservice"
    shutil.copytree(static, multiservice)
    (multiservice / "swagger-config.json").write_bytes((SNIPPETS / "multiservice.json").read_bytes())
    digest = run(["openssl", "passwd", "-apr1", "documentation-test-only"]).stdout.strip()
    (directory / "htpasswd").write_text("audit:" + digest + "\n")
    servers, cases, mutations = [], [], []
    policies = ["", *[(SNIPPETS / f"{name}.nginx").read_text() for name in ("closed", "basic", "private")]]
    for index, name in enumerate(("proxy", "multiservice", "static")):
        for mode, policy in enumerate(policies):
            port = 18080 + index * 10 + mode
            source = (SNIPPETS / f"{name}.nginx").read_text()
            if source.count("listen 80;") != 1 or source.count("server_name doc.example.com;") != 1:
                raise RuntimeError(f"{name}: update the test adapter for the new documented listener shape")
            source = source.replace("listen 80;", f"listen {port};").replace(
                "server_name doc.example.com;", "server_name doc.example.com;\n" + policy)
            if name == "multiservice":
                source = source.replace("/opt/knife4j-static", "/opt/knife4j-multiservice")
            servers.append(source)
            cases.append((port, mode))
            if name == "multiservice" and mode == 0:
                # These broken variants must fail against the same strict backends.
                for offset, upstream in enumerate(("http://user-service:8081/WRONG/", "http://user-service:8081")):
                    mutant_port = 19090 + offset
                    mutant, count = re.subn(r"proxy_pass http://user-service:8081[^;]*;",
                                            f"proxy_pass {upstream};", source)
                    if count != 1:
                        raise RuntimeError("update the service proxy mutation adapter")
                    servers.append(mutant.replace(f"listen {port};", f"listen {mutant_port};"))
                    mutations.append(mutant_port)
    for port, body in [(8080, '{"urls":[{"name":"mock","url":"/v3/api-docs"}]}'),
                       (8081, '{"backend":"user"}'), (8082, '{"backend":"order"}')]:
        # Unknown paths are 404 so a wrong proxy prefix cannot look healthy.
        endpoint = "/v3/api-docs/swagger-config" if port == 8080 else "/v3/api-docs"
        servers.append(f"server {{ listen {port}; location = {endpoint} {{ default_type application/json; return 200 '{body}'; }} location / {{ return 404; }} }}")
    (directory / "nginx.conf").write_text("pid /tmp/nginx.pid;\nerror_log /dev/stderr;\nevents {}\nhttp {\ninclude /etc/nginx/mime.types;\ndefault_type application/octet-stream;\n" + "\n".join(servers) + "\n}\n")
    mounts = []
    for source, destination in [(directory / "nginx.conf", "/audit/nginx.conf"),
                                (static, "/opt/knife4j-static"), (multiservice, "/opt/knife4j-multiservice"), (directory / "htpasswd", "/etc/nginx/.htpasswd")]:
        mounts.extend(["--mount", f"type=bind,src={source},dst={destination},readonly"])
    options = ["--network", "none", "--add-host", "backend:127.0.0.1", "--add-host", "user-service:127.0.0.1", "--add-host", "order-service:127.0.0.1", *mounts]
    run(["docker", "run", "--rm", *options, IMAGE, "nginx", "-t", "-c", "/audit/nginx.conf"])
    name = "knife4j-docs-" + uuid.uuid4().hex[:12]
    try:
        run(["docker", "run", "-d", "--rm", "--name", name, *options, IMAGE,
             "nginx", "-c", "/audit/nginx.conf", "-g", "daemon off;"])
        # Container creation does not mean the worker has opened its listener yet.
        for attempt in range(20):
            ready = run(["docker", "exec", name, "wget", "-q", "--spider", "http://127.0.0.1:18080/doc.html"], False)
            if ready.returncode == 0:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Nginx did not become ready: " + run(["docker", "logs", name], False).stderr)
        checked = 0
        paths = ["/doc.html", "/v3/api-docs/swagger-config", "/swagger-config.json", "/json/user-service.json",
                 "/webjars/knife4j-ui-react/assets/index.js", "/" + workers[0].relative_to(static).as_posix()]
        for port, mode in cases:
            for path in paths:
                response = run(["docker", "exec", name, "wget", "-S", "-O", "/dev/null", f"http://127.0.0.1:{port}{path}"], False)
                statuses = re.findall(r"HTTP/1\.[01] (\d+)", response.stderr)
                expected = (200, 403, 401, 403)[mode]
                if not statuses or int(statuses[-1]) != expected:
                    raise RuntimeError(f"{port}{path}: expected {expected}, got {response.stderr}")
                if mode == 0 and path.endswith(".js") and "Content-Type: application/javascript" not in response.stderr:
                    raise RuntimeError(f"JavaScript MIME lost: {path}")
                checked += 1
            if mode == 2:
                auth = base64.b64encode(b"audit:documentation-test-only").decode()
                response = run(["docker", "exec", name, "wget", "-S", "-O", "/dev/null", "--header", f"Authorization: Basic {auth}", f"http://127.0.0.1:{port}/v3/api-docs/swagger-config"])
                if "HTTP/1.1 200" not in response.stderr:
                    raise RuntimeError("correct Basic credentials were rejected")
                checked += 1
        for mode, port in [("multiservice", 18090), ("static", 18100)]:
            response = run(["docker", "exec", name, "wget", "-qO-", f"http://127.0.0.1:{port}/v3/api-docs/swagger-config"])
            payload = json.loads(response.stdout)
            if payload != json.loads((SNIPPETS / f"{mode}.json").read_text()):
                raise RuntimeError(f"{mode}: Nginx discovery differs from the documented JSON")
            checked += 1
            for group, service in zip(payload["urls"], ("user", "order")):
                response = run(["docker", "exec", name, "wget", "-qO-", f"http://127.0.0.1:{port}" + group["url"]])
                document = json.loads(response.stdout)
                if (document.get("backend") if mode == "multiservice" else document.get("info", {}).get("title")) != service:
                    raise RuntimeError(f"{mode}: documented group reaches the wrong backend or static JSON")
                checked += 1
        for port in mutations:
            response = run(["docker", "exec", name, "wget", "-S", "-O", "/dev/null", f"http://127.0.0.1:{port}/user-service/v3/api-docs"], False)
            statuses = re.findall(r"HTTP/1\.[01] (\d+)", response.stderr)
            if not statuses or statuses[-1] != "404":
                raise RuntimeError("broken proxy prefix unexpectedly passed: " + response.stderr)
            checked += 1
        print(f"Documented WebJar/Nginx deployment: {checked} HTTP checks passed, including Worker MIME and access protection")
    finally:
        run(["docker", "rm", "-f", name], False)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="knife4j-doc-deployment-") as temp:
        exercise(Path(temp))
