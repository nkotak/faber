# Mode: tracker — Applications Tracker

Read and display `data/applications.md`.

**Tracker format:**
```markdown
| # | Date | Company | Role | Score | Status | PDF | Report |
```

Canonical statuses (from `templates/states.yml`): `Evaluated` → `Applied` → `Responded` → `Interview` → `Offer` / `Rejected` / `Discarded` / `SKIP`

- `Applied` = the candidate submitted their application
- `Responded` = a recruiter/company reached out and the candidate replied (inbound)
- `Contact` = the candidate reached out proactively to someone at the company (outbound, e.g., LinkedIn power move — tracked via notes, not a separate status)

If the user asks to update a status, edit the corresponding row directly in `data/applications.md`.

Also show statistics:
- Total applications
- Count by status
- Average score
- % with PDF generated
- % with report generated
