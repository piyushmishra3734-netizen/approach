import { createFileRoute } from "@tanstack/react-router";
import { FlightApp } from "@/components/flight-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <FlightApp />;
}
