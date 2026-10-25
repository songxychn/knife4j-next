"""Promote only this master SHA after its Build workflow and both image gates pass."""
import json
import os
import pathlib
import re
import subprocess
import time
from identity import fingerprint


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT, timeout=600).strip()


def api(path):
    return json.loads(run("gh", "api", path))


def require_source(repo, sha):
    if api("repos/" + repo + "/commits/master")["sha"] != sha:
        raise RuntimeError("Master moved; refusing stale promotion")


def successful_build(runs, sha):
    candidates = [r for r in runs if r["head_sha"] == sha and r["event"] == "push"
                  and r["head_branch"] == "master"]
    # Latest attempt/run wins: an earlier green rerun must not mask a newer failure.
    if not candidates:
        return False
    latest = max(candidates, key=lambda r: (r["id"], r.get("run_attempt", 1)))
    if latest["status"] != "completed":
        return False
    if latest["conclusion"] != "success":
        raise RuntimeError("Current source Build did not pass")
    return True


def publish():
    repo, sha = os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_SHA"]
    assert repo == "songxychn/knife4j-next"
    assert os.environ["GITHUB_REF"] == "refs/heads/master"
    assert os.environ["GITHUB_EVENT_NAME"] in ["push", "workflow_dispatch"]
    assert re.fullmatch(r"[0-9a-f]{40}", sha)
    deadline = time.monotonic() + 2400
    while True:
        require_source(repo, sha)
        runs = api("repos/" + repo + "/actions/workflows/build.yml/runs?event=push&head_sha=" + sha)["workflow_runs"]
        if successful_build(runs, sha):
            break
        if time.monotonic() >= deadline:
            raise RuntimeError("Timed out waiting for current-source Build")
        time.sleep(20)
    root = pathlib.Path("build/demo-images")
    # Check both candidates before making any registry write.
    for demo in [2, 3]:
        manifest = json.loads((root / f"demo-{demo}-manifest.json").read_text())
        result = json.loads((root / f"demo-{demo}-result.json").read_text())
        assert manifest["revision"] == result["revision"] == sha
        assert manifest["jar_sha256"] == result["jar_sha256"]
        assert result["demo"] == demo and result["restart_smoke"] and result["ca_mount_positive_negative"]
        run("docker", "load", "--input", str(root / f"demo-{demo}.tar"))
        actual = json.loads(run("docker", "image", "inspect", f"local/knife4j-demo-candidate:{demo}"))[0]
        assert fingerprint(actual) == result["image_fingerprint"]
        assert actual["Config"]["Labels"]["org.opencontainers.image.revision"] == sha
    require_source(repo, sha)
    run_id, attempt = os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"]
    assert run_id.isdigit() and attempt.isdigit()
    images = []
    for demo in [2, 3]:
        image = f"ghcr.io/{repo}/knife4j-next-demo-openapi{demo}"
        tag = image + f":sha-{sha}-run-{run_id}-{attempt}"
        # Never overwrite an existing build tag, including an accidentally repeated publish step.
        probe = subprocess.run(["docker", "manifest", "inspect", tag], capture_output=True, timeout=60)
        if probe.returncode == 0:
            raise RuntimeError("Build tag already exists: " + tag)
        error = probe.stderr.decode(errors="replace").lower()
        if not any(message in error for message in ["manifest unknown", "no such manifest", "not found"]):
            raise RuntimeError("Cannot establish that build tag is absent")
        run("docker", "tag", f"local/knife4j-demo-candidate:{demo}", tag)
        run("docker", "push", tag)
        inspected = json.loads(run("docker", "image", "inspect", tag))[0]
        digest = next(ref for ref in inspected["RepoDigests"] if ref.startswith(image + "@"))
        images.append({"demo": demo, "tag": tag, "digest": digest, "channel": image + ":demo"})
    require_source(repo, sha)
    for image in images:
        # Local tag points at the same validated image config/layers; no rebuild after acceptance.
        run("docker", "tag", image["tag"], image["channel"])
        run("docker", "push", image["channel"])
        live = run("docker", "buildx", "imagetools", "inspect", image["channel"], "--format", "{{.Manifest.Digest}}")
        assert live == image["digest"].split("@", 1)[1]
    (root / "published.json").write_text(json.dumps({"revision": sha, "images": images}, indent=2) + "\n")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write("### Demo 镜像发布\n\n源码：`" + sha + "`；独立于 Maven/Release latest。\n\n")
        for image in images:
            summary.write("- `" + image["tag"] + "` → `" + image["digest"] + "`\n")


if __name__ == "__main__":
    publish()
