import { redirect } from "next/navigation";

// Root → event list (08 §2 has no dedicated home page).
export default function Home() {
  redirect("/events");
}
