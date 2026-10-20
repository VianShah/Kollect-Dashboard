import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LANDING } from "@/lib/roles";

/** Each role lands on the page it works from: telecallers on the Call desk, supervisors on Campaigns, managers on Portfolio. */
export default async function Index() {
  const user = await getSession();
  redirect(user ? LANDING[user.role] : "/login");
}