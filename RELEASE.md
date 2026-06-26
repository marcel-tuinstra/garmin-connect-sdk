# Release Process

This is a maintainer-only process. Contributor PRs must not publish npm packages, create tags, or
create GitHub releases.

## 1.0.0-rc.1 Readiness

The release candidate should freeze the read-only SDK surface and keep workout/calendar writes
explicitly experimental.

- `garmin-connect-sdk@alpha` is installed and exercised by at least one downstream application.
- `main` is clean, synced with `origin/main`, and CI is green.
- CI passes on Node 24, including 70%+ runtime SDK coverage and package smoke verification from a
  packed tarball.
- Read-only smoke passes with a persisted session: profile, devices, activities, sleep, and body
  battery. Activity details are checked by the manual CLI command below.
- Optional live integration passes with `GARMIN_RUN_INTEGRATION=1`.
- Optional destructive workout integration passes only when intentionally run with
  `GARMIN_RUN_WORKOUT_WRITE=1`.
- README documents release-candidate read APIs, experimental write APIs, privacy expectations, and
  rate-limit behavior.
- Changelog has a `1.0.0-rc.1` entry before tagging.
- The maintainer has npm publish access, npm 2FA, and GitHub release access.

## Local Verification

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm coverage
pnpm build
pnpm package:smoke
```

With a persisted local Garmin session:

```bash
pnpm smoke
pnpm garmin -- activities --limit 10
pnpm garmin -- activity --id <activityId> --details
```

## Publishing An RC

Prepare release-specific notes from the current changelog entry. Do not use the full changelog file
as GitHub release notes.

```bash
pnpm version 1.0.0-rc.1 --no-git-tag-version
pnpm build
pnpm package:smoke
git add package.json pnpm-lock.yaml CHANGELOG.md README.md RELEASE.md
git commit -m "Prepare 1.0.0-rc.1"
git tag -a v1.0.0-rc.1 -m "v1.0.0-rc.1"
git push origin main v1.0.0-rc.1
gh release create v1.0.0-rc.1 --target main --title v1.0.0-rc.1 --prerelease --notes-file /tmp/garmin-connect-sdk-release-notes.md
pnpm publish --tag rc --access public --otp <NPM_2FA_CODE>
```

After publishing:

```bash
npm view garmin-connect-sdk@rc version
npm view garmin-connect-sdk@rc dist-tags
npm exec --package garmin-connect-sdk@rc -- garmin-connect help
```

If publish fails after a tag or GitHub release exists, do not amend commits or force-push. Fix with a
new commit, a new version, or a normal follow-up tag after deciding the recovery path.
