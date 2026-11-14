// Statistics helpers for the dashboard. `values` is an array of numbers.

function median(values) {
  const sorted = values.sort(); //@BUG b1 default sort is lexicographic on numbers and mutates the caller's array
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b); //@DECOY d1 copied and numerically sorted
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// New users have no data yet, so `values` can legitimately be empty.
function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length; //@BUG b2 empty array gives NaN that propagates to the UI
}

function scheduleJobs(jobs, run) {
  for (var i = 0; i < jobs.length; i++) {
    setTimeout(() => run(jobs[i]), i * 100); //@BUG b3 var is shared; every callback sees i === jobs.length and runs undefined
  }
}

function managerName(user) {
  if (user.manager == null) { //@DECOY d2 == null idiom covers null and undefined
    return 'none';
  }
  return user.manager.name;
}

module.exports = { median, percentile, average, scheduleJobs, managerName };
