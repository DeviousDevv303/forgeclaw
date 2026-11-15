/* NEXUS Intelligence: dump ADMITTED corpus records from the browser into a file for the exporter.
 *
 * HOW (operator): open ForgeClaw in the browser you use it in, open DevTools > Console, paste this whole file, press Enter.
 * It downloads nexus-store-export.json. Hand that file to the exporter. It does not send anything anywhere.
 *
 * WHAT IT WRITES: only localStorage keys that start with "forgeclaw_nexus_" AND belong to an operator-visible admitted
 * record (the approved knowledge record and the candidate with the same integrity hash). Chat history, provider keys, the
 * GitHub token, Kalshi credentials and un-admitted candidates are NOT read into the file.
 * It aborts without writing if any value looks like a credential. Set INCLUDE_UNADMITTED = true only if you want the
 * exporter to see un-admitted candidates (it still never trains on them); that file then contains your raw chat history.
 */
(function () {
  var INCLUDE_UNADMITTED = false
  var REC = 'forgeclaw_nexus_record_v1:', CAND = 'forgeclaw_nexus_candidate_v1:'
  var SECRET = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16})/
  var keys = {}, approved = 0
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i)
      if (!k || k.indexOf(REC) !== 0) continue
      var raw = localStorage.getItem(k), rec
      try { rec = JSON.parse(raw) } catch (e) { continue }
      if (!rec || rec.recordType !== 'knowledge' || rec.admissionStatus !== 'approved') continue
      approved++
      keys[k] = raw
      var ck = CAND + 'candidate-' + rec.integrity, craw = localStorage.getItem(ck)
      if (craw) keys[ck] = craw
    }
    if (INCLUDE_UNADMITTED) for (var j = 0; j < localStorage.length; j++) {
      var k2 = localStorage.key(j)
      if (k2 && k2.indexOf(CAND) === 0 && !(k2 in keys)) keys[k2] = localStorage.getItem(k2)
    }
  } catch (e) { console.error('NEXUS dump failed: storage not readable', e && e.message); return }
  for (var key in keys) if (SECRET.test(keys[key])) { console.error('NEXUS dump ABORTED: a value in ' + key.slice(0, 60) + ' looks like a credential. Nothing was written. Review that record.'); return }
  var out = { format: 'nexus-store-export', version: 1, exportedAt: new Date().toISOString(), origin: location.origin, keys: keys }
  var blob = new Blob([JSON.stringify(out)], { type: 'application/json' })
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nexus-store-export.json'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  console.log('NEXUS dump: ' + approved + ' approved knowledge records, ' + Object.keys(keys).length + ' keys written.')
})()
