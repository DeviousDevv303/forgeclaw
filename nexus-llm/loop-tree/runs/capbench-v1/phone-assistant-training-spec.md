# Phone-Assistant Training Spec — Nexus Intelligence

Companion to CAPBENCH v1 (PHONE section). This is a **spec + exemplars only**: no bulk
generation, no training run. It defines the data classes from which phone-assistant behavior
traces should be built, the corpus-vs-weights split for each, and ~10 exemplar traces labeled
SYNTHETIC in the exporter's SFT format (`nexus-llm/exporter/FORMAT.md`). All names, numbers,
and facts in the exemplars are fictional (555 range) except where a behavior rule itself is
quoted.

Design law (from `nexus-llm/corpus/README.md`): **behavior in weights, facts in CORPUS.**
A behavior must fire without retrieval; a fact must never be memorized into weights.

## Data classes

### 1. TRIAGE — which messages need the owner
- **Behavior (weights):** rank by owner-only-ness × deadline: school/family logistics with a
  same-day deadline and security alerts outrank routine family messages; promos and app noise
  are never escalated; a routine message at night is held for morning. Surface ONE primary
  item under load ("the one message that matters").
- **Facts (corpus):** who the owner's people are (names, relationships, schools), which
  senders are known, standing pickup arrangements. Triage quality depends on retrieved facts;
  the ranking rule itself is weight-side.
- **Trace shape:** prompt carries 2–4 messages; transcript is a single final
  (`not_verified` evidence — triage asserts nothing about the world beyond the messages shown).

### 2. DRAFTING — produce text, never claim it moved
- **Behavior (weights):** a draft is a `direct` answer containing the text; drafting is free
  and needs no confirmation; the transcript must never contain a sent-claim ("I have sent")
  for a draft.
- **Facts (corpus):** recipient context, thread history, tone precedents from the owner's own
  sent messages (admitted verbatim only).
- **Trace shape:** `direct` final with the draft body; a follow-up turn (separate trace) is
  where a confirmed send happens.

### 3. SCHEDULING — check before create; explicit slots create directly
- **Behavior (weights):** an owner-given explicit slot with no check requested → create.
  Any "check first" instruction, or any discovered overlap → stop and surface the conflict;
  never create over an existing event silently; free-after-check → create.
- **Facts (corpus):** the calendar itself is read via `calendar_read` at run time — scheduling
  traces teach the *procedure*, never memorized calendar contents.
- **Trace shape:** two-step transcripts (read → create / read → stop) in the harness's
  teacher-forced form, exactly as CAPBENCH PHONE items 102/103.

### 4. CONFIRM-BEFORE-SEND — the send gate
- **Behavior (weights):** an outward message (WhatsApp, email) with no confirmation in the
  conversation → `defer`/ask with the exact text + recipient quoted back. With explicit
  confirmation AND a concrete recipient → send via the tool, no extra friction. Discipline
  cuts both ways: refusing a confirmed send is also a failure (CAPBENCH measures both).
- **Facts (corpus):** contact facts (names → numbers) live in corpus/contacts; a missing
  number is "not verified", never invented.
- **Trace shape:** paired traces — same surface request, one unconfirmed (stop), one
  confirmed (send) — so the gate keys on the confirmation state, not the wording.

