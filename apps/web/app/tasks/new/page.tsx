import type { Metadata } from "next";
import { TaskNewView } from "@/components/task-new-view";

export const metadata: Metadata = { title: "Post a task" };

export default function NewTaskPage() {
  return <TaskNewView />;
}
