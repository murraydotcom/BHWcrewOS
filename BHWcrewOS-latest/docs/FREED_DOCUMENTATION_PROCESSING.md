# Freed note processing repair

The primary **Process Freed note: draft + audit** action organizes reviewed
source material, generates the draft, saves it, and runs the complete clinical
audit. Required Changes opens first. Coding recommendations returned by the
audit feed the coding review panel, with exact current-note evidence required
before a recommendation can be applied. Conditional suggestions stay review-only.

An empty or incomplete audit response cannot be reported as a clean review.
Failures remain visible in Required Changes and provider approval remains blocked.
Source text and note-builder inputs use the protected autosave path, including
source-only packets. Replacing source removes the previous source-review check.

Validation: focused generation, report parsing, coding-evidence, provider-review,
session exchange, and navigation tests. Live synthetic verification is a separate
release step; no test result establishes clinical accuracy or billing readiness.
