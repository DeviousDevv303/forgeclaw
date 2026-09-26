
## Sovereignty and ownership constraint

ForgeClaw is a sovereign project. The implementation must not introduce proprietary Manus code, Manus-only runtime services, hidden licensing gates, vendor lock-in, artificial capability blockades, or requirements to route ordinary project execution through an external Manus system.

The shared runtime proposed here must be ordinary project-owned TypeScript running through ForgeClaw's existing provider, tool, Guardian, persistence and GitHub interfaces. Its interfaces, state schema, capability rules and verification behavior must remain inspectable, testable and replaceable by the project owner.

“MANUS” may appear only as an optional work-trace or commit-attribution label when the operator requests it; it is not an execution dependency, authority boundary, ownership claim or access requirement. ForgeClaw's own identity, owner, repository, tools and policies remain authoritative.

Additional acceptance gates:

- A clean checkout must build and run without proprietary Manus packages or hidden Manus credentials.
- Removing any optional MANUS attribution text must not disable tools, persistence, provider routing, Guardian decisions or repository operations.
- No agent may be blocked from a project-owned capability solely because it is not using a Manus service.
- All safety controls must be explicit project code and operator-visible, not opaque vendor restrictions.
