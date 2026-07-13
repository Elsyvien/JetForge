# Security Policy

## Supported version

Security fixes are delivered on the latest JetForge version published to the Visual Studio Marketplace. Upgrade to the current release before reporting a problem.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or a draft security advisory for `Elsyvien/JetForge`. Do not open a public issue for command injection, workspace escape, symlink containment, unsafe file writes, or unintended template disclosure.

Include a minimal sanitized reproduction, affected version, operating system, Workspace Trust state, and expected containment boundary. Do not include proprietary templates, credentials, access tokens, or customer-generated output.

JetForge has no built-in runtime network client or telemetry. External compilers and validators run only when configured by the user and are disabled in Restricted Mode; reports involving those boundaries are still treated as security issues.
