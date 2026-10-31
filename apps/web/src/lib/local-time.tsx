"use client";
import { useEffect, useState } from "react";
import { courseTime } from "./course-time";

/** A time in the reader's own time zone. The server renders the course's zone; the browser swaps in its own after load. */
export function LocalTime({ at }: { at: string | number }) {
  const [text, setText] = useState(() => courseTime(at));
  useEffect(() => {
    setText(new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }));
  }, [at]);
  return <time dateTime={new Date(at).toISOString()}>{text}</time>;
}
