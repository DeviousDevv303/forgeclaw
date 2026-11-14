# Nexus C3 formation-only run

Benchmark SHA-256: `e5ba5013dd99f3a1b39b7d163c19e556405966e69a5dcbd08a2ed1c9b62b4adb` (25 frozen rows).

This run grades only each row's first raw Run 25 generation segment. It does not execute emitted tools or children; it therefore cannot certify full decomposition counts, sequencing, child return, or parent synthesis. The separate live UI traces provide read-only end-to-end evidence for mapped rows.

| Row | Invocation | Run | First-segment spawn | Expected count | Formation valid | Count match |
|---|---|---|---:|---:|---|---|
| sw-001 | `swarm-sw-001-20261114T010135Z-6435145c` | [#43537982539](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537982539) | 0 none | 0 | True | True |
| sw-002 | `swarm-sw-002-20261114T010135Z-0b9c70c1` | [#43537982436](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537982436) | 0 none | 0 | True | True |
| sw-003 | `swarm-sw-003-20261114T010135Z-f3f10595` | [#43537982369](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537982369) | 0 none | 0 | True | True |
| sw-004 | `swarm-sw-004-20261114T010135Z-49c1d6a0` | [#43537982492](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537982492) | 0 none | 0 | True | True |
| sw-005 | `swarm-sw-005-20261114T010135Z-2dae374a` | [#43537985348](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537985348) | 0 none | 0 | True | True |
| sw-006 | `swarm-sw-006-20261114T010135Z-2bd74549` | [#43537985435](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537985435) | 0 none | 4 | True | False |
| sw-007 | `swarm-sw-007-20261114T010135Z-a0e7aa30` | [#43537985676](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537985676) | 0 none | 3 | True | False |
| sw-008 | `swarm-sw-008-20261114T010135Z-6eb970f6` | [#43537985667](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537985667) | 0 none | 3 | True | False |
| sw-009 | `swarm-sw-009-20261114T010135Z-2962ea84` | [#43537987950](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537987950) | 0 none | 2 | True | False |
| sw-010 | `swarm-sw-010-20261114T010135Z-285cca7a` | [#43537987879](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537987879) | 0 none | 2 | True | False |
| sw-011 | `swarm-sw-011-20261114T010135Z-006a79a8` | [#43537988265](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537988265) | 0 none | 2 | True | False |
| sw-012 | `swarm-sw-012-20261114T010135Z-da84673f` | [#43537988134](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537988134) | 0 none | 2 | True | False |
| sw-013 | `swarm-sw-013-20261114T010135Z-3d72e9f6` | [#43537991439](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537991439) | 0 none | 3 | True | False |
| sw-014 | `swarm-sw-014-20261114T010135Z-d5e3e20f` | [#43537991102](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537991102) | 0 none | 3 | True | False |
| sw-015 | `swarm-sw-015-20261114T010135Z-ac2fb3b9` | [#43537991696](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537991696) | 0 none | 3 | True | False |
| sw-016 | `swarm-sw-016-20261114T010135Z-70812ff5` | [#43537991277](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537991277) | 0 none | 2 | True | False |
| sw-017 | `swarm-sw-017-20261114T010135Z-9921a24d` | [#43537993758](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537993758) | 0 none | 2 | True | False |
| sw-018 | `swarm-sw-018-20261114T010135Z-2ce8e4c0` | [#43537994058](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537994058) | 0 none | 3–6 | True | False |
| sw-019 | `swarm-sw-019-20261114T010135Z-bb79ef03` | [#43537994075](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537994075) | 0 none | 3 | True | False |
| sw-020 | `swarm-sw-020-20261114T010135Z-2c870d1a` | [#43537995160](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537995160) | 0 none | 2 | True | False |
| sw-021 | `swarm-sw-021-20261114T010135Z-fe333f0c` | [#43537997074](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537997074) | 0 none | 2 | True | False |
| sw-022 | `swarm-sw-022-20261114T010135Z-aa06a03c` | [#43537997559](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537997559) | 0 none | 3–4 | True | False |
| sw-023 | `swarm-sw-023-20261114T010135Z-4241100a` | [#43537998023](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537998023) | 0 none | 3 | True | False |
| sw-024 | `swarm-sw-024-20261114T010135Z-d12d539f` | [#43537998776](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43537998776) | 1 You are a docs check that settles  | 2–3 | True | False |
| sw-025 | `swarm-sw-025-20261114T010135Z-f09b872e` | [#43538000162](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43538000162) | 0 none | 3 | True | False |

A C3 gate verdict is intentionally not issued from first segments; consult the full raw traces and the live read-only probe report.
