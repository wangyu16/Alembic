import type { Metadata } from "next";
import { TryApp } from "./try-app";

export const metadata: Metadata = { title: "Try Alembic — a sample chapter on your topic" };
export const dynamic = "force-dynamic";

export default function TryPage() {
  return <TryApp />;
}
