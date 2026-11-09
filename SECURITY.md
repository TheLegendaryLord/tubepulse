# Security

For suspected vulnerabilities, prefer [private vulnerability reporting](https://github.com/TheLegendaryLord/tubepulse/security/advisories/new) when enabled. Otherwise, contact the repository owner through GitHub without posting exploit details publicly. Include a minimal reproduction, the affected version and the component involved. Keep tokens, private videos, Discord user data and machine identifiers out of the report.

The companion trusts the exact enrolled Chrome extension origin. It accepts a bounded, versioned message schema over stdio and opens no TCP or HTTP listener. The Windows installer uses per-user directories and registry registration. The Discord Application ID identifies the registered app and does not give TubePulse access to your account or API credentials.

TubePulse stores settings locally. It has no analytics or telemetry. When enabled, it passes only the selected presence fields to Discord. Discord may fetch a thumbnail from YouTube's image CDN when thumbnail sharing is enabled.
