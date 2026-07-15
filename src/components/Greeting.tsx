"use client";

import { useEffect, useState } from "react";
import { Vinyl } from "./Vinyl";

// Time-of-day greeting in the visitor's local timezone. The server can't know
// the client's clock, so we render the most likely case ("Good evening" — when
// most listening happens) and correct it after hydration.
function greet(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 23) return "Good evening";
  return "Up late";
}

export default function Greeting() {
  const [text, setText] = useState("Good evening");
  useEffect(() => { setText(greet(new Date().getHours())); }, []);

  return (
    <h1 className="text-2xl font-black tracking-tight">
      {text}<Vinyl />
    </h1>
  );
}
