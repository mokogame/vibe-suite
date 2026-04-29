# API Versioning Policy

Vibe Claw exposes versioned public APIs under `/v1`.

- Additive fields and endpoints may be introduced within the same major version.
- Breaking changes require a new major path such as `/v2`.
- Deprecated fields remain available for at least 90 days after documentation in `CHANGELOG.md`.
- Clients should ignore unknown response fields and rely on documented required fields.
- `/v1/version` exposes the active API version, compatibility statement and deprecation policy.
