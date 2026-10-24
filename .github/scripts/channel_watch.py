"""Channel Watch: tell whoever wrote an agent @mention what that mention actually reaches.

A GitHub @mention is text. On this repository only @claude starts anything (claude.yml, for the owner and
collaborators); @kimi, @chatgpt and @muse are connected to nothing here, and a mention of them is delivered
nowhere unless someone relays it. 2026-10-23: a channel note assumed an @Claude mention had reached its
lane when the run had failed after 0 s. This posts one notice saying what each mention reaches, so nobody
waits on a reply that cannot come. It never claims a review, an approval or an execution.

Reads the event from the environment (the workflow passes each event's own text; nothing is interpolated into
a shell), and writes the notice body to stdout, or nothing when no notice is due.
Run the tests with: python -B -m unittest discover -s .github/scripts -p 'test_*.py'
"""
import os
import re
import sys

ACK_MARKER = "<!-- channel-watch:ack -->"
HANDLES = ("claude", "kimi", "chatgpt", "muse")
TRUSTED = {"OWNER", "MEMBER", "COLLABORATOR"}

# The text each event carries for its author, and that author's association. One event, one text: a review with an
# empty body must not fall back to the pull request's description, or every review would re-read the PR body.
EVENT_FIELDS = {
    "issue_comment": ("COMMENT_BODY", "COMMENT_ASSOCIATION"),
    "pull_request_review_comment": ("COMMENT_BODY", "COMMENT_ASSOCIATION"),
    "pull_request_review": ("REVIEW_BODY", "REVIEW_ASSOCIATION"),
    "issues": ("ISSUE_TEXT", "ISSUE_ASSOCIATION"),
    "pull_request": ("PR_BODY", "PR_ASSOCIATION"),
}

# Whether claude.yml reacts to each watched event, i.e. whether it lists the event in its `on:`. F-021: the notice said
# "@claude starts the Claude Code workflow" for a pull request's description, but claude.yml has no pull_request
# trigger, so that mention starts nothing. test_channel_watch.py reads claude.yml and fails if this table drifts from it.
CLAUDE_STARTS_ON = {
    "issue_comment": True,
    "pull_request_review_comment": True,
    "pull_request_review": True,
    "issues": True,
    "pull_request": False,
}

_FENCED = re.compile(r"(```|~~~)[\s\S]*?(\1|\Z)")
_INLINE = re.compile(r"`[^`\n]*`")
_QUOTE = re.compile(r"^\s*>.*$", re.MULTILINE)
_MENTION = re.compile(r"(?<![\w@./-])@(" + "|".join(HANDLES) + r")\b", re.IGNORECASE)

# Every handle in the notice is in backticks: claude, muse and Kimi are real GitHub accounts, and a bare @name notifies
# them. The owner's own mention already pinged them once; the notice must not ping them again.
LINES = {
    "claude": "- `@claude` starts the Claude Code workflow (`claude.yml`) when the owner or a collaborator writes it; "
              "its run, and any failure, shows under Actions → Claude Code.",
    "kimi": "- `@kimi` is not connected to this repository. Nothing was delivered; Kimi sees this only if someone relays it.",
    "chatgpt": "- `@chatgpt` is not connected to this repository. Nothing was delivered; ChatGPT sees this only if someone relays it.",
    "muse": "- `@muse` is not connected to this repository. Nothing was delivered; Muse sees this only if someone relays it.",
}
# What @claude reaches where claude.yml has no trigger for the event (see CLAUDE_STARTS_ON).
CLAUDE_NOT_STARTED = (
    "- `@claude` in a pull request description starts nothing: `claude.yml` reacts to comments and reviews on a pull "
    "request, not to its description. Comment on the pull request to reach it."
)


def line_for(handle, event):
    """The notice line for one handle on one event: what that mention reaches there."""
    if handle == "claude" and not CLAUDE_STARTS_ON.get(event, False):
        return CLAUDE_NOT_STARTED
    return LINES[handle]


def mentions(text):
    """Agent handles mentioned in prose, in first-seen order. Code, inline code and quoted lines do not count."""
    prose = _QUOTE.sub("", _INLINE.sub("", _FENCED.sub("", text or "")))
    seen = []
    for match in _MENTION.finditer(prose):
        handle = match.group(1).lower()
        if handle not in seen:
            seen.append(handle)
    return seen


def notice(event, env):
    """The notice body for one event, or None when none is due."""
    fields = EVENT_FIELDS.get(event)
    if not fields:
        return None
    if env.get("SENDER_TYPE") == "Bot":
        return None
    text = env.get(fields[0], "")
    if ACK_MARKER in text:
        return None
    # Public repository: anyone can comment, so only the people claude.yml itself trusts get a notice.
    if env.get(fields[1], "") not in TRUSTED:
        return None
    found = mentions(text)
    if not found:
        return None
    return "\n".join([
        f"Channel Watch: {', '.join('`@' + h + '`' for h in found)} "
        + ("is a mention, not a delivered request." if len(found) == 1 else "are mentions, not delivered requests."),
        "",
        *[line_for(h, event) for h in found],
        "",
        "This is a notice only: no review, approval or execution happened here.",
        ACK_MARKER,
    ])


def main():
    body = notice(os.environ.get("EVENT_NAME", ""), os.environ)
    if body:
        sys.stdout.write(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
