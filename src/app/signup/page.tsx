import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 bg-black">
      <SignupForm googleEnabled={googleEnabled} />
    </div>
  );
}
