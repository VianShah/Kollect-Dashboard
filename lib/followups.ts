import type { Borrower, FollowUp, ReachChannel } from "./types";

export const REACH_CHANNELS: ReachChannel[] = ["Telecaller", "AI voice", "WhatsApp", "IVR"];
export const REACH_COLOR: Record<ReachChannel, string> = { Telecaller: "bg-bad", "AI voice": "bg-[#8a4307]", WhatsApp: "bg-brand", IVR: "bg-[#c47a1c]" };

/** The channel a call-back goes out on: what was set, else how it was asked for. Do-not-call borrowers only get WhatsApp. */
export function reachOf(f: FollowUp, b?: Pick<Borrower, "dnd" | "waConsent">): ReachChannel {
  const base: ReachChannel = f.reachVia ?? (f.requestedVia === "WhatsApp" ? "WhatsApp" : f.requestedVia === "AI Voice" ? "AI voice" : f.requestedVia === "IVR" ? "IVR" : "Telecaller");
  return b?.dnd && base !== "WhatsApp" ? "WhatsApp" : base;
}
