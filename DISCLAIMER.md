# Disclaimer

This project is an unofficial SDK for a user's own Garmin Connect data. It is not affiliated with,
endorsed by, sponsored by, or supported by Garmin.

Starting with version `1.1.0`, the SDK uses the
[PolyForm Noncommercial License 1.0.0](./LICENSE). You must comply with its permitted
purposes and other conditions. See the [license summary](./README.md#license), including
the unchanged rights for previously published releases through `1.0.0`.

Garmin does not publish or support the private Garmin Connect endpoints used by this package.
Garmin may change, rate limit, block, or remove those endpoints without notice. Garmin may also take
account-level action when it detects use it does not allow.

This package does not grant permission to access Garmin systems, bypass Garmin controls, avoid
Garmin's terms, or access data you are not authorized to use. You are responsible for reviewing and
following Garmin's terms, Garmin's developer rules where they apply, and any laws or policies that
apply to your use.

Use official Garmin APIs for supported production integrations. Accepting the risk of private
endpoint drift, account restrictions, data exposure, and broken compatibility does not replace
the need to comply with the SDK license or obtain any required permission from Garmin.

Tokens, activity data, health data, location data, device data, workout data, and calendar data can
be sensitive. Protect token files like passwords. Do not publish raw Garmin payloads from live
accounts.

Workout creation and calendar scheduling mutate the Garmin account. There is no dry-run mode or
transaction rollback. Failed cleanup can leave workouts or schedules in the account and may sync
them to Garmin devices.

Manual weigh-in creation mutates health data and has no idempotency guarantee. Removal permanently
deletes the selected record. Verify uncertain POST or DELETE outcomes through a read before taking
more action.

This document is not legal advice.
