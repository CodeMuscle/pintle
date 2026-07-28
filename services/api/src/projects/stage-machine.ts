/**
 * Project stage state machine — enforced server-side (DoD), never trusted to
 * the client. Source: database-blueprint.docx → "Project stage lifecycle":
 *
 *   setup → ingestion → mapping → validation → dry_run → cutover → complete
 *                                   └─→ blocked  (side-branch, any stage)
 *
 * `current_stage` only ever holds a real stage (DB CHECK constraint). "blocked"
 * is a project *status* side-branch: blocking leaves the stage untouched and
 * sets status=blocked; a blocked project must be resumed (status→active) to
 * its current stage before it can advance again.
 */
import type { ProjectStage, ProjectStatus, DomainEventName, ProjectsDTO } from "@pintle/contracts";

type AdvanceStageTarget = ProjectsDTO.AdvanceStageTarget;

export const STAGE_ORDER: ProjectStage[] = [
  "setup",
  "ingestion",
  "mapping",
  "validation",
  "dry_run",
  "cutover",
  "complete",
];

function nextStage(stage: ProjectStage): ProjectStage | null {
  const i = STAGE_ORDER.indexOf(stage);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? (STAGE_ORDER[i + 1] as ProjectStage) : null;
}

/** Status implied by entering a stage. */
function statusForStage(stage: ProjectStage): ProjectStatus {
  if (stage === "complete") return "completed";
  if (stage === "cutover") return "ready_for_cutover";
  return "active";
}

export type StagePlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      toStage: ProjectStage;
      toStatus: ProjectStatus;
      event: Extract<
        DomainEventName,
        | "migration_project.stage_changed"
        | "migration_project.blocked"
        | "migration_project.completed"
      >;
    };

/**
 * Decide whether `target` is a legal move from the current (stage, status).
 * Pure — callers persist + emit based on the returned plan.
 */
export function planStageTransition(
  current: { stage: ProjectStage; status: ProjectStatus },
  target: AdvanceStageTarget,
): StagePlan {
  const blocked = current.status === "blocked";

  if (target === "blocked") {
    if (blocked) return { ok: false, reason: "Project is already blocked" };
    return {
      ok: true,
      toStage: current.stage,
      toStatus: "blocked",
      event: "migration_project.blocked",
    };
  }

  if (blocked) {
    // Only legal move out of blocked is to resume the same stage.
    if (target === current.stage) {
      return {
        ok: true,
        toStage: current.stage,
        toStatus: statusForStage(current.stage),
        event: "migration_project.stage_changed",
      };
    }
    return {
      ok: false,
      reason: `Project is blocked; resume to "${current.stage}" before advancing`,
    };
  }

  const expected = nextStage(current.stage);
  if (expected === null) {
    return { ok: false, reason: `Project is at terminal stage "complete"` };
  }
  if (target !== expected) {
    return {
      ok: false,
      reason: `Illegal transition ${current.stage} → ${target}; next legal stage is "${expected}"`,
    };
  }

  return {
    ok: true,
    toStage: target,
    toStatus: statusForStage(target),
    event:
      target === "complete" ? "migration_project.completed" : "migration_project.stage_changed",
  };
}
