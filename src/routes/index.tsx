import { createFileRoute } from "@tanstack/react-router";
import { SpiritBoxApp } from "@/components/box/SpiritBoxApp";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <SpiritBoxApp />;
}
