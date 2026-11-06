import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Task" };

export default function TaskLayout({ children }: { children: ReactNode }) {
  return children;
}
