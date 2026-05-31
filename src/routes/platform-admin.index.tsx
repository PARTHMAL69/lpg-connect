import { createFileRoute } from "@tanstack/react-router";
import { AgenciesPage } from "./platform-admin";

export const Route = createFileRoute("/platform-admin/")({
  component: AgenciesPage,
});
