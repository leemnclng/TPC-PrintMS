import { useEffect, useState } from "react";

/** Live wall-clock, ticked once a minute — enough for an operational top bar,
 *  cheap enough not to matter for render cost. */
export function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  return now;
}
