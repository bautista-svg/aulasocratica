import type { TeacherCtx } from "./auth/teacher";

export type AppEnv = {
  Variables: {
    requestId: string;
    teacher?: TeacherCtx;
  };
};
