// Creates the activity chosen in the wizard: consigna, tutor configuration (copied from a
// saved tutor or from the proposal), reflection questions and the materials as activity files.
import type { z } from "zod";
import { db, schema } from "../../db/client";
import { HttpError, conflict } from "../../lib/errors";
import { randomToken } from "../../lib/crypto";
import { log } from "../../lib/logger";
import { newKey, saveFile, deleteFile } from "../../lib/storage";
import { ownedClassroom, ownedTutor } from "../access";
import { rulesOfTutor } from "../tutors/queries";
import { loadOwnedMaterials } from "./material-context";
import { appendToActivityMaterial, attachMaterialToActivity } from "./attach";
import { TUTOR_TYPES } from "@shared/domain/pedagogy";
import { composeActivityRules } from "@shared/domain/planning";
import { sanitizeReflectionQuestions } from "@shared/domain/activity-design";
import { MAX_TEXT_FOR_ACTIVITY } from "@shared/domain/library";
import type { CreateFromProposalResponse, createFromProposalBody } from "@shared/contracts/planning";

type CreateInput = z.infer<typeof createFromProposalBody>;

const safeReason = (err: unknown) => (err instanceof HttpError ? err.message : "No se pudo agregar. Probá sumarlo desde la actividad.");

export async function createActivityFromProposal(teacherId: string, input: CreateInput): Promise<CreateFromProposalResponse> {
  const room = await ownedClassroom(teacherId, input.classroomId);
  if (room.isArchived) throw conflict("Esta aula está archivada. Restaurala para crear actividades en ella.");
  const tutor = input.tutorId ? await ownedTutor(teacherId, input.tutorId) : null;
  const materials = await loadOwnedMaterials(teacherId, input.materialIds);
  const p = input.proposal;

  const rules = composeActivityRules({
    guidance: p.tutorGuidance,
    tutorRules: tutor ? rulesOfTutor(tutor) : "",
    teacherNotes: p.teacherNotes,
  });
  const tutorType = tutor?.tutorType ?? (p.tutorType in TUTOR_TYPES ? p.tutorType : "pensamiento_critico");
  const helpLevel = (tutor?.helpLevel ?? p.helpLevel) as "autonomous" | "moderate" | "intensive";
  const status = input.publish ? "published" : "draft";

  const [activity] = await db
    .insert(schema.activities)
    .values({
      classroomId: room.id,
      teacherId,
      title: p.title,
      subject: (input.subject || room.subject).slice(0, 80),
      objectives: p.objectives,
      instructions: p.instructions,
      material: "",
      tutorType,
      helpLevel,
      tutorRules: rules.text,
      tutorId: tutor?.id ?? null,
      // "None" stays none: an empty list is stored as an empty list.
      reflectionQuestions: sanitizeReflectionQuestions(p.reflectionQuestions),
      status,
      publishedAt: input.publish ? new Date() : null,
      linkToken: randomToken(16),
    })
    .returning({ id: schema.activities.id });
  const activityId = activity!.id;

  const skipped: CreateFromProposalResponse["skipped"] = [];
  let attached = 0;

  const pasted = input.extraText.trim();
  if (pasted) {
    try {
      if (pasted.length <= MAX_TEXT_FOR_ACTIVITY) {
        await appendToActivityMaterial(activityId, `— Texto del docente —\n${pasted}`);
      } else {
        const key = newKey("activities", activityId, "txt");
        const data = new TextEncoder().encode(pasted);
        await saveFile(key, data);
        try {
          await db.insert(schema.activityFiles).values({
            activityId,
            storageKey: key,
            fileName: "Texto del docente.txt",
            mimeType: "text/plain",
            kind: "text",
            sizeBytes: data.byteLength,
            extractedText: pasted,
            processingStatus: "ready",
          });
        } catch (err) {
          await deleteFile(key);
          throw err;
        }
      }
      attached++;
    } catch (err) {
      skipped.push({ title: "Texto pegado", reason: safeReason(err) });
    }
  }

  for (const m of materials) {
    try {
      await attachMaterialToActivity(m, activityId);
      attached++;
    } catch (err) {
      skipped.push({ title: m.title, reason: safeReason(err) });
    }
  }

  log.info("activity_created_from_proposal", { teacherId, activityId, status, attached, skipped: skipped.length, tutor: Boolean(tutor) });
  return { activityId, status, attached, skipped };
}
