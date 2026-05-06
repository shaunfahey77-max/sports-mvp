import { SignUp } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SignUpPage() {
  return (
    <div className="min-h-screen bg-[#060D1F] flex flex-col items-center justify-center">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        forceRedirectUrl={`${basePath}/picks`}
      />
    </div>
  );
}
