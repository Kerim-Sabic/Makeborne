import ExpertChat from "@/components/expert-chat";
import { requireCreationPage } from "@/lib/billing/access";

export const metadata = { title: "Advisors", description: "Work through your next idea with focused marketing, research and product advisors." };

export const dynamic = "force-dynamic";
export default async function ChatPage() {
  await requireCreationPage("/chat");
  return <ExpertChat />;
}
