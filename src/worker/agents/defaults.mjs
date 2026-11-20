import { AGENT_PRESETS } from "../../shared/agent-contracts.mjs";
import { HARD_CHECKS, LIGHT_REVIEW, FULL_GATES } from "../../shared/gate-policy.mjs";

/* Connect uses workbuddy while the worker CLI preset is codebuddy. */
export const AGENT_ALIAS = { workbuddy: "codebuddy" };

export function presetAgen(nama){ return AGENT_PRESETS[AGENT_ALIAS[nama] || nama] || null; }

export function defaultGates(agentName){
  const nama = agentName || "agy";
  const a = presetAgen(nama);
  if(!a) throw new Error("agen \"" + nama + "\" tidak dikenal — pilih: " + Object.keys(AGENT_PRESETS).join(", "));
  return {
    v: 1,
    agent: { name: nama, label: a.label, cmd: a.cmd, args: a.args, contArgs: a.contArgs, timeoutMin: 20 },
    /* A zero cost ceiling fails closed; only the user may authorize paid work. */
    limits: { maxCalls: 60, maxCallsPerRun: 40, maxCostUsd: 0, maxTokens: null,
      maxConsecutiveFails: 3, fullEvery: 6, fullAtMilestoneEnd: true, fixRounds: 2, autoCommit: true },
    hard: JSON.parse(JSON.stringify(HARD_CHECKS)),
    reviews: [
      { id: "light", label: "Review ringan tiap task", tier: "light", enabled: true, prompt: LIGHT_REVIEW },
      ...JSON.parse(JSON.stringify(FULL_GATES))
    ]
  };
}
