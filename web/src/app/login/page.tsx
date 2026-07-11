"use client";

import { AuthForms } from "@/components/AuthForms";

// /login (08 §2): email · password → POST /api/auth/login. DEV quick-login strip
// appears when the backend reports DEV_QUICK_LOGIN enabled.
export default function LoginPage() {
  return (
    <div className="py-8">
      <AuthForms mode="login" />
    </div>
  );
}
