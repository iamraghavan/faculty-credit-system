# CreditWise communication templates

Ready-to-review copy for E.G.S. Pillay Group of Institutions. These are content drafts, not active delivery code. The existing email and WhatsApp call sites use a mixture of inline messages and older template names; connecting this catalog to those call sites is a separate implementation step.

Use the actual event status from the API. In particular, an **accepted negative-credit appeal** reverses that entry; a **rejected appeal** leaves it in effect. A newly issued negative credit can still be pending review, so its initial notice says _recorded_, not _finally deducted_.

## Shared fields and presentation

| Placeholder         | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `{{facultyName}}`   | Recipient's display name                                        |
| `{{reviewerName}}`  | Assigned administrator's display name, for review alerts        |
| `{{activityTitle}}` | Credit or remark title                                          |
| `{{creditId}}`      | Credit record reference                                         |
| `{{points}}`        | Positive number; the template describes award or negative entry |
| `{{academicYear}}`  | Academic year on the credit record                              |
| `{{decisionNote}}`  | Optional reviewer note, included in email only after review     |
| `{{otp}}`           | Six-digit one-time code, used only in authentication templates  |
| `{{portalUrl}}`     | A verified HTTPS URL on the CreditWise website                  |

Email header: **CreditWise · E.G.S. Pillay Group of Institutions**. Use a short preheader matching the first sentence. Email footer: **This is an automated message. For questions about a credit decision, open the record in CreditWise or contact your institution's administrator.** Use a clear **View in CreditWise** button for credit events. Send a plain-text alternative with the same facts. Escape every user-supplied value in HTML and generate links from the configured website origin.

Two branded HTML drafts are available in `email-templates/drafts/otp.html` and `email-templates/drafts/credit-event.html`. They are not wired to delivery. Replace placeholders with HTML-escaped text and a trusted portal URL before use.

For the OTP draft, set `{{purpose}}` to “complete your sign-in” or “enable email authentication”. For the credit draft, set `{{preheader}}`, `{{statusLabel}}`, `{{heading}}`, `{{summary}}`, and `{{pointsLabel}}` from the selected event copy above. Omit a detail row when that field does not apply.

Do not include passwords, MFA setup secrets, full appeal reasons, or private attachments in WhatsApp messages. Do not include an OTP in a link or reuse it for a different purpose. Send only after the corresponding database change succeeds.
Send WhatsApp updates only to the user's verified number when the user has enabled that channel.

## Email copy

### 1. Login verification code

**Subject:** Your CreditWise sign-in code

```text
Hello {{facultyName}},

Use this code to complete your CreditWise sign-in:

{{otp}}

The code expires in 5 minutes. If you did not try to sign in, ignore this email and review your account security.

CreditWise
E.G.S. Pillay Group of Institutions
```

### 2. Enable email authentication

**Subject:** Confirm email authentication for CreditWise

```text
Hello {{facultyName}},

Enter this code in CreditWise to enable email authentication:

{{otp}}

The code expires in 5 minutes. If you did not start this setup, ignore this email and review your account security.

CreditWise
E.G.S. Pillay Group of Institutions
```

### 3. Positive credit submitted for review

**Subject:** Credit submission received · {{activityTitle}}

```text
Hello {{facultyName}},

We received your credit submission. It is waiting for review.

Activity: {{activityTitle}}
Requested points: {{points}}
Academic year: {{academicYear}}
Reference: {{creditId}}

You can follow its status in CreditWise: {{portalUrl}}
```

### 4. Positive credit awarded directly

**Subject:** {{points}} credits awarded · {{activityTitle}}

```text
Hello {{facultyName}},

{{points}} positive credit points have been awarded to your record.

Activity: {{activityTitle}}
Academic year: {{academicYear}}
Reference: {{creditId}}

View the award in CreditWise: {{portalUrl}}
```

### 5. Submitted credit approved

**Subject:** Your credit submission was approved · {{activityTitle}}

```text
Hello {{facultyName}},

Your submission for {{activityTitle}} was approved for {{points}} credit points.

Academic year: {{academicYear}}
Reference: {{creditId}}

View the decision and your updated credit record: {{portalUrl}}
```

### 6. Submitted credit rejected

**Subject:** Decision on your credit submission · {{activityTitle}}

```text
Hello {{facultyName}},

Your submission for {{activityTitle}} was not approved.

Academic year: {{academicYear}}
Reference: {{creditId}}
Review note: {{decisionNote}}

Open the record for the decision details and any available next steps: {{portalUrl}}
```

If no review note exists, omit the entire “Review note” line; never send an empty placeholder.

### 7. Negative credit or official remark recorded

**Subject:** Notice of a credit entry · {{activityTitle}}

```text
Hello {{facultyName}},

A negative credit entry has been recorded on your faculty profile.

Entry: {{activityTitle}}
Points: {{points}}
Academic year: {{academicYear}}
Reference: {{creditId}}

Please review the record, supporting details, and any available appeal option in CreditWise: {{portalUrl}}
```

Use the existing official remark PDF only when it was generated for the same record. Do not promise that an appeal is available unless the API reports eligibility.

### 8. Appeal submitted

**Subject:** We received your appeal · {{activityTitle}}

```text
Hello {{facultyName}},

Your appeal for the negative credit entry {{activityTitle}} was received and is awaiting review.

Academic year: {{academicYear}}
Credit reference: {{creditId}}

You can check the appeal status in CreditWise: {{portalUrl}}
```

### 9. Appeal accepted

**Subject:** Your appeal was accepted · {{activityTitle}}

