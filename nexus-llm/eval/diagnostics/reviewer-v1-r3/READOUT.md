# REVIEWER v1 round 3: read-out (rules applied mechanically; 54/54 arm-i calls, 9/9 arm-ii calls)

| Cell | T (of 6) | Exact kind | Controls (of 3) | Malformed rows |
|---|---|---|---|---|
| 2x2 cell A (comparator) | 2 | 1 | 3 | 0 |
| (i) one check per call, code-assembled | 6 | 5 | 0 | 0 |
| (ii) checks as input | 5 | 5 | 3 | 0 |

Per row (A / (i) / (ii)):
- RV-01: claims-match / claims-mismatch:self-contradiction / claims-match
- RV-02: claims-match / claims-mismatch:self-contradiction / claims-match
- RV-03: claims-match / claims-mismatch:inflated-count / claims-mismatch:inflated-count
- RV-04: claims-mismatch:stale-count / claims-mismatch:stale-count / claims-mismatch:stale-count
- RV-05: claims-match / claims-mismatch:self-contradiction / claims-mismatch:self-contradiction
- RV-06: claims-match / claims-mismatch:self-contradiction / claims-match
- RV-07: claims-match / claims-mismatch:unread-reply / claims-mismatch:unread-reply
- RV-08: claims-mismatch:self-contradiction / reject:phantom-ref / reject:phantom-ref
- RV-09: claims-match / claims-mismatch:stale-count / claims-match

Arm (i) blessed traps flipped **by their own designated check**: ['RV-03', 'RV-05', 'RV-07'] (3 of 4). Unparsable check replies: 2 of 54. Off-target flags (a check flagging a row it is not designated for): [('RV-01', 'self-contradiction'), ('RV-02', 'self-contradiction'), ('RV-04', 'diff-stat'), ('RV-06', 'self-contradiction'), ('RV-09', 'self-contradiction'), ('RV-09', 'test-count')]

**Rule C-i:** NOT MET: flips present but controls 0/3 < 2 (over-rejection).
**Surprise clause:** RV-02 flipped by own check: False; RV-07: True.
**Rule S-ii (seat design, arm ii hands over the answer):** VIABLE: exact kind on 5 of 6 traps and controls 3/3 (model can format from evidence).

---

## Post-hoc description (NOT part of the pre-registered rules; computed from the same results after the mechanical read-out above)

**Arm (i), per check** (designated rows are the trap rows each check is meant to catch):

| Check | Own-row hits | False flags on other rows | Unparsable |
|---|---|---|---|
| refs | 1/1 (RV-08) | 0/8 | 0 |
| lost-lines | **0/1 (RV-02 missed)** | 0/8 | 0 |
| test-count | 2/2 (RV-03, RV-04) | 1/7 (RV-09) | 1 (RV-07) |
| diff-stat | n/a (no trap row) | 1/9 (RV-04) | 1 (RV-03) |
| self-contradiction | 1/1 (RV-05) | **4/8 (RV-01, 02, 06, 09)** | 0 |
| unread-reply | 1/1 (RV-07) | 0/8 | 0 |

**Reading, descriptively:** the 0/3 controls come almost entirely from one check. The self-contradiction question was answered "flag" on four rows that contain no rendered sentence at all, although the question says to pass in that case, and test-count flagged RV-09 once. The checks whose question describes a literal pattern in the packet (a 404 in a resolver table; a catch that turns a parse failure into `{}` followed by a success return) found their trap and flagged nothing else. The check that needs diff reading (lost-lines) missed RV-02, the same row that failed in every earlier cell. The rule is applied as registered: a flip with controls below 2 of 3 is over-rejection, not verification.

**Arm (ii), copy fidelity (code's top flag versus the model's verdict):** 8 of 9 rows followed the code verdict. The one exception is **RV-02**: the code said `claims-mismatch:lost-lines`, and the model answered `claims-match` anyway, on the longest row. S-ii is met as registered (exact kind 5 of 6, controls 3 of 3), and this row is the caveat on it: a seat that lets the model overrule a code flag would have blessed RV-02.
