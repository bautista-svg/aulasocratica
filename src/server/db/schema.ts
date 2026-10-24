// PostgreSQL schema (Drizzle). Every teacher-owned row hangs from `teachers` and every
// student row hangs from a classroom → activity → learning session chain, so a single
// `teacher_id` check on the top-level resource authorizes everything below it.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  check,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ───────────────────────── Teachers & sessions ─────────────────────────

/** A teacher workspace. Anonymous until the teacher adds an email + password. */
export const teachers = pgTable(
  "teachers",
  {
    id: id(),
    displayName: text("display_name").notNull().default(""),
    email: text("email"),
    passwordHash: text("password_hash"),
    /** Google account id ("sub") when the teacher signs in with Google. */
    googleSub: text("google_sub"),
    recoveryCodeHash: text("recovery_code_hash"),
    isSuspended: boolean("is_suspended").notNull().default(false),
    tutorsSeededAt: timestamp("tutors_seeded_at", { withTimezone: true }),
    /** Which skills this workspace evaluates and its own skills (null = the defaults). */
    skillSettings: jsonb("skill_settings"),
    /** Can send change requests ("Pedidos de cambios"); granted by the admin. */
    canRequestChanges: boolean("can_request_changes").notNull().default(false),
    /** Id of the last "Novedades" notice shown (each one appears once, never again). */
    newsSeen: text("news_seen").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("teachers_email_unique").on(sql`lower(${t.email})`),
    uniqueIndex("teachers_google_sub_unique").on(t.googleSub),
    index("teachers_last_seen_idx").on(t.lastSeenAt),
    check("teachers_display_name_len", sql`char_length(${t.displayName}) <= 80`),
  ],
);

