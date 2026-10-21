import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(160, "El correo es demasiado largo.")
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Revisá el correo: parece que no está bien escrito.");

const password = z
  .string()
  .min(10, "La contraseña debe tener al menos 10 caracteres.")
  .max(200, "La contraseña es demasiado larga.");

export const displayNameSchema = z.string().trim().max(80, "Usá hasta 80 caracteres.");

export const startWorkspaceBody = z.object({ displayName: displayNameSchema.optional() });
export const updateMeBody = z.object({ displayName: displayNameSchema });
export const registerBody = z.object({ email, password, displayName: displayNameSchema.optional() });
export const loginBody = z.object({ email, password: z.string().min(1, "Escribí tu contraseña.").max(200) });
export const recoverBody = z.object({
  email,
  recoveryCode: z.string().trim().min(8, "Revisá el código de recuperación.").max(40),
  newPassword: password,
});
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });
export const deleteWorkspaceBody = z.object({ confirm: z.literal("BORRAR", { message: 'Escribí BORRAR para confirmar.' }) });

export interface Me {
  id: string;
  displayName: string;
  email: string | null;
  hasAccount: boolean;
  createdAt: string;
}

export interface MeResponse {
  teacher: Me | null;
}

export interface RecoveryCodeResponse {
  teacher: Me;
  recoveryCode: string;
}
