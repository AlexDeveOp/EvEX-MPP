// Carpetas de datos del usuario (userData), compartidas por los módulos del proceso principal.
import { app } from "electron";
import path from "node:path";

export const userData = () => app.getPath("userData");
export const mediaDir = (...p) => path.join(userData(), "media", ...p);
export const avatarDir = () => mediaDir("avatars");
