#!/usr/bin/env node
import { main } from "./cli/main.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export { AGENT_PRESETS, AGENT_ADAPTERS } from "../shared/agent-contracts.mjs";
export { AGENT_ALIAS, presetAgen, defaultGates } from "./agents/defaults.mjs";
export { LIGHT_REVIEW, FULL_GATES, HARD_CHECKS } from "../shared/gate-policy.mjs";
export { crc32, canonPlan, planCoreFromPlan, planFingerprintPlan } from "../shared/plan-identity.mjs";
export { findRoot, resolveRoot } from "./ledger/root.mjs";
export { cetakFile } from "./ledger/files.mjs";
export { buildLama, bannerBuildLama } from "./identity.mjs";
export { loadCtx, syncCtx, saveCtx } from "./ledger/state.mjs";
export { log } from "./ledger/log.mjs";
export { nextTask } from "./ledger/tasks.mjs";
export { taskCard, buildTaskPrompt, buildFixPrompt } from "./agents/prompts.mjs";
export { parseLighthouse, metricProblems, runHardGates, npmScriptNama, pruneUnavailableGates } from "./verification/hard-gates.mjs";
export { perintahVerifikasi, VERIF_DILEWATI, runVerification, ringkasVerifikasi } from "./verification/commands.mjs";
export { BROWSER_CALON, cariBrowser } from "./browser/discovery.mjs";
export { CHECK_BROWSER, taskUi, specBehavior, masalahBehavior } from "../shared/behavior-spec.mjs";
export { kartuBehavior, ringkasBehavior } from "./browser/spec.mjs";
export { BEH_DILEWATI, runBehavior } from "./browser/run.mjs";
export { hitungBudget, taskMuat, sisaMilestone } from "../shared/budget.mjs";
export { budgetRencana, sisaBudget } from "./workflow/budget.mjs";
export { mulaiSesi } from "./workflow/session.mjs";
export { callAgent } from "./agents/process.mjs";
export { catatBiaya } from "./agents/cost.mjs";
export { extractVerdict } from "./agents/verdict.mjs";
export { runOne } from "./workflow/run-one.mjs";
export { runFullGates } from "./workflow/full-review.mjs";
export { giliranJatuh, kartuGiliran, buktiGiliran } from "./workflow/giliran.mjs";
export { changedFiles, potretKotor } from "./ledger/snapshots.mjs";
export { gitCommit } from "./ledger/commit.mjs";
export { bukanPerintah, kutipSatuBocor } from "./environment/shell.mjs";
export { environmentReadiness, setupEnv } from "./environment/readiness.mjs";
export { missingNpmScripts } from "../shared/npm-contract.mjs";
export { auditPlan } from "./environment/audit.mjs";
export { prosesNode, doctorMcp } from "./connectors/process.mjs";
export { refreshConnector } from "./connectors/refresh.mjs";
export { kandidatInterpreter, jalurAman, absolutkanScript, pinInterpreter } from "./environment/interpreter.mjs";
export { mcpEntry, mcpServerName, mcpSnippet, mcpUniversal, connectAgent } from "./connectors/config.mjs";
export { parseArgs } from "./cli/args.mjs";
export { main } from "./cli/main.mjs";
export { MCP_TOOLS } from "./mcp/schema.mjs";
export { buktiSelesai } from "./verification/evidence.mjs";
export { mcpHandle } from "./mcp/handler.mjs";

/* Propagate synchronous command failures to the shell and CI. */
if(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href){
  const kode = main();
  if(kode) process.exitCode = kode;
}
