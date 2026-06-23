import { chartTimes, clampScore, decorateForTier, normalizeInstrument, severityForScore, type RavenOverlayProvider } from "../overlayProvider";

const SHIFT_LABELS: Record<string, string> = {
  smart_money_accumulation: "smart money accumulation",
  retail_expansion: "retail expansion",
  concentration_increase: "concentration increase",
  distribution_risk: "distribution risk",
  rotation_event: "rotation event",
};

export const participantOverlayProvider: RavenOverlayProvider = {
  id: "participant",
  supports: (context) => Boolean(context.data?.participants?.length),
  getOverlays: (context) => {
    const { symbol } = normalizeInstrument(context);
    const times = chartTimes(context.candles);

    return (context.data?.participants || []).map((item, index) => {
      const participantScore = clampScore(item.participantScore);
      const riskLike = item.shiftType === "distribution_risk" || item.shiftType === "concentration_increase";
      return decorateForTier(
        {
          id: `${symbol}-participant-${item.shiftType}-${index}`,
          type: "participant-shift",
          label: item.label || SHIFT_LABELS[item.shiftType] || "participant shift",
          time: item.time || times.mid || times.last,
          value: participantScore,
          severity: severityForScore(participantScore, riskLike ? "risk" : "strength"),
          source: "participant",
          summary: item.summary || "Normalized participant behavior context for this instrument.",
          metadata: {
            participantScore,
            participantShiftType: item.shiftType,
            experimental: item.experimental === true || item.shiftType === "rotation_event",
          },
        },
        context.tier,
      );
    });
  },
};
