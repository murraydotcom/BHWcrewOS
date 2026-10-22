# Returned result review and follow-up metadata

`bhw-visit-handoffs.html` links from Patient Messages and lists BHW0000 returned-result receipt, provider-review status, owner, due date, and completion. Staff can filter needs-review, unassigned, open, overdue, and completed work, assign a dated follow-up, and complete it after provider review. Open Health Core Results & Follow-up to read clinical values and record provider interpretation.

The bridge accepts only assignment/completion metadata, reuses the verified CrewOS session, and signs a purpose-scoped 60-second `visit-handoff-metadata` token. Health Core active grants govern authority; this token cannot open the clinical chart or receive/review a clinical result. CrewHQ rebuilds each response from a field allowlist, keeping analytes, values, report titles, private interpretations, explanations, and completion notes out of operations. The same Health Core clinical workspace stores the task state; no parallel operations clinical store is added.

The server gate `SYNTHETIC_VISIT_HANDOFFS_ENABLED` defaults off. This code hard-denies real-patient requests, and no live flags are changed. All saves require a command receipt and expected revision; uncertain writes retain the same command for retry. Session failure clears the displayed inbox.

Depends on the matching Health Core visit handoff change and existing messaging PRs Health Core #134, Care Connect #29, and CrewOS #208. The complete three-handler synthetic journey passes 21 checkpoints, including the staff metadata view and assignment/closure. Local tests also cover stripped clinical response fields, blocked clinical commands and fields, authenticated purpose tokens, permission/conflict handling, uncertain save receipts, and existing portal-message/staff-chat behavior.

No merge, deployment, real patient, prescribing, external notification, primary database write, or CharmHealth write occurs. Commit and PR title include `[skip netlify]` to suppress branch deploys and Deploy Previews. Private browser/IAP and live isolated database/IAM/restore acceptance remain pending; see Health Core `docs/synthetic-visit-handoffs.md` for reproduction and boundaries.
