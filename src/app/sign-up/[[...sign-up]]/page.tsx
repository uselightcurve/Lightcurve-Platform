import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f3f4f6] px-4">
      <SignUp />
    </div>
  );
}
