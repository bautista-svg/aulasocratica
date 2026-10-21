// Build-time only: renders the landing to static HTML (scripts/prerender.mjs).
import { renderToString } from "react-dom/server";
import { Landing } from "./components/landing/landing";

export function renderLanding(): string {
  return renderToString(<Landing />);
}
