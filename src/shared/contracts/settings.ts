// The app's appearance (one for everyone): the accent color. Anyone can read it (students too);
// only a teacher with the permission can change it.
import { z } from "zod";
import { ACCENTS, type Accent } from "../domain/accents";

export const appearanceBody = z.object({
  accent: z.enum(ACCENTS, { error: "Elegí uno de los colores de la lista." }),
});

export interface AppearanceResponse {
  accent: Accent;
  /** False until someone with the permission picks one (the default is showing). */
  chosen: boolean;
  /** The teacher on this request can change it. */
  canChoose: boolean;
}
