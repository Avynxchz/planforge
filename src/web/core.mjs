/* PlanForge core entry point. Only imports live here: the build rewrites these modules into
   one classic script, so the import order below must stay aligned with test/web-bindings.json. */
import { STARTER_FILES } from "planforge:starter";
import { starterMeta, starterAktif, starterLockLines, starterContractLines, saranLingkungan, starterFileEntries } from "./core/starter.mjs";
import { SCHEMAS, STAGES } from "./core/plan-schema.mjs";
import { buildSystemPrompt, briefBlock, buildStageMessages } from "./core/prompts.mjs";
import { extractJson, ids, normId, featKey, DASH, featTail, featMatch, STATUS_MAP, normStatus, normalizePlan } from "./core/plan-normalize.mjs";
import { CHECK_BROWSER, PERLU_SELECTOR, CONTOH_BEHAVIOR, UI_FILE, UI_KATA, taskUi, specBehavior, masalahBehavior, behaviorBaris, validatePlan, cycleOf } from "./core/plan-rules.mjs";
import { taskChunks, mergeTaskChunk, terapkanJawabanClarify, applyPatches } from "./core/plan-ops.mjs";
import { _pfSvgUid, svgEsc, svgTrunc, svgWrap, svgLines, parseField, erDiagramSvg, sequenceDiagramSvg } from "./core/diagrams.mjs";
import { renderMarkdown, tasksToMd, prdToMd, featuresToMd, roadmapToMd, buildAgentPrompt } from "./core/render.mjs";
import { crc32, canonPlan, planCoreFromPlan, planFingerprintPlan } from "../shared/plan-identity.mjs";
import { planFingerprint, makeZip } from "./core/handoff.mjs";
import { DEMO } from "./core/demo.mjs";
import { AGENT_PRESETS } from "../shared/agent-contracts.mjs";
import { LIGHT_REVIEW, FULL_GATES, HARD_CHECKS } from "../shared/gate-policy.mjs";
import { defaultGates, planTaskList, planBundleJson, freshStateJson, progresDariState } from "./core/plan-workspace.mjs";
import { AGENT_ADAPTERS } from "../shared/agent-contracts.mjs";
import { connNama, connPrompt, connEntry, connConfigJson, connUniversal, rencanaTulis } from "./core/connect.mjs";
import { gateCounts } from "./core/gate-counts.mjs";
/* Perkiraan anggaran dan kapasitas task tinggal di satu modul bersama dengan worker. */
import { hitungBudget, taskMuat, sisaMilestone } from "../shared/budget.mjs";
import { shellQ, runnerCommand } from "./core/runner.mjs";
import { agentsMd, runnerBundle, githubPushFiles, githubPush } from "./core/runner-package.mjs";
import { ALIAS_CHECK, normalisasiAliasBehavior } from "./core/behavior-alias.mjs";
import { missingNpmScripts } from "../shared/npm-contract.mjs";
import { KATA_SCAFFOLD, potongTeks, masalahStrukturRencana, rubrikRencana } from "./core/plan-readiness.mjs";
