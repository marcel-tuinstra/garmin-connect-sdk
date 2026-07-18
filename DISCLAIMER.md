# Disclaimer

This project is an unofficial SDK for a user's own Garmin Connect data. It is not affiliated with,
endorsed by, sponsored by, or supported by Garmin.

Garmin does not publish or support the private Garmin Connect endpoints used by this package.
Garmin may change, rate limit, block, or remove those endpoints without notice. Garmin may also take
account-level action when it detects use it does not allow.

This package does not grant permission to access Garmin systems, bypass Garmin controls, avoid
Garmin's terms, or access data you are not authorized to use. You are responsible for reviewing and
following Garmin's terms, Garmin's developer rules where they apply, and any laws or policies that
apply to your use.

Use official Garmin APIs for supported production integrations. Use this package only when you
accept the risk of private endpoint drift, account restrictions, data exposure, and broken
compatibility.

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
