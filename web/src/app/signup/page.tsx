"use client";

import { AuthForms } from "@/components/AuthForms";

// /signup (08 §2): name · email · password → POST /api/auth/register → /events.
// Copy explains that signup also creates the user's private Canton party.
export default function SignupPage() {
  return (
    <div className="py-8">
      <AuthForms mode="signup" />
    </div>
  );
}
