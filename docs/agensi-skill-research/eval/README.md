# Eval: evidence-code-review vs Agensi Code Reviewer vs no skill

Arms (same model, same output contract, one run per cell):
- A_none: plain "review this file"
- B_agensi: `baseline/agensi_code_reviewer_reconstruction.md` (RECONSTRUCTED from the public listing; not the paid text)
- C_ours: `../skill/SKILL.md`

Fixtures: `fixtures_src/` hold 6 files with 15 planted bugs, 13 look-alike decoys and 1 bug-free file, marked with `@BUG` / `@DECOY`.
Reproduce:
```
python3 build_fixtures.py fixtures_src <clean_dir> data/truth.json   # reviewers only ever see <clean_dir>
# run each arm on each file, writing <results>/<arm>/<fixture>.json  ({"findings":[{file,line,severity,...}]})
python3 score.py data/truth.json <results>
```
Scoring is deterministic (see `score.py` docstring). Limits: n=1 per cell, planted bugs are authored by us, B is a reconstruction.
