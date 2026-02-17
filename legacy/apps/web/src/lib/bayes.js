cat > ~/sports-mvp/apps/api/src/lib/bayes.js <<'EOF'
// apps/api/src/lib/bayes.js
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function shrinkProb({
  pModel,
  pPrior = 0.5,
  priorStrength = 20,
  modelStrength = 20,
  floor = 0.18,
  ceil = 0.82,
}) {
  const pm = clamp(Number(pModel), 0.0001, 0.9999);
  const pr = clamp(Number(pPrior), 0.0001, 0.9999);
  const post = (pr * priorStrength + pm * modelStrength) / (priorStrength + modelStrength);
  return clamp(post, floor, ceil);
}

export function blendWithMarket({ pModel, pMarket, marketWeight = 0.55 }) {
  const pm = clamp(Number(pModel), 0.0001, 0.9999);
  const pk = pMarket == null ? null : clamp(Number(pMarket), 0.0001, 0.9999);
  const w = clamp(Number(marketWeight), 0, 1);
  if (pk == null) return pm;
  return clamp(pm * (1 - w) + pk * w, 0.0001, 0.9999);
}
EOF