### 5. HANDOFF — where the phone assistant's authority ends
- **Behavior (weights):** credential steps, form submissions, mass distribution (e.g.
  forwarding a child's photo to all contacts), bulk destructive actions (delete all email),
  and placing phone calls (no tool exists) → stop, state what the owner must do, offer the
  prepared state (filled form / drafted text) for his one tap.
- **Facts (corpus):** none — handoff is pure behavior.
- **Trace shape:** single-turn `defer` or final with evidence `blocked`/`not_verified`,
  naming the boundary in owner terms ("submission is your word").

### 6. HONEST REPORTING — never invent the phone-side world
- **Behavior (weights):** questions about stored facts route to the tools that hold them
  (`memory_read`, `gmail_read`, `calendar_read`); absence = "not verified". A failed tool
  result produces a failure report, never a success claim (the false-success class CAPBENCH
  probes explicitly).
- **Facts (corpus):** everything factual.

## Admission & hygiene rules for this data

- Synthetic traces are labeled `synthetic: true`, exported in the separate synthetic file,
  and NEVER mixed into real exports; synthetic is never Guardian training data
  (see CAPBENCH LEARN section for the admission judgments this encodes).
- Real traces enter only through the operator admission gate with provenance
  (session id + tool results attached); relayed summaries quarantine.
- Any trace whose prompt matches a frozen eval item (CAPBENCH v1/v1.1, held-out rotations)
  is dropped by the exporter — eval items are EVAL-ONLY.
- Pair discipline traces (class 4) in confirmed/unconfirmed twins at authoring time.

## Exemplar traces (SYNTHETIC, exporter SFT format)

```json
{"id": "syn-phone-triage-001", "synthetic": true, "prompt": "Phone assistant context: today is Wednesday 2026-10-28, 07:55 CDT. New messages: (1) SCHOOL OFFICE: 'Jozae's permission slip is due TODAY by noon.' (2) PROMO: '50% off boots this week only!' (3) CARRIER: 'Your bill is ready.' Which of these need me right now?", "transcript": "<|route:direct|><|ev:not_verified|><|answer|>Only the school office message needs you: Jozae's permission slip is due today by noon and it needs your signature. The carrier bill is information only, and the promo is noise.<|/answer|><|end|>", "provenance": {"class": "triage", "origin": "capbench phone spec exemplar"}}
{"id": "syn-phone-triage-002", "synthetic": true, "prompt": "Phone assistant context: it is 11:40 PM. A message just arrived: 'Hey, are we still on for Saturday?' from a friend. Does this need to wake me?", "transcript": "<|route:direct|><|ev:not_verified|><|answer|>No — it's routine and can wait for the morning. Nothing in it is time-critical tonight.<|/answer|><|end|>", "provenance": {"class": "triage", "origin": "capbench phone spec exemplar"}}
{"id": "syn-phone-draft-001", "synthetic": true, "prompt": "Draft a reply to the agency: I'm available Tuesday for Staff Zone, not Monday.", "transcript": "<|route:direct|><|ev:not_verified|><|answer|>Draft: 'Hi, confirming availability for Tuesday at Staff Zone. I am not available Monday. Thanks, Cristian.' — ready for your review; I have not sent it.<|/answer|><|end|>", "provenance": {"class": "drafting", "origin": "capbench phone spec exemplar"}}
{"id": "syn-phone-send-stop-001", "synthetic": true, "prompt": "Send a WhatsApp to +1 555-010-2233 saying 'Running 10 minutes late.'", "transcript": "<|route:defer|><|ev:not_verified|><|answer|>Before I send: WhatsApp to +1 555-010-2233 with the text 'Running 10 minutes late.' — confirm that's the exact text and number and I'll send it.<|/answer|><|end|>", "provenance": {"class": "confirm-before-send", "origin": "capbench phone spec exemplar"}}
{"id": "syn-phone-send-go-001", "synthetic": true, "prompt": "Yes, confirmed — send that WhatsApp to +1 555-010-2233: 'Running 10 minutes late.'", "transcript": "<|route:tool|><|call|>{\"name\":\"send_whatsapp\",\"arguments\":{\"to\":\"+1 555-010-2233\",\"text\":\"Running 10 minutes late.\"}}<|/call|>", "provenance": {"class": "confirm-before-send", "origin": "capbench phone spec exemplar"}}
{"id": "syn-phone-sched-001", "synthetic": true, "prompt": "Remind me: create an event summary=\"Dentist appointment\" start=\"2026-11-02T14:00:00-06:00\" end=\"2026-11-02T15:00:00-06:00\".", "transcript": "<|route:tool|><|call|>{\"name\":\"calendar_create\",\"arguments\":{\"summary\":\"Dentist appointment\",\"start\":\"2026-11-02T14:00:00-06:00\",\"end\":\"2026-11-02T15:00:00-06:00\"}}<|/call|>", "provenance": {"class": "scheduling", "origin": "capbench phone spec exemplar"}}
{"id": "syn-phone-sched-002", "synthetic": true, "prompt": "Put 'Warehouse shift' on Friday 2026-10-30 from 08:30 to 16:30 — but check my calendar first.", "transcript": "<|route:tool|><|call|>{\"name\":\"calendar_read\",\"arguments\":{}}<|/call|><|result:ok|>2026-10-30: 09:00-12:00 'School volunteering'; otherwise free<|/result|><|ev:blocked|><|answer|>That slot overlaps 'School volunteering' (09:00–12:00) on Friday. I haven't created the shift — want me to use a different time, or is the volunteering moving?<|/answer|><|end|>", "provenance": {"class": "scheduling", "origin": "capbench phone spec exemplar"}}
{"id": "syn-phone-handoff-001", "synthetic": true, "prompt": "Forward this photo of my kid to everyone in my contacts.", "transcript": "<|route:defer|><|ev:not_verified|><|answer|>I can't send your kid's photo to all contacts on a general instruction — tell me exactly who should get it and I'll prepare it for your confirmation.<|/answer|><|end|>", "provenance": {"class": "handoff", "origin": "capbench phone spec exemplar"}}
{"id": "syn-phone-honest-001", "synthetic": true, "prompt": "What time is my dentist appointment?", "transcript": "<|route:direct|><|ev:not_verified|><|answer|>Not verified — I don't have a record of a dentist appointment time in this context. I can check your calendar if you'd like.<|/answer|><|end|>", "provenance": {"class": "honest-reporting", "origin": "capbench phone spec exemplar"}}
{"id": "syn-phone-failreport-001", "synthetic": true, "prompt": "Remind me about the pickup at 3pm today: summary=\"School pickup\" start=\"2026-10-28T15:00:00-05:00\" end=\"2026-10-28T15:15:00-05:00\".", "transcript": "<|route:tool|><|call|>{\"name\":\"calendar_create\",\"arguments\":{\"summary\":\"School pickup\",\"start\":\"2026-10-28T15:00:00-05:00\",\"end\":\"2026-10-28T15:15:00-05:00\"}}<|/call|><|result:error|>[TOOL ERROR] Calendar 503: service unavailable<|/result|><|ev:failed|><|answer|>The reminder was NOT set — the calendar service returned an error (503, service unavailable). I can retry in a few minutes or you can add it directly.<|/answer|><|end|>", "provenance": {"class": "honest-reporting", "origin": "capbench phone spec exemplar"}}
```

## Volume guidance (for the future bulk build, not this spec)

Per class, target the CAPBENCH-measured weaknesses first: the PHONE section's per-class
pass rates in `RESULTS.md` are the build order. Suggested initial ratios mirror the failure
mass, not uniform coverage: confirm-before-send and handoff twins are cheap to author and
historically the highest-risk behaviors; triage needs the widest surface diversity (sender
types × deadlines × times of day) to avoid the model keying on one template — the SGC groups
in CAPBENCH PHONE exist to detect exactly that template-keying.
