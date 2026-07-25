"use client";

import { Suspense } from "react";
import { AuthForms } from "@/components/AuthForms";

// /signup (08 §2): name · email · password → POST /api/auth/register → /events.
// Copy explains that signup also creates the user's private Canton party.
// Suspense: AuthForms reads ?next= via useSearchParams.
export default function SignupPage() {
  return (
    <div className="py-8">
      <Suspense fallback={null}>
        <AuthForms mode="signup" />
      </Suspense>
    </div>
  );
}
