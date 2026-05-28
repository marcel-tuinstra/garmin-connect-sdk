# Release Process

## 1.0.0-rc.1 Readiness

The release candidate should freeze the read-only SDK surface and keep workout/calendar writes
explicitly experimental.

- `garmin-connect-sdk@alpha` is installed and exercised by at least one downstream application.
- CI passes on Node 24, including 70%+ runtime SDK coverage and package smoke verification from a
  packed tarball.
- Read-only smoke passes with a persisted session: profile, devices, activities, activity details,
  sleep, and body battery.
- Optional live integration passes with `GARMIN_RUN_INTEGRATION=1`.
- Optional destructive workout integration passes only when intentionally run with
  `GARMIN_RUN_WORKOUT_WRITE=1`.
- README documents stable-candidate read APIs, experimental write APIs, privacy expectations, and
  rate-limit behavior.
- Changelog has a `1.0.0-rc.1` entry before tagging.

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

```bash
pnpm version 1.0.0-rc.1 --no-git-tag-version
pnpm build
pnpm package:smoke
git add package.json pnpm-lock.yaml CHANGELOG.md README.md RELEASE.md
git commit -m "Prepare 1.0.0-rc.1"
git tag -a v1.0.0-rc.1 -m "v1.0.0-rc.1"
git push origin main v1.0.0-rc.1
gh release create v1.0.0-rc.1 --target main --title v1.0.0-rc.1 --prerelease --notes-file CHANGELOG.md
pnpm publish --tag rc --access public --otp <NPM_2FA_CODE>
```

After publishing:

```bash
npm view garmin-connect-sdk@rc version
```
