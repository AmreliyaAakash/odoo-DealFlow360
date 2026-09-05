"use client";
import { useClerk } from "@clerk/nextjs";

export default function ClearSession() {
  const { signOut } = useClerk();

  return (
    <div className="p-10 flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-2xl font-bold mb-4">You have an old session stuck!</h1>
      <button 
        onClick={() => signOut({ redirectUrl: '/sign-in' })}
        className="px-6 py-3 bg-red-600 text-white rounded-lg text-lg font-bold cursor-pointer"
      >
        Click Here To Clear Session & Fix Login
      </button>
    </div>
  );
}
