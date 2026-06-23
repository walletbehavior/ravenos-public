import assert from "node:assert/strict";
import fs from "node:fs";

const featureScript = fs.readFileSync("ravenos-features.js", "utf8");
const explanationScript = fs.readFileSync("ravenos-explanations.js", "utf8");
const replayScript = fs.readFileSync("ravenos-replay.js", "utf8");
const participantScript = fs.readFileSync("ravenos-participants.js", "utf8");
const accessScript = fs.readFileSync("ravenos-access.js", "utf8");
const terminal = fs.readFileSync("terminal/index.html", "utf8");
const research = fs.readFileSync("research/index.html", "utf8");
const atlas = fs.readFileSync("atlas/index.html", "utf8");
const watchlists = fs.readFileSync("watchlists/index.html", "utf8");
const perps = fs.readFileSync("perps/index.html", "utf8");

assert.match(featureScript, /function FeatureGate/);
assert.match(featureScript, /function lockedPreview/);
assert.match(featureScript, /AccessBadge/);
assert.match(featureScript, /CoverageBadge/);
assert.match(featureScript, /data-feature/);
assert.match(explanationScript, /ExplanationPanel/);
assert.match(explanationScript, /ScoreBreakdown/);
assert.match(explanationScript, /ConfidenceBadge/);
assert.match(explanationScript, /EvidenceList/);
assert.match(explanationScript, /WhyThisChanged/);
assert.match(replayScript, /ReplayOutcomePanel/);
assert.match(replayScript, /similarStructures/);
assert.match(replayScript, /Outcome distribution/);
assert.match(participantScript, /ParticipantPanel/);
assert.match(participantScript, /contribution/);
assert.match(participantScript, /Distribution risk/);

assert.match(accessScript, /API unavailable\. Subscription and future token access checks are temporarily unavailable\./);
assert.match(accessScript, /entitlements/);

assert.match(terminal, /data-feature="free_token_lookup"/);
assert.match(terminal, /data-feature="basic_chart"/);
assert.match(terminal, /data-feature="full_heatmaps"/);
assert.match(terminal, /ravenos-features\.js/);
assert.match(terminal, /ravenos-explanations\.js/);
assert.match(terminal, /ravenos-replay\.js/);
assert.match(terminal, /ravenos-participants\.js/);
assert.match(terminal, /data-feature="participant_intelligence"/);
assert.match(terminal, /github\.com\/walletbehavior\/ravenos-public\/tree\/main\/docs/);

assert.match(research, /data-feature="full_research"/);
assert.match(research, /failure_analysis/);
assert.match(research, /candidate_lanes/);
assert.match(research, /ravenos-features\.js/);
assert.match(research, /ravenos-explanations\.js/);
assert.match(research, /ravenos-replay\.js/);
assert.match(research, /ravenos-participants\.js/);
assert.match(research, /Key Findings This Week/);
assert.match(research, /What Worked/);
assert.match(research, /Outcome Quality/);
assert.match(research, /Replay Strength/);
assert.match(research, /Developer Mode/);

assert.match(atlas, /data-feature="atlas_context"/);
assert.match(atlas, /data-coverage-badge/);
assert.match(atlas, /Tradier is temporarily unavailable/);

assert.match(watchlists, /data-feature="watchlists"/);
assert.match(watchlists, /\/api\/watchlists/);
assert.match(watchlists, /Free users can keep one compact watchlist/);
assert.match(watchlists, /ravenos-explanations\.js/);
assert.match(watchlists, /ravenos-replay\.js/);

assert.match(perps, /data-feature="perps_intelligence"/);
assert.match(perps, /\/api\/hyperliquid\/perps/);
assert.match(perps, /RavenOS Perps Intelligence/);
assert.match(perps, /ravenos-participants\.js/);
assert.match(perps, /ravenos-replay\.js/);