export const teacherSessions = pgTable(
  "teacher_sessions",
  {
    id: id(),
    teacherId: uuid("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("teacher_sessions_token_unique").on(t.tokenHash), index("teacher_sessions_teacher_idx").on(t.teacherId)],
);

// ───────────────────────── Classrooms & students ─────────────────────────

export const classrooms = pgTable(
  "classrooms",
  {
    id: id(),
    teacherId: uuid("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    school: text("school").notNull().default(""),
    /** Asked by teachers: a course has several subjects but one teacher ("Docente"). */
    teacherName: text("teacher_name").notNull().default(""),
    /** Kept for courses created before "Docente" replaced it in the form (default subject of their activities). */
    subject: text("subject").notNull().default(""),
    grade: text("grade").notNull().default(""),
    division: text("division").notNull().default(""),
    description: text("description").notNull().default(""),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("classrooms_teacher_idx").on(t.teacherId, t.isArchived),
    check("classrooms_name_len", sql`char_length(${t.name}) between 1 and 120`),
  ],
);

/** A student of a classroom. Students have no account: they join activities by link with their name. */
export const students = pgTable(
  "students",
  {
    id: id(),
    classroomId: uuid("classroom_id").notNull().references(() => classrooms.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    /** Normalized name (lowercase, no accents, single spaces) used to recognise the same student. */
    nameKey: text("name_key").notNull(),
    selfRegistered: boolean("self_registered").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("students_classroom_name_unique").on(t.classroomId, t.nameKey),
    check("students_full_name_len", sql`char_length(${t.fullName}) between 2 and 120`),
  ],
);

// ───────────────────────── Tutors ─────────────────────────

/** Saved tutors. Built-in presets are copied into every workspace (preset_key) and are editable. */
export const tutors = pgTable(
  "tutors",
  {
    id: id(),
    teacherId: uuid("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
    presetKey: text("preset_key"),
    name: text("name").notNull(),
    tutorType: text("tutor_type").notNull().default("pensamiento_critico"),
    subject: text("subject").notNull().default(""),
    studentAge: text("student_age").notNull().default(""),
    objectives: text("objectives").notNull().default(""),
    questionStyle: text("question_style").notNull().default(""),
    difficulty: text("difficulty").notNull().default("intermedia"),
    helpLevel: text("help_level").notNull().default("moderate"),
    strategies: text("strategies").notNull().default(""),
    closingCriteria: text("closing_criteria").notNull().default(""),
    rules: text("rules").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tutors_teacher_idx").on(t.teacherId),
    uniqueIndex("tutors_teacher_preset_unique").on(t.teacherId, t.presetKey).where(sql`${t.presetKey} is not null`),
    check("tutors_name_len", sql`char_length(${t.name}) between 1 and 120`),
    check("tutors_help_level", sql`${t.helpLevel} in ('autonomous','moderate','intensive')`),
    check("tutors_difficulty", sql`${t.difficulty} in ('basica','intermedia','avanzada')`),
  ],
);

// ───────────────────────── Activities ─────────────────────────

export const activities = pgTable(
  "activities",
  {
    id: id(),
    classroomId: uuid("classroom_id").notNull().references(() => classrooms.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subject: text("subject").notNull().default(""),
    objectives: text("objectives").notNull().default(""),
    instructions: text("instructions").notNull().default(""),
    /** Consignas after the first one (solved in order with the same tutor). See domain/consignas.ts. */
    moreInstructions: jsonb("more_instructions").notNull().default(sql`'[]'::jsonb`),
    /** Consignas with their own title and written answer (shared/domain/structure.ts); null = from the old fields. */
    consignas: jsonb("consignas"),
    /** Shown before the activity starts, with a «Comenzar actividad» button. */
    presentation: text("presentation").notNull().default(""),
    presentationOn: boolean("presentation_on").notNull().default(false),
    /** Show the objectives to the students ("Lo que vas a aprender"). */
    objectivesVisible: boolean("objectives_visible").notNull().default(true),
    /** The teacher's titles and subtitles for the sections the students see. */
    sectionTitles: jsonb("section_titles").notNull().default(sql`'{}'::jsonb`),
    material: text("material").notNull().default(""),
    tutorType: text("tutor_type").notNull().default("pensamiento_critico"),
    /** Other tutor types combined with the main one (the student talks to one tutor that mixes them). */
    extraTutorTypes: jsonb("extra_tutor_types").notNull().default(sql`'[]'::jsonb`),
    helpLevel: text("help_level").notNull().default("moderate"),
    tutorRules: text("tutor_rules").notNull().default(""),
    tutorId: uuid("tutor_id").references(() => tutors.id, { onDelete: "set null" }),
    requireInitialAnswer: boolean("require_initial_answer").notNull().default(true),
    /** Whether the closing step asks for a final answer, and with which question ("" = the default one). */
    askFinalAnswer: boolean("ask_final_answer").notNull().default(true),
    finalQuestion: text("final_question").notNull().default(""),
    /** Language of the student's screens and the tutor: "es" or "en". */
    language: text("language").notNull().default("es"),
    /** Whether the closing step asks the reflection questions (they are kept when turned off). */
    askReflection: boolean("ask_reflection").notNull().default(true),
    /** A message the student reads at the end, with nothing to answer (shown only when on). */
    closingMessageOn: boolean("closing_message_on").notNull().default(false),
    closingMessage: text("closing_message").notNull().default(""),
    voiceLanguage: text("voice_language").notNull().default("off"),
    /**
     * Whether students hand in a file or link when they finish: off, optional or required. New
     * activities start as optional (teachers expected students to be able to hand in their work).
     */
    deliverableMode: text("deliverable_mode").notNull().default("optional"),
    /** What the file should be ("Una foto del barco que armaste"). */
    deliverablePrompt: text("deliverable_prompt").notNull().default(""),
    rubric: jsonb("rubric").notNull().default(sql`'[]'::jsonb`),
    reflectionQuestions: jsonb("reflection_questions").notNull().default(sql`'[]'::jsonb`),
    /** In the classroom's "Papelera" since then (archived; removed for good after 30 days). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    linkToken: text("link_token").notNull(),
    linkActive: boolean("link_active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("activities_link_token_unique").on(t.linkToken),
    index("activities_classroom_idx").on(t.classroomId, t.createdAt),
    index("activities_teacher_idx").on(t.teacherId, t.updatedAt),
    check("activities_title_len", sql`char_length(${t.title}) between 1 and 160`),
    check("activities_status", sql`${t.status} in ('draft','published','archived')`),
    check("activities_help_level", sql`${t.helpLevel} in ('autonomous','moderate','intensive')`),
    check("activities_voice_language", sql`${t.voiceLanguage} in ('off','es','en')`),
    check("activities_deliverable_mode", sql`${t.deliverableMode} in ('off','optional','required')`),
    check("activities_language", sql`${t.language} in ('es','en')`),
  ],
);

/** Files attached to an activity; their extracted text is what the tutor reads. */
export const activityFiles = pgTable(
  "activity_files",
  {
    id: id(),
    activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    kind: text("kind").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count"),
    extractedText: text("extracted_text").notNull().default(""),
    /** Teacher-written description, e.g. a transcript for an audio file. */
    teacherNote: text("teacher_note").notNull().default(""),
    processingStatus: text("processing_status").notNull().default("pending"),
    processingError: text("processing_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("activity_files_storage_unique").on(t.storageKey),
    index("activity_files_activity_idx").on(t.activityId),
    check("activity_files_kind", sql`${t.kind} in ('pdf','image','audio','docx','text')`),
    check("activity_files_status", sql`${t.processingStatus} in ('pending','processing','ready','failed')`),
  ],
);

// ───────────────────────── Teacher library ─────────────────────────

export const materials = pgTable(
  "materials",
  {
    id: id(),
    teacherId: uuid("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    fileKind: text("file_kind"),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    pageCount: integer("page_count"),
    url: text("url"),
    body: text("body").notNull().default(""),
    extractedText: text("extracted_text").notNull().default(""),
    processingStatus: text("processing_status").notNull().default("ready"),
    processingError: text("processing_error"),
    folder: text("folder").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("materials_teacher_idx").on(t.teacherId, t.updatedAt),
    check("materials_kind", sql`${t.kind} in ('file','link','text')`),
    check("materials_title_len", sql`char_length(${t.title}) between 1 and 200`),
    check("materials_status", sql`${t.processingStatus} in ('pending','processing','ready','failed')`),
  ],
);

// ───────────────────────── Student work ─────────────────────────

export const learningSessions = pgTable(
  "learning_sessions",
  {
    id: id(),
    activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("in_progress"),
    initialAnswer: text("initial_answer"),
    finalAnswer: text("final_answer"),
    /** With several consignas: one final answer per consigna (final_answer keeps them joined). */
    finalAnswers: jsonb("final_answers").notNull().default(sql`'[]'::jsonb`),
    /** The answer written in each consigna while working ({ consignaId: text }), saved as it is typed. */
    consignaAnswers: jsonb("consigna_answers").notNull().default(sql`'{}'::jsonb`),
    reflection: jsonb("reflection"),
    hintCount: integer("hint_count").notNull().default(0),
    /** Short code the student uses to continue on another device. */
    resumeCode: text("resume_code").notNull(),
    endedByTeacher: boolean("ended_by_teacher").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("learning_sessions_activity_student_unique").on(t.activityId, t.studentId),
    index("learning_sessions_student_idx").on(t.studentId),
    // Covers the per-activity counts of every activity list (participants, completed, active now)
    // with index-only scans.
    index("learning_sessions_activity_status_idx").on(t.activityId, t.status, t.lastActivityAt),
    check("learning_sessions_status", sql`${t.status} in ('in_progress','completed')`),
  ],
);

/** Device tokens for a student's session (hashed). */
export const studentTokens = pgTable(
  "student_tokens",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => learningSessions.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("student_tokens_hash_unique").on(t.tokenHash), index("student_tokens_session_idx").on(t.sessionId)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => learningSessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    intent: text("intent"),
    inputMode: text("input_mode").notNull().default("text"),
    isPartial: boolean("is_partial").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_session_created_idx").on(t.sessionId, t.createdAt),
    check("messages_role", sql`${t.role} in ('user','assistant')`),
    check("messages_input_mode", sql`${t.inputMode} in ('text','voice')`),
  ],
);

export const pedagogicalEvents = pgTable(
  "pedagogical_events",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => learningSessions.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    source: text("source").notNull().default("observed"),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index("pedagogical_events_session_created_idx").on(t.sessionId, t.createdAt),
    index("pedagogical_events_session_type_idx").on(t.sessionId, t.eventType, t.createdAt),
    check("pedagogical_events_source", sql`${t.source} in ('observed','inferred')`),
  ],
);

export const rubricAssessments = pgTable(
  "rubric_assessments",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => learningSessions.id, { onDelete: "cascade" }),
    rubricSnapshot: jsonb("rubric_snapshot").notNull().default(sql`'[]'::jsonb`),
    aiSuggestion: jsonb("ai_suggestion"),
    aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
    teacherLevels: jsonb("teacher_levels").notNull().default(sql`'{}'::jsonb`),
    teacherComment: text("teacher_comment").notNull().default(""),
    status: text("status").notNull().default("suggested"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rubric_assessments_session_unique").on(t.sessionId),
    check("rubric_assessments_status", sql`${t.status} in ('suggested','confirmed')`),
  ],
);

/**
 * The file a student hands in with the final answer (one per work; uploading again replaces it).
 * Its text is extracted like any uploaded file, and the teacher can analyze it with the rubric.
 */
export const sessionDeliverables = pgTable(
  "session_deliverables",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => learningSessions.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    /** Null for a link (nothing is stored; a public Google link is read from Google). */
    storageKey: text("storage_key"),
    /** For kind "link": the address the student pasted. fileName holds a label ("Documento de Google"). */
    url: text("url"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    kind: text("kind").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count"),
    extractedText: text("extracted_text").notNull().default(""),
    processingStatus: text("processing_status").notNull().default("pending"),
    processingError: text("processing_error"),
    /** The AI's rubric-based reading of the file (a suggestion the teacher reviews). */
    analysis: jsonb("analysis"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("session_deliverables_session_unique").on(t.sessionId),
    uniqueIndex("session_deliverables_storage_unique").on(t.storageKey),
    index("session_deliverables_activity_idx").on(t.activityId),
    check("session_deliverables_kind", sql`${t.kind} in ('pdf','image','docx','text','link')`),
    check("session_deliverables_link", sql`(${t.kind} = 'link') = (${t.url} is not null and ${t.storageKey} is null)`),
    check("session_deliverables_status", sql`${t.processingStatus} in ('pending','processing','ready','failed')`),
  ],
);

export const thinkingAnalyses = pgTable(
  "thinking_analyses",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => learningSessions.id, { onDelete: "cascade" }),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("thinking_analyses_session_unique").on(t.sessionId)],
);

/** Strengths and areas to reinforce of a work (AI suggestions and the teacher's own). */
export const aspectAnalyses = pgTable(
  "aspect_analyses",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => learningSessions.id, { onDelete: "cascade" }),
    /** Former "fortalezas y aspectos a reforzar" (kept; works are evaluated again by skills). */
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
    /** "Habilidades": one SkillAssessment per evaluated skill (shared/domain/skills.ts). */
    skills: jsonb("skills").notNull().default(sql`'[]'::jsonb`),
    /** Pedagogical recommendations for the teacher about this student. */
    recommendations: jsonb("recommendations").notNull().default(sql`'[]'::jsonb`),
    /** The student's interventions the evaluation read (not a measure of quality). */
    interventions: integer("interventions").notNull().default(0),
    skillsAt: timestamp("skills_at", { withTimezone: true }),
    /** The criteria version the skills were evaluated with (SKILL_CRITERIA_VERSION). */
    skillsVersion: integer("skills_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("aspect_analyses_session_unique").on(t.sessionId)],
);

export const sessionSummaries = pgTable(
  "session_summaries",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => learningSessions.id, { onDelete: "cascade" }),
    basis: text("basis").array().notNull().default(sql`'{}'::text[]`),
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("session_summaries_session_unique").on(t.sessionId)],
);

// ───────────────────────── Alerts ─────────────────────────

export const classroomAlerts = pgTable(
  "classroom_alerts",
  {
    id: id(),
    classroomId: uuid("classroom_id").notNull().references(() => classrooms.id, { onDelete: "cascade" }),
    builtinKey: text("builtin_key"),
    name: text("name").notNull().default(""),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("academica"),
    severity: text("severity").notNull().default("review"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("classroom_alerts_builtin_unique").on(t.classroomId, t.builtinKey),
    index("classroom_alerts_classroom_idx").on(t.classroomId),
    check("classroom_alerts_category", sql`${t.category} in ('academica','conducta','seguridad','integridad')`),
    check("classroom_alerts_severity", sql`${t.severity} in ('review','immediate')`),
  ],
);

export const studentAlerts = pgTable(
  "student_alerts",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => learningSessions.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    classroomAlertId: uuid("classroom_alert_id").references(() => classroomAlerts.id, { onDelete: "set null" }),
    alertKey: text("alert_key").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    source: text("source").notNull().default("chat"),
    evidence: text("evidence").notNull().default(""),
    reason: text("reason").notNull().default(""),
    status: text("status").notNull().default("open"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("student_alerts_activity_idx").on(t.activityId, t.createdAt),
    index("student_alerts_session_idx").on(t.sessionId, t.alertKey, t.createdAt),
    // Open alerts are counted on every activity list, the dashboard and the live view.
    index("student_alerts_open_idx").on(t.activityId, t.createdAt).where(sql`${t.status} = 'open'`),
    check("student_alerts_status", sql`${t.status} in ('open','reviewed','dismissed')`),
    check("student_alerts_severity", sql`${t.severity} in ('review','immediate')`),
  ],
);

// ───────────────────────── Reports ─────────────────────────

export const reports = pgTable(
  "reports",
  {
    id: id(),
    teacherId: uuid("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    scope: jsonb("scope").notNull().default(sql`'{}'::jsonb`),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    narrative: jsonb("narrative").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("draft"),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reports_teacher_idx").on(t.teacherId, t.updatedAt),
    check("reports_kind", sql`${t.kind} in ('individual','group','overview')`),
    check("reports_status", sql`${t.status} in ('draft','validated')`),
    check("reports_title_len", sql`char_length(${t.title}) between 1 and 200`),
  ],
);

// ───────────────────────── Operations ─────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    teacherId: uuid("teacher_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull().default(""),
    entityId: uuid("entity_id"),
    ip: text("ip").notNull().default(""),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt), index("audit_logs_action_ip_idx").on(t.action, t.ip, t.createdAt)],
);

/** One row per AI call: quotas per workspace and cost visibility in /admin. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    teacherId: uuid("teacher_id").references(() => teachers.id, { onDelete: "set null" }),
    activityId: uuid("activity_id"),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_teacher_created_idx").on(t.teacherId, t.createdAt), index("ai_usage_created_idx").on(t.createdAt)],
);

/** "Pedidos de cambios": a teacher's request, written with an AI that asks until it understands. */
export const changeRequests = pgTable(
  "change_requests",
  {
    id: id(),
    teacherId: uuid("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull().default(""),
    /** What the AI understood (see contracts/requests.ts RequestSummary). */
    summary: jsonb("summary"),
    ready: boolean("ready").notNull().default(false),
    messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`),
    /** Screenshots: [{ id, key, name }] (stored under requests/<teacher>/). */
    images: jsonb("images").notNull().default(sql`'[]'::jsonb`),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("change_requests_teacher_idx").on(t.teacherId, t.createdAt),
    index("change_requests_status_idx").on(t.status, t.submittedAt),
    check("change_requests_status", sql`${t.status} in ('draft','pending','in_progress','done','discarded')`),
  ],
);

/**
 * "Reevaluar habilidades": one run per activity re-evaluates every work from scratch. New results
 * are only written when all works succeed (otherwise the previous ones stay); at most one run per
 * activity is "running" at a time.
 */
export const skillRuns = pgTable(
  "skill_runs",
  {
    id: id(),
    activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    total: integer("total").notNull().default(0),
    done: integer("done").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    error: text("error").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("skill_runs_activity_idx").on(t.activityId, t.startedAt),
    uniqueIndex("skill_runs_one_running").on(t.activityId).where(sql`${t.status} = 'running'`),
    check("skill_runs_status", sql`${t.status} in ('running','done','failed')`),
  ],
);
