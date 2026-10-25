"""Exercise an image with the live Demo privilege/resource and CA mount contract."""
import argparse
import json
import pathlib
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

import smoke
from identity import fingerprint


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT, timeout=180)


def inspect(name):
    return json.loads(run("docker", "inspect", name))[0]


def ready(name, port):
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        c = inspect(name)
        if not c["State"]["Running"]:
            raise RuntimeError("Candidate stopped")
        if c["State"].get("Health", {}).get("Status") == "healthy":
            # Docker may allocate a different ephemeral host port after restart.
            binding = c["NetworkSettings"]["Ports"][str(port) + "/tcp"][0]
            assert binding["HostIp"] == "127.0.0.1"
            base = "http://127.0.0.1:" + binding["HostPort"]
            with urllib.request.urlopen(base + "/doc.html", timeout=10) as response:
                assert response.status == 200
            return base
        time.sleep(2)
    raise RuntimeError("Candidate health timeout")


def runtime(name):
    c = inspect(name)
    h = c["HostConfig"]
    assert c["Config"]["User"] == "10001:10001"
    assert h["ReadonlyRootfs"] and h["CapDrop"] == ["ALL"] and not h["Privileged"]
    assert "no-new-privileges:true" in h["SecurityOpt"]
    assert h["Memory"] == h["MemorySwap"] == 768 * 1024**2
    assert h["NanoCpus"] == 10**9 and h["PidsLimit"] == 384
    status = dict(line.split(":", 1) for line in run("docker", "exec", name, "cat", "/proc/1/status").splitlines() if ":" in line)
    assert status["Uid"].split() == ["10001"] * 4 and status["Gid"].split() == ["10001"] * 4
    assert int(status["CapEff"], 16) == 0 and status["NoNewPrivs"].strip() == "1" and status["Seccomp"].strip() == "2"
    mounts = run("docker", "exec", name, "cat", "/proc/1/mountinfo").splitlines()
    tmp = next(line for line in mounts if line.split()[4] == "/tmp")
    assert all(flag in tmp.split()[5].split(",") for flag in ["rw", "noexec", "nosuid", "nodev"])
    assert "size=65536k" in tmp
    run("docker", "exec", name, "sh", "-c",
        "test ! -w /app/app.jar && test ! -w /etc/passwd && touch /tmp/probe && rm /tmp/probe")
    assert not c["State"]["OOMKilled"]
    events = run("docker", "exec", name, "cat", "/sys/fs/cgroup/memory.events")
    assert all(int(line.split()[1]) == 0 for line in events.splitlines()
               if line.split()[0] in ["oom", "oom_kill", "max"])
    pids = run("docker", "exec", name, "cat", "/sys/fs/cgroup/pids.events")
    assert all(int(line.split()[1]) == 0 for line in pids.splitlines())
    return {"uid": 10001, "cap_eff": 0, "no_new_privileges": True,
            "seccomp": 2, "read_only": True, "memory_events": events, "pids_events": pids}


def fixture_ca(root):
    for label in ["trusted", "untrusted"]:
        run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
            "-subj", "/CN=demo-image-" + label, "-keyout", str(root / (label + ".key")),
            "-out", str(root / (label + ".pem")))
    run("keytool", "-importcert", "-noprompt", "-alias", "demo-fixture", "-storetype", "JKS",
        "-keystore", str(root / "cacerts"), "-storepass", "changeit", "-file", str(root / "trusted.pem"))
    (root / "empty-ca-dir").mkdir()
    # Only certificates and the fixture trust store are mounted, never private keys.
    public = root / "public"
    public.mkdir(mode=0o755)
    for name in ["trusted.pem", "untrusted.pem", "cacerts"]:
        (public / name).write_bytes((root / name).read_bytes())
        (public / name).chmod(0o644)
    (public / "empty-ca-dir").mkdir()
    return public


def verify(image, demo, manifest_path, report):
    manifest = json.loads(manifest_path.read_text())
    assert manifest["demo"] == demo
    name = "knife4j-image-check-" + uuid.uuid4().hex[:12]
    port = manifest["port"]
    report.parent.mkdir(parents=True, exist_ok=True)
    created = False
    with tempfile.TemporaryDirectory(prefix="knife4j-image-ca-") as directory:
        root = pathlib.Path(directory)
        public = fixture_ca(root)
        try:
            run("docker", "create", "--platform", "linux/amd64", "--name", name,
                "--label", "com.centurylinklabs.watchtower.enable=false",
                "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                "--memory", "768m", "--memory-swap", "768m", "--cpus", "1", "--pids-limit", "384",
                "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777",
                "-e", "JAVA_TOOL_OPTIONS=-Xms64m -Xmx384m",
                "-e", "SSL_CERT_FILE=/opt/ca-remediation/trusted.pem",
                "-e", "SSL_CERT_DIR=/opt/ca-remediation/empty-ca-dir",
                "--mount", "type=bind,src=" + str(public) + ",dst=/opt/ca-remediation,readonly",
                "--mount", "type=bind,src=" + str(public / "trusted.pem") + ",dst=/etc/ssl/certs/ca-certificates.crt,readonly",
                "--mount", "type=bind,src=" + str(public / "cacerts") + ",dst=/opt/java/openjdk/lib/security/cacerts,readonly",
                "-p", "127.0.0.1::" + str(port), image)
            created = True
            run("docker", "start", name)
            c = inspect(name)
            base = ready(name, port)
            actual_sha = run("docker", "exec", name, "sha256sum", "/app/app.jar").split()[0]
            assert actual_sha == manifest["jar_sha256"]
            assert c["Config"]["Labels"]["org.opencontainers.image.revision"] == manifest["revision"]
            for label, expected in [("trusted", "true"), ("untrusted", "false")]:
                run("docker", "exec", name, "java", "-Xms8m", "-Xmx32m", "-cp", "/opt/demo-probe",
                    "DemoProbe", "trust", "/opt/ca-remediation/" + label + ".pem", expected)
            smoke.check(base, demo)
            result = runtime(name)
            run("docker", "restart", name)
            base = ready(name, port)
            smoke.check(base, demo)
            runtime(name)
            built_image = json.loads(run("docker", "image", "inspect", image))[0]
            result.update(image_id=inspect(name)["Image"], image_fingerprint=fingerprint(built_image), jar_sha256=actual_sha,
                          revision=manifest["revision"], ca_mount_positive_negative=True,
                          restart_smoke=True, demo=demo)
            report.write_text(json.dumps(result, indent=2) + "\n")
            print("PASS Demo", demo, "image, security floor, function, restrictions, CA mounts, restart")
        except Exception:
            if created:
                (report.parent / ("demo-" + str(demo) + "-failure.log")).write_text(run("docker", "logs", name))
            raise
        finally:
            if created:
                run("docker", "rm", "-f", name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("demo", type=int, choices=[2, 3])
    parser.add_argument("image")
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--report", type=pathlib.Path, required=True)
    args = parser.parse_args()
    verify(args.image, args.demo, args.manifest, args.report)
