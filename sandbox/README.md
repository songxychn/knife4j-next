# knife4j-sandbox

Docker image for knife4j backend build environment.

Base: `nikolaik/python-nodejs:python3.12-nodejs22`
Includes: OpenJDK 17, Maven, Node.js 22, gh CLI, git

> Note: The `.java-version` file in the repo root contains `22` (for frontend tooling).
> This sandbox image intentionally uses JDK 17 for Java backend builds — this is a deliberate maintainer decision, not a version conflict.

## Build

```bash
docker build -t knife4j-sandbox -f sandbox/Dockerfile sandbox/
```

## Verify

```bash
docker run --rm knife4j-sandbox bash -lc "java -version && mvn -v && node -v && gh --version"
```