```text
Hello {{facultyName}},

Your appeal for {{activityTitle}} was accepted. The negative credit entry has been reversed.

Credit reference: {{creditId}}
Decision note: {{decisionNote}}

View the decision and your credit record in CreditWise: {{portalUrl}}
```

Omit the decision-note line when no note was saved.

### 10. Appeal rejected

**Subject:** Decision on your appeal · {{activityTitle}}

```text
Hello {{facultyName}},

Your appeal for {{activityTitle}} was rejected. The negative credit entry remains on your record.

Credit reference: {{creditId}}
Decision note: {{decisionNote}}

View the decision and any available next steps in CreditWise: {{portalUrl}}
```

Omit the decision-note line when no note was saved.

### 11. Appeal window reopened

**Subject:** Appeal option reopened · {{activityTitle}}

```text
Hello {{facultyName}},

The appeal option for {{activityTitle}} is available again.

Credit reference: {{creditId}}

Open CreditWise to review the current deadline and submit an appeal if you wish: {{portalUrl}}
```

Only send when the appeal window was actually reopened. The deadline must come from application settings; do not hardcode a number of days.

### 12. Administrator review alert

**Subject:** Appeal awaiting review · {{activityTitle}}

```text
Hello {{reviewerName}},

A faculty appeal is awaiting review.

Credit: {{activityTitle}}
Credit reference: {{creditId}}
Academic year: {{academicYear}}

Open the review queue in CreditWise: {{portalUrl}}
```

Send to the assigned administrator or role-approved reviewers only; avoid a broad recipient list.

## WhatsApp templates proposed for later API setup

The names below are **proposed** and are not registered with a WhatsApp provider. For utility messages, numbered fields are in the exact order shown. A static “Open CreditWise” website button may point to the verified portal origin; use a record-specific button only after its route and ownership checks are confirmed. Keep full decision notes inside the signed-in portal.

### Authentication: `fcs_account_otp_v2`

Use the provider's **authentication/OTP template** with a copy-code or one-tap button. Pass only the six-digit `{{otp}}` as the OTP parameter. The application's current WhatsApp number-verification code expires in **10 minutes**; email MFA codes expire in **5 minutes** and are sent by email. Do not submit the ordinary utility text below as an OTP template. Meta's [official template examples](https://www.postman.com/meta/whatsapp-business-platform/request/6vkv46u/create-authentication-template-w-otp-copy-code-button) show the dedicated OTP button flow.

### Credit updates: suggested utility copy

| Proposed name                     | Event                                    | WhatsApp body for provider review                                                                                                         | Ordered parameters              |
| --------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `fcs_credit_submitted_v2`         | Faculty submits a positive credit        | “CreditWise: Your submission for {{1}} ({{2}} points) was received and is pending review. Ref: {{3}}. Open CreditWise for status.”        | activityTitle, points, creditId |
| `fcs_credit_awarded_v2`           | Admin/OA directly awards positive credit | “CreditWise: {{1}} positive credit points were awarded for {{2}}. Ref: {{3}}. Open CreditWise to view your record.”                       | points, activityTitle, creditId |
| `fcs_credit_approved_v2`          | Submitted positive credit approved       | “CreditWise: Your submission for {{1}} was approved for {{2}} points. Ref: {{3}}. View the decision in CreditWise.”                       | activityTitle, points, creditId |
| `fcs_credit_rejected_v2`          | Submitted positive credit rejected       | “CreditWise: A decision is available for your submission {{1}}. Ref: {{2}}. Sign in to view the reason and next steps.”                   | activityTitle, creditId         |
| `fcs_negative_credit_recorded_v2` | Negative credit/remark recorded          | “CreditWise: A negative credit entry for {{1}} ({{2}} points) was recorded. Ref: {{3}}. Sign in to review details and any appeal option.” | activityTitle, points, creditId |
| `fcs_appeal_submitted_v2`         | Faculty submits appeal                   | “CreditWise: Your appeal for {{1}} was received. Ref: {{2}}. You can follow its status in CreditWise.”                                    | activityTitle, creditId         |
| `fcs_appeal_review_alert_v2`      | Assigned reviewer receives appeal        | “CreditWise: An appeal for {{1}} is awaiting your review. Ref: {{2}}. Open your review queue.”                                            | activityTitle, creditId         |
| `fcs_appeal_accepted_v2`          | Appeal accepted                          | “CreditWise: Your appeal for {{1}} was accepted. The negative credit was reversed. Ref: {{2}}. Sign in for details.”                      | activityTitle, creditId         |
| `fcs_appeal_rejected_v2`          | Appeal rejected                          | “CreditWise: Your appeal for {{1}} was rejected. The negative credit remains. Ref: {{2}}. Sign in for the decision.”                      | activityTitle, creditId         |
| `fcs_appeal_reopened_v2`          | Appeal window reopened                   | “CreditWise: The appeal option for {{1}} is available again. Ref: {{2}}. Sign in to check the deadline.”                                  | activityTitle, creditId         |

For example, the existing `sendWhatsAppMessage` adapter maps `textParams: [activityTitle, points, creditId]` to `text1`, `text2`, and `text3`. Its current code already references `egspgoi_faculty_credit_system_otp_verify`, `fcs_negative_credit_alert_v1`, and `fcs_appeal_submission_alert_v1`; those are legacy names and parameter orders. Register and verify the proposed templates with the chosen provider before changing those call sites. Provider-specific approval, category, language, and button rules should be checked when the WhatsApp API is connected.
