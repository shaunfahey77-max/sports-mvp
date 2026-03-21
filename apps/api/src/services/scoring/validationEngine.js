export function validatePerformanceRow(perf, settledRows) {
  const wins = Number(perf?.wins || 0);
  const losses = Number(perf?.losses || 0);
  const pushes = Number(perf?.pushes || 0);
  const scored = Number(perf?.scored || 0);
  const picks = Number(perf?.picks || 0);

  if (wins + losses + pushes !== scored) {
    throw new Error(`INVALID_PERFORMANCE: wins+losses+pushes (${wins + losses + pushes}) !== scored (${scored})`);
  }

  if (scored > picks) {
    throw new Error(`INVALID_PERFORMANCE: scored (${scored}) > picks (${picks})`);
  }

  const nonPassCount = (settledRows || []).filter((r) => String(r?.pick || "").toUpperCase() !== "PASS").length;
  const settledCount = (settledRows || []).filter((r) => ["win", "loss", "push"].includes(String(r?.result || "").toLowerCase())).length;

  if (nonPassCount !== picks) {
    throw new Error(`INVALID_PERFORMANCE: nonPassCount (${nonPassCount}) !== picks (${picks})`);
  }

  if (settledCount !== scored) {
    throw new Error(`INVALID_PERFORMANCE: settledCount (${settledCount}) !== scored (${scored})`);
  }

  return true;
}
