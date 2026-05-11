# Release

This fork publishes Maven artifacts from GitHub Actions to Maven Central by using the Central Portal publishing plugin.

## One-time setup

1. Register and verify the `com.baizhukui` namespace in Sonatype Central Portal.
2. Generate a Central Portal user token.
3. Create a GPG key pair for artifact signing.
4. Add these GitHub repository secrets:

- `CENTRAL_USERNAME`
- `CENTRAL_PASSWORD`
- `GPG_PRIVATE_KEY`
- `GPG_PASSPHRASE`

## CI workflows

- `.github/workflows/build.yml` runs `mvn verify` for pull requests and pushes to `main`.
- `.github/workflows/release.yml` publishes when a tag matching `v*` is pushed.

## Release flow

1. Make sure the version in `knife4j/pom.xml` is correct.
2. Commit and push the release changes.
3. Create and push a tag such as `v5.0.2`.
4. Wait for the GitHub Actions `Release` workflow to finish publishing.
