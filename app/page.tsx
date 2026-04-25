import { Suspense } from "react";
import { ClientPage } from "../components/ClientPage";

export default function Home() {
  return (
    <Suspense fallback={<div className="flex h-[100dvh] items-center justify-center bg-sky-50 text-slate-500">Loading map...</div>}>
      <ClientPage />
    </Suspense>
  );
}
