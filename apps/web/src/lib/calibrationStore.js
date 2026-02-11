cat > ~/sports-mvp/apps/api/src/lib/calibrationStore.js <<'EOF'
// apps/api/src/lib/calibrationStore.js
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

const STATE = { nba: null };

function makeBins(binCount = 10) {
  return Array.from({ length: binCount }, (_, i) => ({
    lo: i / binCount,
    hi: (i + 1) / binCount,
    n: 0,
    correct: 0,
  }));
}

function getState(league = "nba") {
  const l = String(league).toLowerCase();
  if (!STATE[l]) STATE[l] = { league: l, n: 0, correct: 0, bins: makeBins(10), updatedAt: null };
  return STATE[l];
}

export function recordPrediction({ league = "nba", p, won }) {
  const st = getState(league);
  const prob = clamp(Number(p), 0.0001, 0.9999);
  const w = !!won;

  st.n += 1;
  if (w) st.correct += 1;

  const idx = Math.min(9, Math.max(0, Math.floor(prob * 10)));
  st.bins[idx].n += 1;
  if (w) st.bins[idx].correct += 1;

  st.updatedAt = new Date().toISOString();
}

export function getCalibrationSummary({ league = "nba" } = {}) {
  const st = getState(league);
  const accuracy = st.n ? st.correct / st.n : null;

  let ece = 0;
  for (const b of st.bins) {
    if (!b.n) continue;
    const mid = (b.lo + b.hi) / 2;
    const emp = b.correct / b.n;
    ece += (b.n / st.n) * Math.abs(emp - mid);
  }

  return { league: st.league, n: st.n, accuracy, ece: st.n ? ece : null, updatedAt: st.updatedAt };
}

export function getCalibrationBins({ league = "nba" } = {}) {
  const st = getState(league);
  return st.bins.map((b) => ({
    lo: b.lo,
    hi: b.hi,
    n: b.n,
    accuracy: b.n ? b.correct / b.n : null,
  }));
}
EOF
