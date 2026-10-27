# Phone assistant: telephony-law read (first deliverable; NOT legal advice, NO CODE)

Status: **research brief for the owner and a qualified lawyer.** Written 2026-10-27 from web search results (secondary sources: law-firm alerts and vendor
help pages, listed at the end). Nothing here was checked against a statute or an FCC primary text, and no lawyer has reviewed it. The operator's sequencing is
kept: **inbound first**; outbound only later, per call class, and only after counsel has reviewed it.

## 1. What the sources say (with their limits)

**AI-generated voices on calls (outbound).** On 2024-02-08 the FCC unanimously ruled that AI-generated voices are "artificial" under the TCPA, so the existing
rules for artificial/prerecorded-voice calls apply: the called party's prior express consent is required unless an emergency or an exemption applies, and for calls
that carry an advertisement or telemarketing, prior express *written* consent (Kelley Drye's reading). Callers must identify themselves, and telemarketing calls need
an opt-out. It is a declaratory ruling: effective immediately, and state attorneys general can enforce it. The FCC's own release, by contrast, says it bars voice cloning in robocall scams. **Gap:** the August 2024 FCC proposal on AI-generated calls: whether it was finalized is unconfirmed.

**Revoking consent.** New FCC revocation rules took effect 2025-04-11: a caller must honor a revocation or do-not-call request within a reasonable time, at most 10 business days. **Gap:** sources conflict on the "lead generator" consent rules (one says an appeals court vacated parts); status unconfirmed.

**Recording a call (inbound or outbound).** Federal law is one-party consent; many states require all parties to consent. Lists differ: KTS Law counts 13 all-party states (California, Connecticut, Delaware, Florida,
Illinois, Maryland, Massachusetts, Montana, Nevada, New Hampshire, Oregon, Pennsylvania, Washington), Ringio counts 13 but swaps Oregon for Michigan, Kixie lists 11. The rule can depend on where each party is, so a caller from an all-party state to the owner is the hard case. Spoken notice before recording is the commonly used method.

## 2. What follows for design (proposals, not conclusions)
1. **Inbound only, first.** Answering, screening, transcribing, summarizing and drafting replies avoids the outbound-consent regime.
2. **Say it is an assistant, and say it is recording, at the start of every call,** before anything is stored. Whether disclosure of the AI itself is legally required in the owner's states is **not established here.**
3. **Default to the strictest rule:** treat every call as all-party-consent. Store no audio unless the caller has been told; consider transcripts only.
4. **Retention and privacy.** Calls hold third parties' personal data. Nothing from a call may enter this public repository, a workflow dispatch input, the `browser-results` branch, CORPUS candidates or any training set without a deliberate, reviewed path. The current GitHub-Actions-based tooling publishes to a public repo, so it is the wrong carrier for call content.
5. **Outbound is a separate project** with a consent ledger (who consented, when, how, scope), revocation within the 10-business-day limit (shorter in practice), call-class mandates, quiet hours, and counsel's sign-off first. No outbound dialing code before that.
6. **Minors, emergencies, financial and medical calls** need their own rules; none are drafted.

## 3. Not covered / unverified
Caller-ID authentication (STIR/SHAKEN) duties; do-not-call registry rules for the owner's use case; telecom-provider terms of service; state AI-disclosure statutes; wiretap-law differences for
transcription-only; accessibility; international callers; voicemail transcription; the actual cost and latency of speech-to-text, the model and text-to-speech over a telephony API. **Architecture:** real-time voice cannot run inside a GitHub Actions workflow; it needs a telephony provider webhook and a server, and the repository has no such server. A static Pages app plus a relay is what exists today.

## Sources (secondary; verify against primary texts)
- Akin Gump, FCC ruling on AI-generated voice robocalls: https://www.akingump.com/en/insights/ai-law-and-regulation-tracker/fcc-issues-declaratory-ruling-on-ai-generated-voice-robocalls
- Wiley, FCC extends TCPA to AI voices: https://www.wiley.law/alert-FCC-Extends-Regulatory-Reach-Over-AI-Announces-TCPA-Restrictions-Cover-AI-Generated-Voices-in-Outbound-Calls
- Kelley Drye, TCPA applies to AI-generated calls: https://www.kelleydrye.com/viewpoints/blogs/ad-law-access/fcc-declares-tcpa-restrictions-apply-to-ai-generated-calls
- Mintz, FCC regulatory update (Feb 2024): https://www.mintz.com/insights-center/viewpoints/2024-02-29-telephone-and-texting-compliance-news-regulatory-update-fcc
- KTS Law, Wiretap Laws in the United States (2024): https://ktslaw.com/en/Insights/Alert/2024/7/Wiretap-Laws-in-the-United-States
- Ringio, two-party consent states: https://help.ringio.com/en/articles/6314449-two-party-consent-states-call-recording
