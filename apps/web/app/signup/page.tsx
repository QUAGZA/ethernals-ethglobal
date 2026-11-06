import type { Metadata } from "next";
import { SignupView } from "@/components/signup-view";

export const metadata: Metadata = { title: "Get started" };

export default function SignupPage() {
  return <SignupView />;
}
