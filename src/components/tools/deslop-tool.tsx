"use client";

import { useMemo, useState } from "react";
import { fieldClass } from "@/components/ui";
import { deslop } from "@/lib/tools/deslop";

export function DeslopTool() {
  const [input, setInput] = useState("");
  const result = useMemo(() => deslop(input), [input]);
  return (
    <div className="grid gap-4 text-sm md:grid-cols-2">
      <label className="block">
        <span className="mb-1 block font-medium">Your caption or script</span>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={10} className={fieldClass} aria-label="Original text" />
      </label>
      <label className="block">
        <span className="mb-1 block font-medium">Rewritten</span>
        <textarea value={result.text} readOnly rows={10} className={`${fieldClass} bg-zinc-50`} aria-label="Rewritten text" />
      </label>
      <div className="md:col-span-2" role="status" aria-label="Changes">
        {result.changes.length === 0 ? (
          <p className="text-zinc-600">{input ? "No stock phrases found." : "Paste text to check it."}</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            {result.changes.map((change, index) => (
              <li key={`${change.from}-${index}`}>
                <span className="line-through">{change.from}</span> → {change.to ? <strong>{change.to}</strong> : <em>removed</em>} ({change.reason})
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
