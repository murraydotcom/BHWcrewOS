# Patient Registry secure workspace handoff

## Outcome

Patient Registry is the authoritative patient-selection front door for real-patient provider workspaces in CrewHQ.

From an active Patient Registry record, staff may request a destination-specific launch for:

1. BHW Patient 360
2. Body-System Atlas
3. Patient Operations / Patient Worklist

Patient 360 is the selected-patient longitudinal workspace inside Provider 360. Health Core Clinical Access remains the current-encounter documentation workflow and the canonical clinical record. Real-patient cross-domain launch to Health Core remains unavailable until Health Core accepts and validates the same governed context. BHW0000 remains the separate synthetic preview path.

## Security contract

The launch flow creates a random 256-bit opaque token. The token contains no patient identifier or PHI.

The Operations API stores only the SHA-256 token digest and a protected HMAC patient reference alongside the server-side context record. The raw token is returned once to the authenticated Registry browser and expires after 120 seconds.

The context is bound to:

- exact BHW Patient Registry patient;
- active patient status;
- exact authenticated CrewOS staff identity;
- staff role;
- treatment purpose;
- Patient Registry as source application;
- requested initial destination;
- explicit read-only patient-workspace scopes;
- issue and expiration timestamps; and
- single-use consumption state.

Redemption must occur under the same authenticated staff identity and exact initial destination. Firestore transactionally marks the token consumed and writes an audit event. A reused, expired, revoked, missing, wrong-destination, or wrong-staff token fails closed.

After successful redemption, CrewHQ retains a 15-minute tab-scoped context in `sessionStorage`. The one-time token and visible patient query parameter are removed from the address immediately. The tab grant selects the patient only; it does not expand any downstream API permission.

## Application responsibilities

### Provider 360

- is the provider environment and home;
- provides access to Patient Registry, Health Core Clinical Access, Patient 360, program lenses, and operational work; and
- does not become a second canonical chart.

### Patient Registry

- verifies the active patient master record;
- records assigned BHW provider and enrolled programs;
- creates the treatment-purpose launch;
- presents Patient 360, program-lens, and operational workspace choices; and
- remains the route back when context expires.

### Patient 360

- provides PSCM longitudinal synthesis and the connected body-system, timeline, mechanism, context, reserve, and feasible-plan views;
- presents All Care and the appropriate program lenses: Primary Care, Flow, Mind & Mood Recovery, CharmEd Minds, and chronic care;
- reads the patient already selected in Patient Registry; and
- does not become a second canonical chart or a current-encounter note editor.

The technical destination key `clinical-map`, scope `clinical-map.read`, and `patient-360*.html` routes remain compatibility identifiers. Their user-facing label is Patient 360.

### Body-System Atlas

- uses the same tab context as Patient 360;
- retains its existing draft and provider-approval workflow; and
- does not accept a visible real BHW Patient ID as authorization.

### Patient Operations

- displays patient-specific requests, assignment, priority, waiting state, due review, follow-through, and closure;
- opens the exact Patient Requests record by request ID; and
- does not independently create diagnoses, sign notes, modify medications, authorize orders, approve interpretations, or change the canonical care plan.

### Health Core

- provides Clinical Access for the current visit and current-day documentation;
- remains canonical for encounters, signed notes, problems, medications, allergies, results, orders, justifications, interpretations, care plans, versions, and approvals;
- remains linked for BHW0000 synthetic review; and
- requires a separate cross-domain acceptance release before real-patient Clinical Access launch is enabled.

### Care Connect

- receives only provider-approved, patient-safe information intended for the patient; and
- does not expose provider-only synthesis, drafts, or operational worklists.

## Activation gate

The Operations API exposes status while issuance and redemption remain disabled unless both are present:

```text
PATIENT_WORKSPACE_CONTEXT_ENABLED=true
PATIENT_WORKSPACE_CONTEXT_SECRET=<dedicated random secret of at least 32 bytes>
```

Merging the code does not activate the real-patient handoff. Activation requires:

1. current Operations API source deployed;
2. dedicated context secret retained in Google Secret Manager;
3. exact environment flag enabled on the Operations API revision;
4. Patient Registry and CrewHQ origin retained in the Operations API allowlist;
5. provider UAT with a permitted nonproduction or explicitly authorized pilot record;
6. token expiry, replay, wrong-user, wrong-destination, and expired-tab tests;
7. audit review; and
8. separate clinical-owner approval.

## Deliberate boundaries

This release does not:

- put a real patient ID or PHI in the cross-application URL;
- authorize Health Core real-patient Clinical Access launch;
- connect Nutrition Intelligence to the new token flow;
- create a clinical write, signature, order, referral, message, billing event, or patient delivery;
- replace downstream role checks, Patient Registry authorization, MFA, or existing application audit controls; or
- enable the handoff merely by merging the pull request.
