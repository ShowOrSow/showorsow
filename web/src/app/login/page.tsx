"use client";

import { Suspense } from "react";
import { AuthForms } from "@/components/AuthForms";

// /login (08 §2): email · password → POST /api/auth/login. DEV quick-login strip
// appears when the backend reports DEV_QUICK_LOGIN enabled.
// Suspense: AuthForms reads ?next= via useSearchParams, which this statically
// rendered route needs a boundary for.
export default function LoginPage() {
  return (
    <div className="py-8">
      <Suspense fallback={null}>
        <AuthForms mode="login" />
      </Suspense>
    </div>
  );
}
