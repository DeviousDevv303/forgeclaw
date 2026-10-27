"""Grammar-constrained decoding for NEXUS (PROPOSED; exercised on synthetic checkpoints only).

What it guarantees, by construction: the output is a well-formed transcript continuation. The route is a route token; a
call is the canonical compact JSON of a tool in the snapshot with schema-valid arguments (keys in schema order, required
keys present, types and enums respected, no special-token text); evidence is one the grammar's rules permit for the steps
so far (validateTranscript in src/grammar.ts; spec/fixtures/evidence-rules.json ties the two together); then answer, end.
What it does NOT guarantee: the right tool, the right argument values, or the canonical evidence label. Those stay learned.
"""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SNAP = json.loads((HERE.parent / "spec" / "tools.snapshot.json").read_text())
TOOLS = {t["name"]: t for t in SNAP["tools"]}
NOT_EVIDENCE = set(SNAP["notEvidenceTools"])
EVIDENCE = ["attempted", "completed", "verified", "blocked", "failed", "partial", "not_verified"]
SPECIAL_RE = re.compile(r"<\|/?[a-z_]+(?::[a-z_]+)?\|>")


class Invalid(Exception):
    pass


class Incomplete(Exception):
    pass


# ─── evidence rules (mirror of validateTranscript) ────────────────────────────────────────────────────────────────────
def allowed_evidence(route, steps):
    """steps: list of (tool_name, status). Mirrors the evidence switch in validateTranscript."""
    ok_ev = any(st == "ok" and n not in NOT_EVIDENCE for n, st in steps)
    any_ok = any(st == "ok" for _, st in steps)
    any_err = any(st == "error" for _, st in steps)
    rule = {"verified": ok_ev, "completed": any_ok, "failed": any_err, "partial": any_ok and any_err,
            "attempted": len(steps) > 0, "blocked": route == "defer" or any_err, "not_verified": True}
    return [e for e in EVIDENCE if rule[e]]


# ─── canonical call JSON, prefix-checked against the schema ──────────────────────────────────────────────────────────
class _P:
    def __init__(self, s):
        self.s, self.i = s, 0

    def end(self):
        return self.i >= len(self.s)

    def lit(self, text):
        rest = self.s[self.i:self.i + len(text)]
        if not text.startswith(rest):
            raise Invalid(f"expected {text!r}")
        if len(rest) < len(text):
            raise Incomplete()
        self.i += len(text)

    def peek(self):
        if self.end():
            raise Incomplete()
        return self.s[self.i]

    def string(self, options=None):
        """A JSON string. With options, its decoded content must be (a prefix of) one of them."""
        self.lit('"')
        out = []
        while True:
            c = self.peek()
            if c == '"':
                self.i += 1
                val = "".join(out)
                if options is not None and val not in options:
                    raise Invalid("not an allowed value")
                return val
            if c == "\\":
                if options is not None and not any("\\" in o or '"' in o or any(ord(ch) < 0x20 for ch in o) for o in options):
                    raise Invalid("no allowed value needs an escape")  # else an unfinished \u would be accepted and dead-end
                self.i += 1
                e = self.peek()
                simple = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}
                if e in simple:
                    out.append(simple[e]); self.i += 1
                elif e == "u":
                    hexd = self.s[self.i + 1:self.i + 5]
                    if not re.fullmatch(r"[0-9a-fA-F]*", hexd):
                        raise Invalid("bad \\u escape")
                    if len(hexd) < 4:
                        raise Incomplete()
                    out.append(chr(int(hexd, 16))); self.i += 5
                else:
                    raise Invalid("bad escape")
            elif ord(c) < 0x20:
                raise Invalid("control character in string")
            else:
                out.append(c); self.i += 1
            val = "".join(out)
            if "<|" in val:
                raise Invalid("special-token text inside a string")
            if options is not None and not any(o.startswith(val) for o in options):
                raise Invalid("not a prefix of an allowed value")

    def number(self, integer=False):
        if self.end():
            raise Incomplete()
        m = re.match(r"-?(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d*)?", self.s[self.i:])
        tok = m.group(0) if m else ""
        if not tok:
            raise Invalid("expected number")
        self.i += len(tok)
        full = re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?", tok)
        if self.end():
            # the number may still grow; it is only invalid if no continuation can fix it
            if not re.fullmatch(r"-?(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d*)?", tok) or (integer and re.search(r"[.eE]", tok)):
                raise Invalid("bad number")
            raise Incomplete()
        if not full:
            raise Invalid("bad number")
        if integer and re.search(r"[.eE]", tok):
            raise Invalid("expected integer")
        return float(tok)

    def value(self, schema):
        t = (schema or {}).get("type")
        en = (schema or {}).get("enum")
        if t == "string":
            return self.string(en)
        if t in ("number", "integer"):
            v = self.number(integer=t == "integer")
            if en is not None and v not in en:
                raise Invalid("not one of the enum")
            return v
        if t == "boolean":
            c = self.peek()
            self.lit("true" if c == "t" else "false")
            return c == "t"
        if t == "array":
            return self.array((schema or {}).get("items"))
        if t == "object":
            return self.obj(schema.get("properties"), schema.get("required", []))
        return self.any()

    def array(self, items):
        self.lit("[")
        if self.peek() == "]":
            self.i += 1
            return []
        out = [self.value(items)]
        while True:
            c = self.peek()
            if c == "]":
                self.i += 1
                return out
            self.lit(",")
            out.append(self.value(items))

    def obj(self, props, required):
        """props None = any keys. With props: keys in schema order, each at most once, required ones before '}'."""
        self.lit("{")
        order = list(props) if props is not None else None
        seen, last = [], -1
        first = True
        while True:
            c = self.peek()
            if c == "}":
                missing = [r for r in required if r not in seen]
                if missing:
                    raise Invalid(f"missing required {missing}")
                self.i += 1
                return dict.fromkeys(seen)
            if not first:
                self.lit(",")
            first = False
            if order is None:
                key = self.string()
                self.lit(":")
                self.any()
            else:
                allowed = [k for j, k in enumerate(order) if j > last]
                key = self.string(allowed)
                last = order.index(key)
                self.lit(":")
                self.value(props[key])
            seen.append(key)

    def any(self):
        c = self.peek()
        if c == '"':
            return self.string()
        if c == "{":
            return self.obj(None, [])
        if c == "[":
            return self.array(None)
        if c in "tf":
            return self.value({"type": "boolean"})
        if c == "n":
            self.lit("null")
            return None
        return self.number()


