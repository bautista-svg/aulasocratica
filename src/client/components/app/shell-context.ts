// Tiny module on purpose: the route error/404 screens (part of the entry chunk) only need to know
// whether they render inside the app shell, without importing the shell itself.
import { createContext, useContext } from "react";

export const InShell = createContext(false);
export const useInAppShell = () => useContext(InShell);
