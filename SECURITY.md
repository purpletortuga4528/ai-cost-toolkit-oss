# Security policy

## Reporting a vulnerability
Use GitHub's private vulnerability reporting for this repository (the repository's security
tab, then "Report a vulnerability"). Issues are turned off, and please do not describe a
security problem in a pull request or any other public place. Reports are handled on a
best-effort basis.

## Supported versions
Only the latest release is supported. A fix ships in a new release.

## Scope
In scope: a flaw that lets a crafted usage export or price table cause anything beyond
reading that file and printing a report, such as running code or touching other files; and
any secret or personal data found in the repository.

Out of scope: a wrong, missing, or out-of-date price (send a pull request, see
CONTRIBUTING.md); a report that differs from an invoice (the tool estimates, and says so);
and problems in Python itself or in tools you run alongside this one. The app makes no
network calls and has no third-party dependencies.
