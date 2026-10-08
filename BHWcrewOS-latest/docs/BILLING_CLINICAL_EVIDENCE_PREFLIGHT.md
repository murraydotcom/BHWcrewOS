# Billing clinical-evidence preflight

CrewOS can now validate the narrative-free `bhw.health-core.billing-clinical-evidence.v1` projection before a future controlled RCM workflow uses it. This is a synthetic `BHW0000` contract milestone, not billing activation.

The verifier binds the exact Health Core encounter, signed-note ID and version, clinical-record hashes, provider signature metadata, and addendum list. It independently recomputes the evidence hash and rejects patient-identity drift, narrative fields, unsigned notes, claimable payloads, malformed addenda, or any evidence that relaxes the no-billing boundary.

The optional pre-release review records whether a human checked the Health Core readback, date of service, signing provider, addenda, program/coding rules, and payer/coverage evidence. Completing every check still produces `human-review-complete-nonclaimable`.

This module cannot create a superbill draft, invoice, claim, 837 transaction, clearinghouse transmission, payer submission, or patient charge. It has no network or persistence path. Connecting it to the protected RCM service requires a separately reviewed endpoint, synthetic acceptance, billing-owner approval, security/privacy review, and explicit production activation.