def check_call(s):
    """'complete' | 'incomplete' | 'invalid' for a candidate call-JSON prefix."""
    p = _P(s)
    try:
        p.lit('{"name":')
        name = p.string(list(TOOLS))
        p.lit(',"arguments":')
        params = TOOLS[name]["parameters"]
        p.obj(params.get("properties", {}), params.get("required", []))
        p.lit("}")
    except Incomplete:
        return "incomplete"
    except Invalid:
        return "invalid"
    return "complete" if p.end() else "invalid"


# ─── the decoder ──────────────────────────────────────────────────────────────────────────────────────────────────────
def prefix_state(prefix):
    """Where a case's prefix leaves the transcript: (state, route, steps)."""
    toks = SPECIAL_RE.findall(prefix)
    if not toks:
        return "route", None, []
    route = toks[0][len("<|route:"):-2]
    steps = []
    # the canonical structure: call JSON follows <|call|>, the status is in <|result:x|>
    for m in re.finditer(r"<\|call\|>(.*?)<\|/call\|><\|result:(ok|error)\|>", prefix, re.S):
        steps.append((json.loads(m.group(1))["name"], m.group(2)))
    if route == "tool":
        return ("after_result" if steps else "after_route_tool"), route, steps
    return "after_route_nontool", route, steps


class ConstrainedDecoder:
    def __init__(self, sp, max_scan=400):
        self.sp = sp
        self.max_scan = max_scan
        specials = json.loads((HERE.parent / "spec" / "special-tokens.json").read_text())
        self.id = {t: sp.piece_to_id(t) for t in specials}
        self.special_ids = set(self.id.values())
        self.route_ids = [self.id[f"<|route:{r}|>"] for r in ("tool", "direct", "defer")]
        self.ev_id = {e: self.id[f"<|ev:{e}|>"] for e in EVIDENCE}

    def _best(self, logits, allowed_ids):
        return max(allowed_ids, key=lambda i: float(logits[i]))

    def generate(self, step_logits, ctx_ids, prefix, max_new=200):
        """step_logits(ids) -> 1-D logits for the next token. Returns generated ids (stops after <|/call|> or <|end|>)."""
        state, route, steps = prefix_state(prefix)
        ids, out, seg = list(ctx_ids), [], []
        for n in range(max_new):
            lg = step_logits(ids)
            if state == "answer" and max_new - n <= 2:  # out of budget: close the answer so the segment stays well-formed
                state = "close_answer"
            if state == "route":
                nxt = self._best(lg, self.route_ids)
                route = {self.route_ids[0]: "tool", self.route_ids[1]: "direct", self.route_ids[2]: "defer"}[nxt]
                state = "after_route_tool" if route == "tool" else "after_route_nontool"
            elif state == "after_route_tool":
                nxt = self.id["<|call|>"]; state, seg = "call", []
            elif state in ("after_result", "after_route_nontool"):
                allowed = [self.ev_id[e] for e in allowed_evidence(route, steps)]
                if state == "after_result":
                    allowed.append(self.id["<|call|>"])
                nxt = self._best(lg, allowed)
                if nxt == self.id["<|call|>"]:
                    state, seg = "call", []
                else:
                    state = "after_ev"
            elif state == "after_ev":
                nxt = self.id["<|answer|>"]; state = "answer"
            elif state == "close_answer":
                nxt = self.id["<|/answer|>"]; state = "after_answer"
            elif state == "after_answer":
                nxt = self.id["<|end|>"]
            elif state == "call":
                nxt = None
                ranked = sorted(range(len(lg)), key=lambda i: -float(lg[i]))
                # The top max_scan first (cheap); then the rest of the vocabulary, so a valid continuation is never missed. Byte
                # fallback pieces can spell any character, so an incomplete call always has one somewhere in the vocabulary.
                for cand in ranked[: self.max_scan] + ranked[self.max_scan:]:
                    if cand == self.id["<|/call|>"]:
                        if check_call(self.sp.decode(seg)) == "complete":
                            nxt = cand; break
                        continue
                    if cand in self.special_ids or cand < 4:
                        continue
                    if check_call(self.sp.decode(seg + [cand])) != "invalid":
                        nxt = cand; break
                if nxt is None:  # nothing in the scan keeps the call valid: stop; the output is then a format failure
                    break
                if nxt != self.id["<|/call|>"]:
                    seg.append(nxt)
            elif state == "answer":
                allowed_close = self.id["<|/answer|>"]
                order = sorted(range(len(lg)), key=lambda i: -float(lg[i]))
                nxt = next(i for i in order if i == allowed_close or (i not in self.special_ids and i >= 4))
                if nxt == allowed_close:
                    state = "after_answer"
            out.append(nxt); ids.append(nxt)
            if nxt == self.id["<|/call|>"] or nxt == self.id["<|end|>"]:
                break
        return out
