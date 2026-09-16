# Security policy

Please report suspected vulnerabilities privately. Use GitHub's private vulnerability reporting form for this repository:

[Report a vulnerability privately](https://github.com/luomo66ccff/Amahane-Hikari-Live2D/security/advisories/new)

If GitHub's reporting form is unavailable, wait until it becomes available before sending vulnerability details. Do not put exploit steps, sensitive files, credentials or unpatched details in a public issue, discussion or pull request.

## What to include

Provide enough information to reproduce the behavior safely:

- the affected path, release or commit;
- the smallest reproduction and expected versus actual behavior;
- operating system, Node.js version, browser and SDK version when relevant;
- impact and any conditions needed to trigger it;
- sanitized logs, traces or screenshots.

Remove cookies, access tokens, private URLs, local secrets and unlicensed SDK or model material before sending a report. If a large attachment is necessary, describe it in the private report instead of placing it in a public repository.

## Scope notes

The repository currently contains a client-side Vite/TypeScript viewer, local build scripts, public model files and a reusable production Skill. The hosted interactive demo is a separate deployment of the viewer. A problem that exists only in the hosting configuration may need to be reported to that deployment's operator as well.

Live2D Cubism Core, Framework, shaders and type declarations are obtained separately under Live2D's terms. Do not upload SDK files in a report. If the defect is in the upstream SDK itself, use Live2D's official support or reporting channel while sharing only the information permitted by its terms.

Model-license or provenance questions are not automatically security vulnerabilities. Follow the model license and contact the maintainer privately when sharing restricted material; never publish a suspected license violation together with private source files.

## Disclosure

Please allow maintainers to investigate and prepare a fix before publishing details. We will coordinate any public advisory or credit in the private report. This project does not promise a response or remediation time; the absence of a stated timeline is not a reason to disclose an unpatched issue publicly.

For ordinary bugs, unsafe defaults that do not expose sensitive data, or feature requests, use the public issue templates. Do not use a public issue to test whether private reporting is enabled.
