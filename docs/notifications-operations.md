# Notification operations

The in-app inbox requires DynamoDB. Browser and mobile push are optional delivery channels; they do not replace the inbox.

## Production storage

Set these variables on the **backend Vercel project** for the production environment, then redeploy:

- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`: credentials with read/write access to the application tables.
- `DYNAMO_DB_USERS`: the existing users table.
- `DYNAMO_DB_POLICIES`: the policies table (the application example uses `fcs_credit_policies`).
- `DYNAMO_DB_NOTIFICATIONS`: the notifications table (the application example uses `fcs_notifications`).

The notification table must have a string `_id` partition key. `npm run db:provision:application` checks the configured tables without changing them. Run `npm run db:provision:application -- --apply` only after confirming the AWS account, region, and target table names. Never put AWS credentials in the frontend.

Check `GET /api/health` after deployment. A 503 means the backend cannot read one of the required tables. Server logs now identify the failing alias (`users`, `policies`, or `notifications`) without revealing the table name in the public response. Inbox API failures return `code: STORAGE_UNAVAILABLE`; the website shows a retry state.

## Push delivery

Set `FIREBASE_SERVICE_ACCOUNT` on the backend (JSON or base64 encoded JSON) and `FRONTEND_URL` to the HTTPS website origin. On the frontend, configure the matching `NEXT_PUBLIC_FIREBASE_*` values and `NEXT_PUBLIC_FIREBASE_VAPID_KEY`, then rebuild. Firebase Web Messaging requires a secure context. The public Firebase web keys are distinct from the private backend service account.

Users opt in from Notifications or My Account. The browser permission prompt is shown only after clicking Enable. The web client sends its FCM token to `PUT /api/v1/notifications/device-token` with `platform: "web"`; native apps use `android` or `ios`. `DELETE /api/v1/notifications/device-token` removes the current device token before logout. Registration is idempotent, and one account can have up to ten devices. A legacy `fcmToken` continues to receive notifications during mobile migration.

Optional legacy Web Push subscriptions use `/notifications/subscribe` and `DYNAMO_DB_SUBSCRIPTIONS` with VAPID keys. A missing legacy subscription table no longer prevents the in-app record, Firebase delivery, or email.
