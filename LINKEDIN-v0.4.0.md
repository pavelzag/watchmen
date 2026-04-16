# LinkedIn blurb — Watchmen v0.4.0

I just marked Watchmen v0.4.0.

Watchmen is a cloud security dashboard for AWS and GCP: scanning, findings, compliance, attack path analysis, task history, and live request tracing in one place.

This release focused on making it feel much more like a real multi-cloud operator console.

What changed since v0.3.0:

- Added AWS/GCP filters across Findings, Attack Path Analysis, and Compliance.
- Compliance now recalculates score, counts, CSV export, and project breakdown based on the selected cloud.
- Findings can now show AWS and GCP issues together or filter down to one provider.
- Attack Path Analysis can now separate GCP attack paths from AWS high/critical exposure findings.
- Added richer AWS and GCP sync logs so scans explain what they are doing instead of looking stuck.
- Added clearer no-credentials states with links back to Settings.
- Fixed repeated scan loops and improved manual sync behavior.
- Added task cleanup tools, stale task handling, and task list pruning.
- Added global keyboard shortcuts for fast dashboard navigation: G, A, T, R, F, P, D, C, H, S, plus ? for help.
- Added a centered shortcut confirmation badge so navigation feels immediate.
- Hardened Google auth refresh handling and cleaned up expired-session redirects.
- Fixed GCP API error parsing for numeric error codes and added a regression test.
- Fixed duplicate Compliance category IDs when AWS and GCP reports are merged.

This was mostly reliability and UX work, but it changes how the product feels: less guessing, fewer silent states, more direct navigation, and better multi-cloud context.

Next up: deeper AWS-native attack path generation and more provider-aware remediation flows.
