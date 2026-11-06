"use client";

import { useParams } from "next/navigation";
import { TaskDetailView } from "@/components/task-detail-view";

// Client-side fetching only: the server is not needed at build time.
export default function TaskPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  return <TaskDetailView key={id} id={id} />;
}
