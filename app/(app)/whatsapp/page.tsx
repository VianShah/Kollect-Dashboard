"use client";
import dynamic from "next/dynamic";

const WhatsAppPanel = dynamic(() => import("@/components/WhatsAppPanel"), { ssr: false, loading: () => <div className="card h-40 animate-pulse bg-sunk/60" /> });

export default function WhatsAppPage() {
  return <WhatsAppPanel />;
}
